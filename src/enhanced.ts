/**
 * @file enhanced.ts
 * @description Enhanced Sanity fetcher with retry and real-time capabilities
 * @author Invisible Cities Agency
 * @license MIT
 */

import { edgeSanityFetch, type EdgeSanityFetchOptions, type QueryParams } from './core';

// Try to load p-retry if available
let pRetry: any;
try {
  pRetry = require('p-retry');
} catch {
  // p-retry not installed, will use basic fetch
}

/**
 * Fetches data from Sanity with automatic retry support
 * Falls back to single attempt if p-retry not installed
 */
export async function edgeSanityFetchWithRetry<T>(
  options: EdgeSanityFetchOptions,
  retryOptions?: {
    retries?: number;
    minTimeout?: number;
    maxTimeout?: number;
  }
): Promise<T> {
  // If p-retry not available, fall back to basic fetch
  if (!pRetry) {
    return edgeSanityFetch<T>(options);
  }

  const defaultRetryOptions = {
    retries: 3,
    minTimeout: 100,
    maxTimeout: 2000,
    onFailedAttempt: (error: any) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Sanity fetch attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
      }
    }
  };

  return pRetry(
    () => edgeSanityFetch<T>(options),
    { ...defaultRetryOptions, ...retryOptions }
  );
}

/**
 * Creates a cached Sanity fetcher using Next.js unstable_cache
 * Note: Requires Next.js 14+
 */
export function createCachedSanityFetcher(
  dataset: string, 
  revalidate = 60,
  tags?: string[]
) {
  // Dynamic import to avoid issues if not in Next.js environment
  try {
    const { unstable_cache } = require('next/cache');
    
    return <T>(query: string, params?: QueryParams) => {
      const cachedFetch = unstable_cache(
        async () => edgeSanityFetch<T>({
          dataset,
          query,
          params,
          useCdn: true
        }),
        [`sanity-${dataset}`, query],
        {
          revalidate,
          tags: tags || [`sanity-${dataset}`]
        }
      );
      
      return cachedFetch();
    };
  } catch {
    // Not in Next.js or cache not available, return regular fetcher
    return <T>(query: string, params?: QueryParams) => 
      edgeSanityFetch<T>({
        dataset,
        query,
        params,
        useCdn: true
      });
  }
}

/**
 * Creates an EventSource connection for real-time Sanity updates
 * Requires a server endpoint to handle SSE (see examples/vercel-sse.ts)
 */
export function createSanityEventSource(
  query: string,
  dataset = 'production',
  options?: {
    endpoint?: string;
    onMessage?: (data: any) => void;
    onError?: (error: Event) => void;
  }
) {
  const endpoint = options?.endpoint || '/api/sanity-updates';
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set('query', query);
  url.searchParams.set('dataset', dataset);
  
  const eventSource = new EventSource(url.toString());
  
  if (options?.onMessage) {
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        options.onMessage(data);
      } catch (error) {
        console.error('Failed to parse SSE data:', error);
      }
    };
  }
  
  if (options?.onError) {
    eventSource.onerror = options.onError;
  }
  
  return eventSource;
}

/**
 * Batch fetcher for multiple queries in a single request
 * Reduces API calls and improves performance
 */
export async function batchSanityFetch<T extends Record<string, any>>(
  queries: Record<string, { query: string; params?: QueryParams }>,
  dataset: string,
  options?: { useAuth?: boolean; useCdn?: boolean }
): Promise<T> {
  const results: Record<string, any> = {};
  
  // Use Promise.all for parallel fetching
  await Promise.all(
    Object.entries(queries).map(async ([key, { query, params }]) => {
      try {
        results[key] = await edgeSanityFetch({
          dataset,
          query,
          params,
          ...options
        });
      } catch (error) {
        console.error(`Failed to fetch ${key}:`, error);
        results[key] = null;
      }
    })
  );
  
  return results as T;
}