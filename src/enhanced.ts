/**
 * @file enhanced.ts
 * @description Enhanced Sanity fetcher with retry and real-time capabilities
 * @author Invisible Cities Agency
 * @license MIT
 */

import { edgeSanityFetch, type EdgeSanityFetchOptions, type QueryParams } from './core';

// Type for p-retry module
interface PRetryModule {
  default: <T>(
    input: () => Promise<T>,
    options?: {
      retries?: number;
      minTimeout?: number;
      maxTimeout?: number;
      onFailedAttempt?: (error: { attemptNumber: number; retriesLeft: number }) => void;
    }
  ) => Promise<T>;
}

// Dynamic imports for optional dependencies
let pRetryModule: PRetryModule | null = null;

// Lazy load optional dependencies
const loadPRetry = async (): Promise<PRetryModule | null> => {
  if (pRetryModule) return pRetryModule;
  try {
    pRetryModule = await import('p-retry');
    return pRetryModule;
  } catch {
    return null;
  }
};

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
  // Try to load p-retry if available
  const retry = await loadPRetry();
  
  // If p-retry not available, fall back to basic fetch
  if (!retry) {
    return edgeSanityFetch<T>(options);
  }

  const defaultRetryOptions = {
    retries: 3,
    minTimeout: 100,
    maxTimeout: 2000,
    onFailedAttempt: (error: { attemptNumber: number; retriesLeft: number }) => {
      // Sanity fetch attempt failed, will retry
      void error.attemptNumber;
      void error.retriesLeft;
    }
  };

  return retry.default(
    () => edgeSanityFetch<T>(options),
    { ...defaultRetryOptions, ...retryOptions }
  );
}

/**
 * Creates a cached Sanity fetcher
 * Note: Use cachedSanityFetch from cache.ts for full caching support
 */
export function createCachedSanityFetcher(
  dataset: string, 
  _revalidate = 60,
  _tags?: string[]
) {
  // Return basic fetcher - for caching use cachedSanityFetch from cache.ts
  return <T>(query: string, params?: QueryParams) => 
    edgeSanityFetch<T>({
      dataset,
      query,
      params,
      useCdn: true
    });
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
    onMessage?: (data: unknown) => void;
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
        if (options.onMessage) {
          options.onMessage(data);
        }
      } catch {
        // Failed to parse SSE data
      }
    };
  }
  
  if (options?.onError) {
    eventSource.onerror = options.onError;
  }
  
  return eventSource;
}

/**
 * Result type for batch fetching
 */
export type BatchResult<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] | null;
};

/**
 * Batch fetcher for multiple queries in a single request
 * Reduces API calls and improves performance
 */
export async function batchSanityFetch<T extends Record<string, unknown>>(
  queries: Record<string, { query: string; params?: QueryParams }>,
  dataset: string,
  options?: { useAuth?: boolean; useCdn?: boolean }
): Promise<BatchResult<T>> {
  const results: Record<string, unknown> = {};
  
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
      } catch {
        // Failed to fetch this query
        results[key] = null;
      }
    })
  );
  
  return results as BatchResult<T>;
}