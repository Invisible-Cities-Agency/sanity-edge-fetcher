/**
 * @file config.ts
 * @description Centralized configuration for Sanity Edge Fetcher
 * @author Invisible Cities Agency
 * @license MIT
 */

import { createEdgeSanityFetcher } from './src/core';
import { createCachedFetcher } from './src/cache';
import { edgeSanityFetchWithRetry } from './src/enhanced';

/**
 * Sanity configuration from environment variables
 */
export const sanityConfig = {
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2025-02-10',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  token: process.env.SANITY_VIEWER_TOKEN,
  useCdn: process.env.NODE_ENV === 'production',
} as const;

/**
 * Cache configuration
 */
export const cacheConfig = {
  // Default TTLs for different content types (in seconds)
  ttl: {
    default: 60,           // 1 minute
    static: 3600,         // 1 hour for static content
    dynamic: 30,          // 30 seconds for frequently changing content
    long: 86400,          // 24 hours for rarely changing content
  },
  
  // Cache prefixes for organization
  prefixes: {
    page: 'page:',
    post: 'post:',
    author: 'author:',
    category: 'cat:',
    section: 'section:',
    global: 'global:',
  },
  
  // Layer configuration
  layers: {
    memory: {
      enabled: true,
      maxSize: 100,
    },
    redis: {
      enabled: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
      url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
      readOnlyToken: process.env.KV_REST_API_READ_ONLY_TOKEN,
    },
    nextCache: {
      enabled: typeof window === 'undefined',
    },
  },
} as const;

/**
 * Rate limiting configuration
 */
export const rateLimitConfig = {
  minInterval: 100,       // Minimum 100ms between requests
  maxRequestsPerSecond: 10,
} as const;

/**
 * Retry configuration (if p-retry is available)
 */
export const retryConfig = {
  retries: 3,
  minTimeout: 100,
  maxTimeout: 2000,
  factor: 2,
} as const;

/**
 * Real-time configuration
 */
export const realtimeConfig = {
  sse: {
    endpoint: '/api/sanity-updates',
    pollInterval: 5000,    // 5 seconds
    heartbeatInterval: 30000, // 30 seconds
  },
  websocket: {
    endpoint: process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'wss://your-worker.workers.dev/ws',
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
  },
} as const;

/**
 * Pre-configured fetchers for common use cases
 */
export const fetchers = {
  /**
   * Basic fetcher - no caching, no retry
   * Use for: One-off queries, testing
   */
  basic: createEdgeSanityFetcher(sanityConfig.dataset, false),
  
  /**
   * Authenticated fetcher - includes token for draft preview
   * Use for: Preview mode, draft content
   */
  authenticated: createEdgeSanityFetcher(sanityConfig.dataset, true),
  
  /**
   * Cached fetcher - multi-layer caching with default TTL
   * Use for: Most production queries
   */
  cached: createCachedFetcher(sanityConfig.dataset, {
    ttl: cacheConfig.ttl.default,
    useRedis: cacheConfig.layers.redis.enabled,
    useNextCache: cacheConfig.layers.nextCache.enabled,
  }),
  
  /**
   * Static content fetcher - long cache TTL
   * Use for: Global settings, rarely changing content
   */
  static: createCachedFetcher(sanityConfig.dataset, {
    ttl: cacheConfig.ttl.long,
    prefix: cacheConfig.prefixes.global,
    useRedis: cacheConfig.layers.redis.enabled,
    useNextCache: true,
  }),
  
  /**
   * Dynamic content fetcher - short cache TTL with retry
   * Use for: Frequently updated content, user-specific data
   */
  dynamic: createCachedFetcher(sanityConfig.dataset, {
    ttl: cacheConfig.ttl.dynamic,
    useRedis: cacheConfig.layers.redis.enabled,
    useNextCache: false, // Skip Next.js cache for dynamic content
  }),
  
  /**
   * Page fetcher - optimized for page data
   * Use for: Full page queries
   */
  page: createCachedFetcher(sanityConfig.dataset, {
    ttl: cacheConfig.ttl.static,
    prefix: cacheConfig.prefixes.page,
    useRedis: cacheConfig.layers.redis.enabled,
    useNextCache: true,
  }),
  
  /**
   * Section fetcher - for page sections/components
   * Use for: Individual page sections
   */
  section: createCachedFetcher(sanityConfig.dataset, {
    ttl: cacheConfig.ttl.default,
    prefix: cacheConfig.prefixes.section,
    useRedis: cacheConfig.layers.redis.enabled,
    useNextCache: true,
  }),
} as const;

/**
 * Helper to create a custom fetcher with merged config
 */
export function createCustomFetcher(options: {
  dataset?: string;
  ttl?: number;
  prefix?: string;
  useAuth?: boolean;
  useCache?: boolean;
  useRetry?: boolean;
}) {
  const {
    dataset = sanityConfig.dataset,
    ttl = cacheConfig.ttl.default,
    prefix = '',
    useAuth = false,
    useCache = true,
    useRetry = false,
  } = options;
  
  if (!useCache && !useRetry) {
    return createEdgeSanityFetcher(dataset, useAuth);
  }
  
  if (useCache && !useRetry) {
    return createCachedFetcher(dataset, {
      ttl,
      prefix,
      useRedis: cacheConfig.layers.redis.enabled,
      useNextCache: cacheConfig.layers.nextCache.enabled,
    });
  }
  
  // For retry, we'd need to wrap the fetcher
  // This is a simplified version
  return async <T>(query: string, params?: any) => {
    const fetchFn = useCache 
      ? createCachedFetcher(dataset, { ttl, prefix })
      : createEdgeSanityFetcher(dataset, useAuth);
    
    if (useRetry) {
      return edgeSanityFetchWithRetry<T>(
        { dataset, query, params, useAuth },
        retryConfig
      );
    }
    
    return fetchFn<T>(query, params);
  };
}

/**
 * Queries that should be warmed on startup
 */
export const warmupQueries = [
  // Global settings
  {
    query: '*[_type == "siteSettings"][0]',
    ttl: cacheConfig.ttl.long,
    fetcher: 'static',
  },
  // Navigation
  {
    query: '*[_type == "navigation"][0]',
    ttl: cacheConfig.ttl.long,
    fetcher: 'static',
  },
  // Recent posts
  {
    query: '*[_type == "post"] | order(_createdAt desc)[0..10]',
    ttl: cacheConfig.ttl.default,
    fetcher: 'cached',
  },
  // Homepage
  {
    query: '*[_type == "page" && slug.current == "home"][0]',
    ttl: cacheConfig.ttl.static,
    fetcher: 'page',
  },
] as const;

/**
 * Export all configurations for easy access
 */
export const config = {
  sanity: sanityConfig,
  cache: cacheConfig,
  rateLimit: rateLimitConfig,
  retry: retryConfig,
  realtime: realtimeConfig,
  fetchers,
  warmupQueries,
} as const;

// Default export for convenience
export default config;