/**
 * @file nextjs.test.ts
 * @description Tests for Next.js-specific Sanity fetcher functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment variables
process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'test-project';
process.env.NEXT_PUBLIC_SANITY_DATASET = 'production';
process.env.NEXT_PUBLIC_SANITY_API_VERSION = '2025-02-10';

// Mock fetch globally
global.fetch = vi.fn();

// Mock next/headers module
vi.mock('next/headers', () => ({
  draftMode: vi.fn()
}));

describe('Next.js-aware Sanity Fetchers', () => {
  let mockDraftMode: any;
  let mockFetch: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup mocks
    const { draftMode } = await import('next/headers');
    mockDraftMode = vi.mocked(draftMode);
    mockFetch = vi.mocked(global.fetch);
    
    // Default fetch mock response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: { _id: 'test' } })
    });
  });

  describe('sanityFetch', () => {
    it('should use authenticated fetch when draft mode is enabled', async () => {
      const { sanityFetch } = await import('./core');
      mockDraftMode.mockResolvedValue({ isEnabled: true });
      
      const mockData = { _id: 'test', title: 'Draft Document' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: mockData })
      });

      const query = '*[_type == "test"][0]';
      const result = await sanityFetch(query);

      // Check that fetch was called with auth header and previewDrafts perspective
      expect(mockFetch).toHaveBeenCalled();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('perspective=previewDrafts');
      expect(result).toEqual(mockData);
    });

    it('should use CDN when draft mode is disabled', async () => {
      const { sanityFetch } = await import('./core');
      mockDraftMode.mockResolvedValue({ isEnabled: false });
      
      const mockData = { _id: 'test', title: 'Published Document' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: mockData })
      });

      const query = '*[_type == "test"][0]';
      const result = await sanityFetch(query);

      // Check that fetch was called with CDN URL
      expect(mockFetch).toHaveBeenCalled();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('apicdn.sanity.io'); // CDN URL
      expect(url).not.toContain('perspective=previewDrafts');
      expect(result).toEqual(mockData);
    });
  });

  describe('sanityFetchWithFallback', () => {
    it('should return published content when available', async () => {
      const { sanityFetchWithFallback } = await import('./core');
      mockDraftMode.mockResolvedValue({ isEnabled: false });
      
      const publishedData = { _id: 'test', title: 'Published' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: publishedData })
      });

      const result = await sanityFetchWithFallback('*[_type == "test"][0]');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(publishedData);
    });

    it('should fallback to draft when no published content exists', async () => {
      const { sanityFetchWithFallback } = await import('./core');
      mockDraftMode.mockResolvedValue({ isEnabled: false });
      
      const draftData = { _id: 'drafts.test', title: 'Draft' };
      
      // First call returns null (no published), second returns draft
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: null })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: draftData })
        });

      const result = await sanityFetchWithFallback('*[_type == "test"][0]');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      
      // First call should be to CDN
      const [firstUrl] = mockFetch.mock.calls[0];
      expect(firstUrl).toContain('apicdn.sanity.io');
      
      // Second call should be authenticated
      const [secondUrl] = mockFetch.mock.calls[1];
      expect(secondUrl).toContain('api.sanity.io');
      expect(secondUrl).toContain('perspective=previewDrafts');
      
      expect(result).toEqual(draftData);
    });

    it('should use authenticated fetch directly when in draft mode', async () => {
      const { sanityFetchWithFallback } = await import('./core');
      mockDraftMode.mockResolvedValue({ isEnabled: true });
      
      const draftData = { _id: 'drafts.test', title: 'Draft' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: draftData })
      });

      const result = await sanityFetchWithFallback('*[_type == "test"][0]');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('perspective=previewDrafts');
      expect(result).toEqual(draftData);
    });
  });

  describe('sanityFetchStatic', () => {
    it('should always use CDN without authentication', async () => {
      const { sanityFetchStatic } = await import('./core');
      
      const mockData = { _id: 'settings' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: mockData })
      });

      const result = await sanityFetchStatic('*[_type == "siteSettings"][0]');

      expect(mockFetch).toHaveBeenCalled();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('apicdn.sanity.io');
      expect(url).not.toContain('perspective=previewDrafts');
      expect(result).toEqual(mockData);
    });
  });

  describe('sanityFetchAuthenticated', () => {
    it('should always use authentication without CDN', async () => {
      const { sanityFetchAuthenticated } = await import('./core');
      
      const mockData = { _id: 'drafts.test' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: mockData })
      });

      const result = await sanityFetchAuthenticated('*[_id in path("drafts.**")]');

      expect(mockFetch).toHaveBeenCalled();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('api.sanity.io');
      expect(url).not.toContain('apicdn');
      expect(url).toContain('perspective=previewDrafts');
      expect(result).toEqual(mockData);
    });
  });

  describe('Non-Next.js environment handling', () => {
    it('should gracefully handle when Next.js is not available', async () => {
      // Mock the import to throw
      vi.doMock('next/headers', () => {
        throw new Error('Module not found');
      });
      
      const { sanityFetch } = await import('./core');
      
      const mockData = { _id: 'test' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: mockData })
      });

      // Should default to non-authenticated when Next.js not available
      const result = await sanityFetch('*[_type == "test"][0]');

      expect(mockFetch).toHaveBeenCalled();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('apicdn.sanity.io'); // Should use CDN
      expect(result).toEqual(mockData);
    });
  });
});