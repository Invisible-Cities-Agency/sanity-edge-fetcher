/**
 * @file index.ts
 * @description Sanity Edge Fetcher - Edge-compatible Sanity client
 * @author Ian Armstrong
 * @license MIT
 */

// Core functionality
export {
  edgeSanityFetch,
  createEdgeSanityFetcher,
  type EdgeSanityFetchOptions,
  type QueryParams
} from './src/core';

// Enhanced functionality
export {
  edgeSanityFetchWithRetry,
  createCachedSanityFetcher,
  createSanityEventSource,
  batchSanityFetch
} from './src/enhanced';

// Caching functionality
export {
  cachedSanityFetch,
  createCachedFetcher,
  clearSanityCache,
  warmSanityCache,
  getCacheStatus
} from './src/cache';

// Configuration
export {
  config,
  sanityConfig,
  cacheConfig,
  fetchers,
  createCustomFetcher,
  warmupQueries
} from './config';

// Default export for simple cases
export { edgeSanityFetch as default } from './src/core';