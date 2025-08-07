/**
 * @file core.ts
 * @description Next.js-native, edge-compatible Sanity data fetcher
 * @author Invisible Cities Agency
 * @license MIT
 */

// Helper to check if draft mode is enabled in Next.js
async function isDraftModeEnabled(): Promise<boolean> {
  try {
    // Dynamic import to avoid build issues in non-Next.js environments
    const { draftMode } = await import('next/headers');
    const draft = await draftMode();
    return draft.isEnabled;
  } catch {
    // Not in Next.js or draft mode not available
    return false;
  }
}

// Get config from environment variables
const getProjectId = () => {
  const id = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  if (!id) {
    throw new Error('NEXT_PUBLIC_SANITY_PROJECT_ID environment variable is required');
  }
  return id;
};

const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2025-02-10';

// Get the viewer token - check multiple possible env vars
const getViewerToken = () => {
  return process.env.SANITY_VIEWER_TOKEN || 
         process.env.SANITY_API_READ_TOKEN ||
         process.env.NEXT_PUBLIC_SANITY_VIEWER_TOKEN;
};

export type QueryParams = Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>>;

export interface EdgeSanityFetchOptions {
  /** Sanity dataset to query (e.g., 'production', 'staging') */
  dataset: string;
  /** GROQ query string */
  query: string;
  /** Optional query parameters for GROQ placeholders */
  params?: QueryParams;
  /** Whether to use Sanity's CDN (faster but no auth) */
  useCdn?: boolean;
  /** Whether to include auth token for draft preview access */
  useAuth?: boolean;
}

/**
 * Simple rate limiter to prevent 429 errors
 * @internal
 */
class EdgeRateLimiter {
  private lastRequest = 0;
  private readonly minInterval = 100; // 10 req/sec max

  async throttle(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;

    if (timeSinceLastRequest < this.minInterval) {
      const delay = this.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequest = Date.now();
  }
}

const rateLimiter = new EdgeRateLimiter();

/**
 * Fetches data from Sanity using native fetch API
 * Compatible with Edge Runtime and static generation
 */
export async function edgeSanityFetch<T>({
  dataset,
  query,
  params = {},
  useCdn = false,
  useAuth = false
}: EdgeSanityFetchOptions): Promise<T> {
  // Apply rate limiting
  await rateLimiter.throttle();

  // Build the query URL
  const projectId = getProjectId();
  const baseUrl = useCdn
    ? `https://${projectId}.apicdn.sanity.io`
    : `https://${projectId}.api.sanity.io`;

  const url = new URL(`${baseUrl}/v${apiVersion}/data/query/${dataset}`);
  url.searchParams.set('query', query);
  
  if (useAuth) {
    // Use 'previewDrafts' perspective to see draft documents merged with published
    url.searchParams.set('perspective', 'previewDrafts');
  }

  // Add parameters
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(`$${key}`, JSON.stringify(value));
  });

  // Build headers
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  // Use env var for auth to maintain static generation compatibility
  if (useAuth) {
    const envToken = getViewerToken();
    if (envToken) {
      headers['Authorization'] = `Bearer ${envToken}`;
    }
  }
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    await response.text(); // Consume the body to prevent memory leak
    throw new Error(`Sanity fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.result;
}

/**
 * Factory function to create a typed Sanity fetcher for a given dataset
 */
export function createEdgeSanityFetcher(dataset: string, useAuth = false) {
  return <T>(query: string, params?: QueryParams) => {
    const options: EdgeSanityFetchOptions = {
      dataset,
      query,
      useAuth,
      ...(params !== undefined ? { params } : {}),
    };
    return edgeSanityFetch<T>(options);
  };
}

/**
 * Next.js-aware Sanity fetcher that automatically handles draft mode
 * This is the primary fetcher for Next.js applications
 * 
 * @example
 * const data = await sanityFetch('*[_type == "post"][0]');
 */
export async function sanityFetch<T = any>(
  query: string,
  params?: QueryParams,
  options?: {
    dataset?: string;
    /** Override automatic draft mode detection */
    forceAuth?: boolean;
  }
): Promise<T> {
  const dataset = options?.dataset || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production';
  const useAuth = options?.forceAuth ?? await isDraftModeEnabled();
  
  return edgeSanityFetch<T>({
    dataset,
    query,
    params,
    useCdn: !useAuth, // Use CDN when not authenticated
    useAuth,
  });
}

/**
 * Sanity fetcher with automatic draft fallback
 * Tries to fetch published content first, falls back to drafts if empty
 * Perfect for singleton documents that might only exist as drafts
 * 
 * @example
 * const page = await sanityFetchWithFallback('*[_type == "page" && slug.current == $slug][0]', { slug });
 */
export async function sanityFetchWithFallback<T = any>(
  query: string,
  params?: QueryParams,
  options?: {
    dataset?: string;
    /** Log when falling back to drafts */
    logFallback?: boolean;
  }
): Promise<T> {
  const dataset = options?.dataset || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production';
  const isNextDraftMode = await isDraftModeEnabled();
  
  // If already in draft mode, just use authenticated fetch
  if (isNextDraftMode) {
    return edgeSanityFetch<T>({
      dataset,
      query,
      params,
      useCdn: false,
      useAuth: true,
    });
  }
  
  // Try published content first
  const publishedResult = await edgeSanityFetch<T>({
    dataset,
    query,
    params,
    useCdn: true,
    useAuth: false,
  });
  
  // If we got content, return it
  if (publishedResult) {
    return publishedResult;
  }
  
  // No published content, try drafts
  if (options?.logFallback !== false && process.env.NODE_ENV !== 'production') {
    console.log('[sanityFetchWithFallback] No published content found, checking for drafts...');
  }
  
  const draftResult = await edgeSanityFetch<T>({
    dataset,
    query,
    params,
    useCdn: false,
    useAuth: true,
  });
  
  if (draftResult && options?.logFallback !== false && process.env.NODE_ENV !== 'production') {
    console.log('[sanityFetchWithFallback] Draft content found and returned');
  }
  
  return draftResult;
}

/**
 * Static content fetcher - always uses CDN, never authenticates
 * Use for global settings and content that rarely changes
 * 
 * @example
 * const settings = await sanityFetchStatic('*[_type == "siteSettings"][0]');
 */
export async function sanityFetchStatic<T = any>(
  query: string,
  params?: QueryParams,
  dataset?: string
): Promise<T> {
  return edgeSanityFetch<T>({
    dataset: dataset || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
    query,
    params,
    useCdn: true,
    useAuth: false,
  });
}

/**
 * Authenticated fetcher - always uses authentication
 * Use when you need to ensure draft content is visible
 * 
 * @example
 * const drafts = await sanityFetchAuthenticated('*[_type == "post" && _id in path("drafts.**")]');
 */
export async function sanityFetchAuthenticated<T = any>(
  query: string,
  params?: QueryParams,
  dataset?: string
): Promise<T> {
  return edgeSanityFetch<T>({
    dataset: dataset || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
    query,
    params,
    useCdn: false,
    useAuth: true,
  });
}