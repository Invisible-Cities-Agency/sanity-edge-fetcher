/**
 * @file index.ts
 * @description Sanity Edge Fetcher - Edge-compatible Sanity client
 * @author Invisible Cities Agency
 * @license MIT
 */

// Core functionality
export {
  edgeSanityFetch,
  createEdgeSanityFetcher,
  type EdgeSanityFetchOptions,
  type QueryParams
} from './core';

// Enhanced functionality
export {
  edgeSanityFetchWithRetry,
  createCachedSanityFetcher,
  createSanityEventSource,
  batchSanityFetch
} from './enhanced';

// Caching functionality
export {
  cachedSanityFetch,
  createCachedFetcher,
  clearSanityCache,
  warmSanityCache,
  getCacheStatus
} from './cache';

// Default export for simple cases
export { edgeSanityFetch as default } from './core';