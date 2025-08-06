/**
 * @file cloudflare-websocket.ts
 * @description WebSocket endpoint for real-time Sanity updates using Cloudflare Workers
 * 
 * Usage: Deploy as a Cloudflare Worker or use with Cloudflare Pages Functions
 * Requires: Durable Objects for WebSocket state management
 */

interface Env {
  SANITY_UPDATES: DurableObjectNamespace;
  SANITY_PROJECT_ID: string;
  SANITY_DATASET: string;
  SANITY_API_VERSION: string;
  SANITY_VIEWER_TOKEN?: string;
}

// Durable Object to manage WebSocket connections
export class SanityUpdateHandler {
  state: DurableObjectState;
  clients: Set<WebSocket>;
  pollInterval?: number;
  lastCheck: string;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.clients = new Set();
    this.lastCheck = new Date().toISOString();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    
    this.clients.add(server);
    server.accept();

    // Start polling if not already running
    if (!this.pollInterval) {
      this.startPolling();
    }

    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        
        if (data.type === 'subscribe') {
          // Handle subscription to specific queries
          await this.handleSubscription(server, data.query);
        }
      } catch (error) {
        server.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid message format' 
        }));
      }
    });

    server.addEventListener('close', () => {
      this.clients.delete(server);
      
      // Stop polling if no clients
      if (this.clients.size === 0 && this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = undefined;
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private startPolling() {
    this.pollInterval = setInterval(async () => {
      await this.checkForUpdates();
    }, 5000) as unknown as number;
  }

  private async checkForUpdates() {
    const env = this.state.env as unknown as Env;
    
    try {
      const url = new URL(
        `https://${env.SANITY_PROJECT_ID}.api.sanity.io/v${env.SANITY_API_VERSION}/data/query/${env.SANITY_DATASET}`
      );
      
      const query = `*[_updatedAt > $lastCheck] | order(_updatedAt desc)[0..50]`;
      url.searchParams.set('query', query);
      url.searchParams.set('$lastCheck', JSON.stringify(this.lastCheck));
      
      const headers: HeadersInit = {
        'Accept': 'application/json',
      };
      
      if (env.SANITY_VIEWER_TOKEN) {
        headers['Authorization'] = `Bearer ${env.SANITY_VIEWER_TOKEN}`;
      }
      
      const response = await fetch(url.toString(), { headers });
      
      if (!response.ok) {
        throw new Error(`Sanity fetch failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.result && data.result.length > 0) {
        const message = JSON.stringify({
          type: 'update',
          timestamp: new Date().toISOString(),
          documents: data.result
        });
        
        // Broadcast to all connected clients
        for (const client of this.clients) {
          try {
            client.send(message);
          } catch {
            // Client disconnected, remove it
            this.clients.delete(client);
          }
        }
        
        this.lastCheck = new Date().toISOString();
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }

  private async handleSubscription(client: WebSocket, query: string) {
    // Implement query-specific subscriptions if needed
    client.send(JSON.stringify({
      type: 'subscribed',
      query,
      message: 'Subscription active'
    }));
  }
}

// Worker entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/ws') {
      // Get or create a Durable Object instance
      const id = env.SANITY_UPDATES.idFromName('global');
      const durableObject = env.SANITY_UPDATES.get(id);
      
      // Forward the request to the Durable Object
      return durableObject.fetch(request);
    }
    
    return new Response('WebSocket endpoint: /ws', { status: 200 });
  }
};

/* Client-side usage example:

const ws = new WebSocket('wss://your-worker.workers.dev/ws');

ws.addEventListener('open', () => {
  console.log('Connected to Sanity updates');
  
  // Subscribe to specific queries (optional)
  ws.send(JSON.stringify({
    type: 'subscribe',
    query: '*[_type == "post"]'
  }));
});

ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'update') {
    console.log('Documents updated:', data.documents);
    // Update your UI here
  }
});

ws.addEventListener('error', (error) => {
  console.error('WebSocket error:', error);
});

// Cleanup
ws.close();

*/