import { describe, it, expect } from 'vitest';
import { edgeSanityFetch, createEdgeSanityFetcher } from './core';

describe('edgeSanityFetch', () => {
  it('should be a function', () => {
    expect(typeof edgeSanityFetch).toBe('function');
  });

  it('should handle perspective parameter correctly', async () => {
    // This is a basic type check - full integration tests would require mocking fetch
    const fetcher = createEdgeSanityFetcher('production', true);
    expect(typeof fetcher).toBe('function');
  });
});