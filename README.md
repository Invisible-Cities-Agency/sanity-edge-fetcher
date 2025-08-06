# Sanity Edge Fetcher

A lightweight, Edge Runtime-compatible Sanity client for Next.js and Vercel Edge Functions.

## Why Use This Instead of @sanity/client or next-sanity?

The official Sanity clients (`@sanity/client` and `next-sanity`'s `sanityFetch`) have several limitations on Vercel's Edge Runtime:

- **Bundle Size**: Official client adds ~50KB to your bundle, this adds only **~2KB** (core) or **~6KB** (with full caching)
- **Hidden Node.js Dependencies**: `sanityFetch` appears edge-compatible but actually smuggles Node.js-specific code that can cause runtime failures on Vercel Edge Functions
- **Forced Dynamic Rendering**: Using the official client often forces pages into dynamic rendering mode, breaking static generation
- **No True Edge Support**: Despite claims, the official client isn't truly edge-compatible and relies on polyfills that increase bundle size and reduce performance

### Bundle Size Comparison

| Package | Size | Gzipped | Runtime |
|---------|------|---------|---------|
| @sanity/client | ~150KB | ~50KB | ~50KB |
| next-sanity (sanityFetch) | ~160KB | ~52KB | ~52KB |
| **edge-fetcher (core)** | **6KB** | **2KB** | **~2KB** |
| **edge-fetcher (with cache)** | **15KB** | **5KB** | **~6KB** |
| **edge-fetcher (full)** | **23KB** | **8KB** | **~6.5KB** |

**Result**: 87% smaller than official clients, with better edge compatibility!

## Features

- ✅ **True Edge Runtime compatible** - No Node.js dependencies, no polyfills, no hidden incompatibilities
- ✅ **Tiny bundle size** - ~2KB core, ~6KB with full features (87% smaller than official)
- ✅ **Vercel-optimized** - Works perfectly with Vercel Edge Functions, Middleware, and Edge Config
- ✅ **Static generation compatible** - No forced dynamic rendering, preserves ISR and SSG
- ✅ **TypeScript first** - Full type safety with generics
- ✅ **Built-in rate limiting** - Prevents 429 errors
- ✅ **Multi-layer caching** - Memory, Redis (Vercel KV/Upstash), and Next.js cache
- ✅ **Optional enhancements** - Retry, real-time updates via SSE/WebSockets

## Installation

```bash
# Core functionality only
npm install # (already in your project)

# For retry support (optional)
npm install p-retry
```

## Quick Start

### Using Pre-configured Fetchers (Recommended)

```typescript
import { fetchers } from '@/lib/sanity/edge-fetcher';

// Use pre-configured fetchers for common cases
const posts = await fetchers.cached<Post[]>('*[_type == "post"][0..10]');
const settings = await fetchers.static<Settings>('*[_type == "siteSettings"][0]');
const preview = await fetchers.authenticated<Post>('*[_type == "post"][0]');

// Page data with caching
const page = await fetchers.page<PageData>(
  '*[_type == "page" && slug.current == $slug][0]',
  { slug: 'about' }
);
```

### Direct Usage

```typescript
import { edgeSanityFetch } from '@/lib/sanity/edge-fetcher';

// Basic query
const posts = await edgeSanityFetch<Post[]>({
  dataset: 'production',
  query: '*[_type == "post"][0..10]',
  useCdn: true
});

// With parameters
const post = await edgeSanityFetch<Post>({
  dataset: 'production',
  query: '*[_type == "post" && slug.current == $slug][0]',
  params: { slug: 'my-post' }
});
```

## Enhanced Features

### Multi-Layer Caching

The edge-fetcher includes a sophisticated multi-layer caching system:

```typescript
import { cachedSanityFetch } from '@/lib/sanity/edge-fetcher';

// Fetch with automatic caching
const posts = await cachedSanityFetch<Post[]>({
  dataset: 'production',
  query: '*[_type == "post"][0..10]',
  cache: {
    ttl: 300,        // 5 minutes
    useRedis: true,  // Use Upstash if configured
    useNextCache: true // Use Next.js cache
  }
});

// Create a cached fetcher with defaults
const fetcher = createCachedFetcher('production', {
  ttl: 60,
  prefix: 'blog:'
});

// Check cache status
const status = getCacheStatus();
console.log('Cache layers:', status);
// { memory: { available: true, size: 5 }, 
//   redis: { available: true, configured: true },
//   nextCache: { available: true } }

// Warm cache on startup
await warmSanityCache([
  { dataset: 'production', query: '*[_type == "post"][0..10]', ttl: 3600 },
  { dataset: 'production', query: '*[_type == "author"]', ttl: 7200 }
]);

// Clear cache when content updates
await clearSanityCache({ dataset: 'production' });
```

#### Cache Layers (in order):
1. **In-memory LRU** (~1ms) - Ultra-fast, limited size
2. **Upstash Redis** (~10-30ms) - Distributed, persistent
3. **Next.js Cache** - ISR and static generation

#### Required Environment Variables for Redis:
```bash
# Option 1: Vercel KV (Upstash)
KV_REST_API_URL=https://your-instance.upstash.io
KV_REST_API_TOKEN=your-token
KV_REST_API_READ_ONLY_TOKEN=your-read-token # Optional

# Option 2: Direct Upstash
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

### Automatic Retry

If `p-retry` is installed, use the enhanced fetcher:

```typescript
import { edgeSanityFetchWithRetry } from '@/lib/sanity/edge-fetcher';

const posts = await edgeSanityFetchWithRetry<Post[]>(
  {
    dataset: 'production',
    query: '*[_type == "post"]'
  },
  {
    retries: 3,
    minTimeout: 100,
    maxTimeout: 2000
  }
);
```

### Cached Fetcher

Leverage Next.js caching:

```typescript
import { createCachedSanityFetcher } from '@/lib/sanity/edge-fetcher';

const fetcher = createCachedSanityFetcher('production', 60); // 60s cache
const posts = await fetcher<Post[]>('*[_type == "post"]');
```

### Batch Fetching

Fetch multiple queries in parallel:

```typescript
import { batchSanityFetch } from '@/lib/sanity/edge-fetcher';

const data = await batchSanityFetch({
  posts: { query: '*[_type == "post"][0..10]' },
  authors: { query: '*[_type == "author"]' },
  categories: { query: '*[_type == "category"]' }
}, 'production');

// data.posts, data.authors, data.categories
```

## Real-time Updates

### Server-Sent Events (Vercel)

1. Copy `examples/vercel-sse.ts` to `app/api/sanity-updates/route.ts`
2. Use the client helper:

```typescript
import { createSanityEventSource } from '@/lib/sanity/edge-fetcher';

const eventSource = createSanityEventSource('*[_type == "post"]', 'production', {
  onMessage: (data) => {
    if (data.type === 'update') {
      console.log('Documents updated:', data.documents);
      // Update your UI
    }
  },
  onError: (error) => {
    console.error('SSE error:', error);
  }
});

// Cleanup when done
eventSource.close();
```

### WebSockets (Cloudflare)

1. Deploy `examples/cloudflare-websocket.ts` as a Cloudflare Worker
2. Connect from client:

```typescript
const ws = new WebSocket('wss://your-worker.workers.dev/ws');

ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'update') {
    // Handle updates
  }
});
```

## Configuration

All configuration is centralized in `config.ts`:

```typescript
import { config, fetchers, createCustomFetcher } from '@/lib/sanity/edge-fetcher';

// Access configuration
console.log(config.cache.ttl.default);  // 60 seconds
console.log(config.sanity.projectId);   // From env vars

// Use pre-configured fetchers
const posts = await fetchers.cached('*[_type == "post"]');
const settings = await fetchers.static('*[_type == "siteSettings"][0]');

// Create custom fetcher
const myFetcher = createCustomFetcher({
  ttl: 300,
  prefix: 'custom:',
  useCache: true,
  useRetry: true
});
```

### Available Fetchers

| Fetcher | Use Case | Cache TTL | Features |
|---------|----------|-----------|----------|
| `basic` | Testing, one-off queries | None | No cache, no retry |
| `authenticated` | Draft preview | None | Auth token included |
| `cached` | Most queries | 60s | Multi-layer cache |
| `static` | Global settings | 24h | Long cache, Redis |
| `dynamic` | User data | 30s | Short cache, no Next.js |
| `page` | Full pages | 1h | Page-optimized cache |
| `section` | Page sections | 60s | Component cache |

## Environment Variables

Required:
- `NEXT_PUBLIC_SANITY_PROJECT_ID` - Your Sanity project ID
- `NEXT_PUBLIC_SANITY_API_VERSION` - API version (e.g., '2025-02-10')

Optional:
- `SANITY_VIEWER_TOKEN` - For authenticated requests (draft preview)
- `NEXT_PUBLIC_SANITY_DATASET` - Dataset name (default: 'production')

For Redis caching (optional):
- `KV_REST_API_URL` or `UPSTASH_REDIS_REST_URL`
- `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN` (optional, for read-only operations)

## API Reference

### Core Functions

#### `edgeSanityFetch<T>(options)`

Main fetching function.

**Options:**
- `dataset: string` - Sanity dataset name
- `query: string` - GROQ query
- `params?: object` - Query parameters
- `useCdn?: boolean` - Use Sanity CDN (default: false)
- `useAuth?: boolean` - Include auth token (default: false)

**Returns:** `Promise<T>` - Query result

#### `createEdgeSanityFetcher(dataset, useAuth?)`

Creates a reusable fetcher for a specific dataset.

### Enhanced Functions

#### `edgeSanityFetchWithRetry<T>(options, retryOptions?)`

Fetch with automatic retry (requires p-retry).

#### `createCachedSanityFetcher(dataset, revalidate?, tags?)`

Creates a cached fetcher using Next.js cache.

#### `batchSanityFetch<T>(queries, dataset, options?)`

Fetch multiple queries in parallel.

#### `createSanityEventSource(query, dataset?, options?)`

Create SSE connection for real-time updates.

## Trade-offs vs Official Client

| Feature | Edge Fetcher | Official Client |
|---------|-------------|-----------------|
| Bundle Size | ~2KB | ~50KB |
| Edge Runtime | ✅ | ❌ |
| Static Generation | ✅ | ⚠️ (with config) |
| Auto Retry | ⚠️ (with p-retry) | ✅ |
| Response Cache | ⚠️ (via Next.js) | ✅ |
| Real-time | ⚠️ (via SSE/WS) | ✅ |
| Mutations | ❌ | ✅ |
| Assets | ❌ | ✅ |

## Migration from Official Client

```typescript
// Before (official client)
import { client } from '@/lib/sanity/client';
const posts = await client.fetch('*[_type == "post"]');

// After (edge fetcher)
import { edgeSanityFetch } from '@/lib/sanity/edge-fetcher';
const posts = await edgeSanityFetch({
  dataset: 'production',
  query: '*[_type == "post"]'
});
```

## License

MIT © Invisible Cities Agency

## Contributing

Feel free to submit issues and PRs. This is a focused utility, so features should maintain Edge Runtime compatibility.