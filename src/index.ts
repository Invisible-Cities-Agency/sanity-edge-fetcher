/**
 * @file index.ts
 * @description Sanity Edge Fetcher - Next.js-native Sanity client for edge runtime
 * @author Invisible Cities Agency
 * @license MIT
 */

// Primary Next.js-aware exports (use these!)
export {
  sanityFetch,                    // Auto-detects draft mode
  sanityFetchWithFallback,        // Smart fallback to drafts
  sanityFetchStatic,              // Always CDN, no auth
  sanityFetchAuthenticated,       // Always authenticated
} from './core';

// Core functionality (for advanced use cases)
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

// Default export - the smart Next.js-aware fetcher
export { sanityFetch as default } from './core';