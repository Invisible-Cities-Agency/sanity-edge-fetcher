/**
 * @file cache.ts
 * @description Multi-layer caching for Sanity Edge Fetcher
 * @author Invisible Cities Agency
 * @license MIT
 */

import { edgeSanityFetch, type EdgeSanityFetchOptions } from './core';
import { Redis } from '@upstash/redis';

// Check if Upstash Redis is configured
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_READ_ONLY_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN;

const isRedisConfigured = !!(REDIS_URL && (REDIS_TOKEN || REDIS_READ_ONLY_TOKEN));

// Initialize Redis client if configured
let redis: Redis | null = null;
let redisWriter: Redis | null = null;

if (isRedisConfigured) {
  try {
    redis = new Redis({
      url: REDIS_URL!,
      token: (REDIS_READ_ONLY_TOKEN || REDIS_TOKEN)!,
      automaticDeserialization: true,
    });
    
    // Separate writer client if write token available
    if (REDIS_TOKEN) {
      redisWriter = new Redis({
        url: REDIS_URL!,
        token: REDIS_TOKEN,
        automaticDeserialization: true,
      });
    } else {
      redisWriter = redis;
    }
  } catch (error) {
    console.warn('Failed to initialize Redis client:', error);
    redis = null;
    redisWriter = null;
  }
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  validUntil: number;
}

interface CachedFetchOptions extends EdgeSanityFetchOptions {
  /** Cache configuration */
  cache?: {
    /** Time to live in seconds */
    ttl?: number;
    /** Cache key prefix */
    prefix?: string;
    /** Force cache refresh */
    force?: boolean;
    /** Enable Redis caching if available */
    useRedis?: boolean;
    /** Enable Next.js cache */
    useNextCache?: boolean;
  };
}

/**
 * Generate cache key from query and params
 */
function generateCacheKey(
  dataset: string,
  query: string,
  params?: Record<string, any>
): string {
  const baseKey = `sanity:${dataset}:${query}`;
  if (!params || Object.keys(params).length === 0) {
    return baseKey;
  }
  
  // Sort params for consistent key generation
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${JSON.stringify(params[key])}`)
    .join('&');
  
  return `${baseKey}:${sortedParams}`;
}

/**
 * In-memory LRU cache for edge runtime
 */
class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 100;
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.validUntil) {
      this.cache.delete(key);
      return null;
    }
    
    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }
  
  set<T>(key: string, value: T, ttl: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      validUntil: Date.now() + (ttl * 1000)
    });
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
}

// Global memory cache instance
const memoryCache = new MemoryCache();

/**
 * Fetches data from Sanity with multi-layer caching
 * 
 * Cache layers (in order):
 * 1. In-memory LRU cache (fastest, ~1ms)
 * 2. Upstash Redis (if configured, ~10-30ms)
 * 3. Origin fetch with Next.js cache
 */
export async function cachedSanityFetch<T>(
  options: CachedFetchOptions
): Promise<T> {
  const {
    dataset,
    query,
    params,
    cache = {}
  } = options;
  
  const {
    ttl = 60, // 1 minute default
    prefix = '',
    force = false,
    useRedis = true,
    useNextCache = true
  } = cache;
  
  const cacheKey = prefix + generateCacheKey(dataset, query, params);
  
  // Layer 1: Memory cache (unless force refresh)
  if (!force) {
    const memoryResult = memoryCache.get<T>(cacheKey);
    if (memoryResult !== null) {
      if (process.env.NODE_ENV === 'development') {
        console.log('🎯 Cache hit (memory):', cacheKey.substring(0, 50));
      }
      return memoryResult;
    }
  }
  
  // Layer 2: Redis cache (if configured and enabled)
  if (!force && useRedis && redis) {
    try {
      const redisEntry = await redis.get<CacheEntry<T>>(cacheKey);
      if (redisEntry && Date.now() <= redisEntry.validUntil) {
        if (process.env.NODE_ENV === 'development') {
          console.log('🎯 Cache hit (Redis):', cacheKey.substring(0, 50));
        }
        
        // Populate memory cache
        memoryCache.set(cacheKey, redisEntry.value, ttl);
        
        return redisEntry.value;
      }
    } catch (error) {
      console.warn('Redis cache read error:', error);
      // Continue to fetch from origin
    }
  }
  
  // Layer 3: Fetch from origin
  if (process.env.NODE_ENV === 'development') {
    console.log('🔄 Cache miss, fetching:', cacheKey.substring(0, 50));
  }
  
  let result: T;
  
  // Use Next.js cache if available and enabled
  if (useNextCache && typeof window === 'undefined') {
    try {
      const { unstable_cache } = require('next/cache');
      const cachedFetch = unstable_cache(
        async () => edgeSanityFetch<T>(options),
        [cacheKey],
        {
          revalidate: ttl,
          tags: [`sanity-${dataset}`]
        }
      );
      result = await cachedFetch();
    } catch {
      // Next.js cache not available, fetch directly
      result = await edgeSanityFetch<T>(options);
    }
  } else {
    result = await edgeSanityFetch<T>(options);
  }
  
  // Populate caches
  memoryCache.set(cacheKey, result, ttl);
  
  if (useRedis && redisWriter) {
    try {
      const entry: CacheEntry<T> = {
        value: result,
        timestamp: Date.now(),
        validUntil: Date.now() + (ttl * 1000)
      };
      await redisWriter.set(cacheKey, entry, { ex: ttl });
    } catch (error) {
      console.warn('Redis cache write error:', error);
      // Continue without caching
    }
  }
  
  return result;
}

/**
 * Create a cached fetcher with default options
 */
export function createCachedFetcher(
  dataset: string,
  defaultCacheOptions?: CachedFetchOptions['cache']
) {
  return <T>(
    query: string,
    params?: Record<string, any>,
    cacheOverrides?: CachedFetchOptions['cache']
  ) => {
    return cachedSanityFetch<T>({
      dataset,
      query,
      params,
      cache: { ...defaultCacheOptions, ...cacheOverrides }
    });
  };
}

/**
 * Clear caches for a specific dataset or pattern
 */
export async function clearSanityCache(options?: {
  dataset?: string;
  pattern?: string;
  clearMemory?: boolean;
  clearRedis?: boolean;
}): Promise<void> {
  const {
    dataset,
    pattern,
    clearMemory = true,
    clearRedis = true
  } = options || {};
  
  // Clear memory cache
  if (clearMemory) {
    if (!dataset && !pattern) {
      memoryCache.clear();
    } else {
      // Note: Memory cache doesn't support pattern matching
      // Would need to iterate all keys for pattern support
      console.warn('Pattern-based memory cache clearing not implemented');
    }
  }
  
  // Clear Redis cache
  if (clearRedis && redisWriter) {
    try {
      const keyPattern = pattern || (dataset ? `sanity:${dataset}:*` : 'sanity:*');
      const keys = await redis!.keys(keyPattern);
      if (keys.length > 0) {
        await redisWriter.del(...keys);
      }
    } catch (error) {
      console.error('Failed to clear Redis cache:', error);
    }
  }
}

/**
 * Warm cache by pre-fetching common queries
 */
export async function warmSanityCache(
  queries: Array<{
    dataset: string;
    query: string;
    params?: Record<string, any>;
    ttl?: number;
  }>
): Promise<void> {
  await Promise.all(
    queries.map(({ dataset, query, params, ttl }) =>
      cachedSanityFetch({
        dataset,
        query,
        params,
        cache: { ttl }
      }).catch(error => {
        console.error(`Failed to warm cache for query:`, query, error);
      })
    )
  );
}

// Export cache status utility
export function getCacheStatus() {
  return {
    memory: {
      available: true,
      size: memoryCache.size()
    },
    redis: {
      available: isRedisConfigured && redis !== null,
      configured: isRedisConfigured,
      url: REDIS_URL ? new URL(REDIS_URL).hostname : null
    },
    nextCache: {
      available: typeof window === 'undefined'
    }
  };
}