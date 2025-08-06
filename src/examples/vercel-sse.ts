/**
 * @file vercel-sse.ts
 * @description Server-Sent Events endpoint for real-time Sanity updates
 * 
 * Usage: Copy to app/api/sanity-updates/route.ts
 */

import { edgeSanityFetch } from '../core';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query') || '*[_type == "post"][0..10]';
  const dataset = searchParams.get('dataset') || 'production';
  
  const encoder = new TextEncoder();
  let lastCheck = new Date().toISOString();
  
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial data
      controller.enqueue(encoder.encode(': ping\n\n'));
      
      // Poll for changes every 5 seconds
      const interval = setInterval(async () => {
        try {
          // Query for recently updated documents
          const updates = await edgeSanityFetch({
            dataset,
            query: `${query} | order(_updatedAt desc) [_updatedAt > $lastCheck]`,
            params: { lastCheck },
            useCdn: false
          });
          
          if (updates && Array.isArray(updates) && updates.length > 0) {
            const data = JSON.stringify({ 
              type: 'update',
              timestamp: new Date().toISOString(),
              documents: updates 
            });
            
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            lastCheck = new Date().toISOString();
          } else {
            // Send heartbeat to keep connection alive
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          }
        } catch (error) {
          console.error('SSE fetch error:', error);
          const errorData = JSON.stringify({ 
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error'
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        }
      }, 5000);
      
      // Cleanup on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    },
  });
}

/* Client-side usage example:

import { createSanityEventSource } from '@/lib/sanity/edge-fetcher';

// Basic usage
const eventSource = createSanityEventSource('*[_type == "post"]', 'production', {
  onMessage: (data) => {
    if (data.type === 'update') {
      console.log('Documents updated:', data.documents);
      // Update your UI here
    }
  },
  onError: (error) => {
    console.error('SSE error:', error);
  }
});

// Cleanup when done
eventSource.close();

*/