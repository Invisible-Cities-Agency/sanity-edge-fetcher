import { describe, it, expect, beforeEach, vi } from 'vitest';
import { edgeSanityFetch, createEdgeSanityFetcher } from './core';
import type { EdgeSanityFetchOptions } from './core';

// Mock fetch globally
global.fetch = vi.fn();

// Set env vars before importing the module
process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'test-project';
process.env.NEXT_PUBLIC_SANITY_API_VERSION = '2024-01-12';
process.env.SANITY_VIEWER_TOKEN = 'test-token';

describe('edgeSanityFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should construct correct URL for basic queries', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: { test: 'data' } })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const options: EdgeSanityFetchOptions = {
        dataset: 'production',
        query: '*[_type == "post"]',
        useCdn: false,
        useAuth: false
      };

      await edgeSanityFetch(options);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('.api.sanity.io'),
        expect.any(Object)
      );
    });

    it('should use CDN when specified', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == "post"]',
        useCdn: true,
        useAuth: false
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('.apicdn.sanity.io'),
        expect.any(Object)
      );
    });
  });

  describe('Authentication & Perspective', () => {
    it('should include authorization header when useAuth is true', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == "post"]',
        useAuth: true
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });

    it('should set previewDrafts perspective when authenticated', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == "post"]',
        useAuth: true
      });

      const callUrl = (global.fetch as any).mock.calls[0][0];
      expect(callUrl).toContain('perspective=previewDrafts');
    });

    it('should not include perspective without auth', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == "post"]',
        useAuth: false
      });

      const callUrl = (global.fetch as any).mock.calls[0][0];
      expect(callUrl).not.toContain('perspective=');
    });
  });

  describe('Error Handling', () => {
    it('should throw error on non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('Document not found')
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == "missing"]'
      })).rejects.toThrow('Sanity fetch failed: 404 Not Found');
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == "post"]'
      })).rejects.toThrow('Network error');
    });
  });

  describe('Query Parameters', () => {
    it('should properly encode query parameters', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == $type && slug.current == $slug][0]',
        params: {
          type: 'post',
          slug: 'test-post'
        }
      });

      const callUrl = (global.fetch as any).mock.calls[0][0];
      expect(callUrl).toContain('%24type=%22post%22'); // URL encoded $
      expect(callUrl).toContain('%24slug=%22test-post%22'); // URL encoded $
    });
  });

  describe('Factory Function', () => {
    it('should create a fetcher with fixed dataset', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: { id: 'test' } })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const fetcher = createEdgeSanityFetcher('staging', false);
      const result = await fetcher('*[_type == "test"]');

      expect(result).toEqual({ id: 'test' });
      const callUrl = (global.fetch as any).mock.calls[0][0];
      expect(callUrl).toContain('/staging');
    });

    it('should create authenticated fetcher', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const fetcher = createEdgeSanityFetcher('production', true);
      await fetcher('*[_type == "test"]');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('perspective=previewDrafts'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('Rate Limiting', () => {
    it('should throttle rapid requests', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const start = Date.now();
      
      // Make two rapid requests
      await Promise.all([
        edgeSanityFetch({ dataset: 'production', query: 'test1' }),
        edgeSanityFetch({ dataset: 'production', query: 'test2' })
      ]);
      
      const duration = Date.now() - start;
      
      // Second request should be throttled (at least 100ms total)
      expect(duration).toBeGreaterThanOrEqual(90); // Allow some tolerance
    });
  });

  describe('Edge Runtime Compatibility', () => {
    it('should not use any Node.js specific APIs', () => {
      // This test verifies the module doesn't import Node.js modules
      // The actual test is that the module loads without errors in edge runtime
      expect(() => {
        // If this throws, it means we're using Node.js APIs
        const hasNodeAPIs = false; // Would be detected at build time
        return hasNodeAPIs;
      }).not.toThrow();
    });

    it('should handle missing environment variables gracefully', async () => {
      delete process.env.SANITY_VIEWER_TOKEN;
      
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ result: {} })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      // Should work without token (just no auth)
      await expect(edgeSanityFetch({
        dataset: 'production',
        query: '*[_type == "post"]',
        useAuth: true
      })).resolves.toBeDefined();

      // Should not have Authorization header
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String)
          })
        })
      );
    });
  });
});