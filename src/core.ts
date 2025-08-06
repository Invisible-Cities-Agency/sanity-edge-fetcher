/**
 * @file core.ts
 * @description Edge-compatible Sanity data fetcher core
 * @author Invisible Cities Agency
 * @license MIT
 */

// Get config from environment variables
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2025-02-10';

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
  const baseUrl = useCdn
    ? `https://${projectId}.apicdn.sanity.io`
    : `https://${projectId}.api.sanity.io`;

  const url = new URL(`${baseUrl}/v${apiVersion}/data/query/${dataset}`);
  url.searchParams.set('query', query);
  
  if (useAuth) {
    url.searchParams.set('perspective', 'previewDrafts');
    url.searchParams.set('visibility', 'query');
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
    const envToken = process.env.SANITY_VIEWER_TOKEN;
    if (envToken) {
      headers['Authorization'] = `Bearer ${envToken}`;
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
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