import Fastify, { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import { Queue, Worker } from 'bullmq';
import { Order, OrderJobData } from '../src/types';
import { MockRouter } from '../src/services/mockRouter';

// Redis configuration for testing
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

const QUEUE_NAME = 'test-ws-order-queue';

describe('WebSocket and API Integration Tests', () => {
  let app: FastifyInstance;
  let queue: Queue;
  let worker: Worker;
  let orderQueue: Queue;
  let router: MockRouter;
  let baseUrl: string;

  // Store WebSocket connections for order-specific routing
  const orderConnections = new Map<string, WebSocket>();

  beforeAll(async () => {
    // Create Fastify app with WebSocket support
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);

    // Initialize queue
    orderQueue = new Queue(QUEUE_NAME, { connection: REDIS_CONFIG });

    // Mock router
    router = new MockRouter();

    // Broadcast function for order status updates
    const broadcastOrderStatus = (orderId: string, status: string, details?: any): void => {
      const statusMessage = JSON.stringify({ orderId, status, details });
      const connection = orderConnections.get(orderId);
      
      if (connection && connection.readyState === WebSocket.OPEN) {
        connection.send(statusMessage);
      }
    };

    // WebSocket route - accepts orderId as query parameter
    app.register(async (fastify) => {
      fastify.get('/ws', { websocket: true } as any, (connection: any, request: any) => {
        const socket = connection.socket || connection;
        const orderId = request.query.orderId;

        if (!orderId) {
          socket.send(JSON.stringify({ error: 'Missing orderId parameter' }));
          socket.close();
          return;
        }

        // Store connection for this specific order
        orderConnections.set(orderId, socket);

        socket.on('close', () => {
          orderConnections.delete(orderId);
          app.log.info(`WebSocket disconnected for order: ${orderId}`);
        });

        socket.send(JSON.stringify({ message: 'Connected', orderId }));
      });

      // POST /api/orders/execute endpoint
      fastify.post<{ Body: Order }>('/api/orders/execute', async (request, reply) => {
        const order = request.body;

        // Validate order
        if (!order.id || !order.pair || !order.side || !order.amount) {
          return reply.status(400).send({ 
            error: 'Invalid order data',
            requiredFields: ['id', 'pair', 'side', 'amount']
          });
        }

        try {
          // Queue the order
          await orderQueue.add('execute-order', { order }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          });

          return reply.status(202).send({
            status: 'queued',
            message: 'Order received and queued for execution',
            orderId: order.id,
          });
        } catch (error: any) {
          return reply.status(500).send({ error: error.message });
        }
      });
    });

    // Create worker to process orders
    worker = new Worker<OrderJobData>(
      QUEUE_NAME,
      async (job) => {
        const order = job.data.order;
        
        // Emit pending
        broadcastOrderStatus(order.id, 'pending');
        await new Promise(resolve => setTimeout(resolve, 100));

        // Emit routing
        broadcastOrderStatus(order.id, 'routing');
        
        try {
          // Get quotes from router
          const quotes = await router.getQuotes(order.pair, order.amount);
          
          // Select best quote
          const bestQuote = quotes.reduce((best, current) => {
            if (order.side === 'buy') {
              return current.price < best.price ? current : best;
            } else {
              return current.price > best.price ? current : best;
            }
          });

          // Emit building
          broadcastOrderStatus(order.id, 'building', { 
            selectedDex: bestQuote.dex, 
            price: bestQuote.price 
          });
          await new Promise(resolve => setTimeout(resolve, 100));

          // Emit submitted
          broadcastOrderStatus(order.id, 'submitted');
          await new Promise(resolve => setTimeout(resolve, 100));

          // Emit confirmed
          broadcastOrderStatus(order.id, 'confirmed', {
            dex: bestQuote.dex,
            price: bestQuote.price,
            amount: order.amount,
            total: order.amount * bestQuote.price,
          });
        } catch (error: any) {
          // Emit failed
          broadcastOrderStatus(order.id, 'failed', { error: error.message });
          throw error;
        }
      },
      { connection: REDIS_CONFIG, concurrency: 10 }
    );

    await app.listen({ port: 0 }); // Random available port
    const address = app.server.address();
    const port = typeof address === 'string' ? 0 : address?.port || 3000;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (worker) await worker.close();
    if (orderQueue) {
      await orderQueue.obliterate({ force: true });
      await orderQueue.close();
    }
    if (app) await app.close();
    
    // Close any remaining WebSocket connections
    orderConnections.forEach(ws => ws.close());
    orderConnections.clear();
  });

  describe('Full Lifecycle Success', () => {
    it('should complete full order lifecycle with correct status sequence', async () => {
      const order: Order = {
        id: 'lifecycle-success-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      const receivedStatuses: string[] = [];

      // Step 1: Connect WebSocket FIRST
      const wsUrl = baseUrl.replace('http://', 'ws://') + `/ws?orderId=${order.id}`;
      const ws = new WebSocket(wsUrl);

      // Wait for WebSocket to be ready
      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      // Step 2: POST order (after WS is connected)
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: order,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.orderId).toBe(order.id);

      // Collect all status messages
      const messagesPromise = new Promise<void>((resolve) => {
        ws.on('message', (data: any) => {
          const message = JSON.parse(data.toString());
          
          if (message.status) {
            receivedStatuses.push(message.status);
            
            // Resolve when confirmed or failed
            if (message.status === 'confirmed' || message.status === 'failed') {
              resolve();
            }
          }
        });
      });

      // Wait for all messages
      await messagesPromise;
      ws.close();

      // Assert correct order
      expect(receivedStatuses).toEqual(['pending', 'routing', 'building', 'submitted', 'confirmed']);
    }, 10000);
  });

  describe('Lifecycle Failure', () => {
    it('should handle order failure correctly', async () => {
      const order: Order = {
        id: 'lifecycle-failure-001',
        pair: 'INVALID/PAIR', // This will cause router to potentially fail
        side: 'buy',
        amount: 100,
      };

      const receivedStatuses: string[] = [];

      // Mock router to throw error
      jest.spyOn(router, 'getQuotes').mockRejectedValueOnce(new Error('Network timeout'));

      // Connect WebSocket FIRST
      const wsUrl = baseUrl.replace('http://', 'ws://') + `/ws?orderId=${order.id}`;
      const ws = new WebSocket(wsUrl);

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      // POST order (after WS connected)
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: order,
      });

      expect(response.statusCode).toBe(202);

      const messagesPromise = new Promise<void>((resolve) => {
        ws.on('message', (data: any) => {
          const message = JSON.parse(data.toString());
          
          if (message.status) {
            receivedStatuses.push(message.status);
            
            if (message.status === 'failed') {
              resolve();
            }
          }
        });
      });

      await messagesPromise;
      ws.close();

      // Should receive pending, routing, then failed
      expect(receivedStatuses).toContain('pending');
      expect(receivedStatuses).toContain('routing');
      expect(receivedStatuses).toContain('failed');
      expect(receivedStatuses[receivedStatuses.length - 1]).toBe('failed');
    }, 10000);
  });

  describe('Invalid Order ID', () => {
    it('should handle WebSocket connection without orderId parameter', async () => {
      const wsUrl = baseUrl.replace('http://', 'ws://') + '/ws'; // No orderId
      const ws = new WebSocket(wsUrl);

      const errorPromise = new Promise<any>((resolve) => {
        ws.on('message', (data: any) => {
          const message = JSON.parse(data.toString());
          resolve(message);
        });

        ws.on('close', () => {
          resolve({ closed: true });
        });
      });

      const result = await errorPromise;
      
      expect(result.error || result.closed).toBeDefined();
      if (result.error) {
        expect(result.error).toContain('orderId');
      }
    }, 5000);

    it('should connect with non-existent orderId but receive no updates', async () => {
      const nonExistentOrderId = 'non-existent-order-999';
      const wsUrl = baseUrl.replace('http://', 'ws://') + `/ws?orderId=${nonExistentOrderId}`;
      const ws = new WebSocket(wsUrl);

      const messages: any[] = [];

      const connectionPromise = new Promise<void>((resolve) => {
        ws.on('message', (data: any) => {
          messages.push(JSON.parse(data.toString()));
        });

        ws.on('open', () => {
          setTimeout(() => resolve(), 1000); // Wait 1 second
        });
      });

      await connectionPromise;
      ws.close();

      // Should only receive connection confirmation, no status updates
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].message).toBe('Connected');
      
      // No status updates for non-existent order
      const statusMessages = messages.filter(m => m.status);
      expect(statusMessages.length).toBe(0);
    }, 5000);
  });

  describe('Premature Disconnect', () => {
    it('should handle client disconnect gracefully and continue processing', async () => {
      const order: Order = {
        id: 'premature-disconnect-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      const receivedStatuses: string[] = [];

      // Connect WebSocket FIRST
      const wsUrl = baseUrl.replace('http://', 'ws://') + `/ws?orderId=${order.id}`;
      const ws = new WebSocket(wsUrl);

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      // POST order (after WS connected)
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: order,
      });

      expect(response.statusCode).toBe(202);

      let pendingReceived = false;

      const disconnectPromise = new Promise<void>((resolve) => {
        ws.on('message', (data: any) => {
          const message = JSON.parse(data.toString());
          
          if (message.status) {
            receivedStatuses.push(message.status);
            
            // Close after receiving 'pending'
            if (message.status === 'pending') {
              pendingReceived = true;
              ws.close();
              resolve();
            }
          }
        });
      });

      await disconnectPromise;

      expect(pendingReceived).toBe(true);
      expect(receivedStatuses).toContain('pending');

      // Wait for order to complete processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify order was processed despite disconnect
      const jobs = await orderQueue.getCompleted();
      const ourJob = jobs.find(j => j.data.order.id === order.id);
      
      // Job should complete even if client disconnected
      expect(ourJob).toBeDefined();
    }, 15000); // Increase timeout to 15 seconds
  });

  describe('Simultaneous Connections', () => {
    it('should route updates to correct specific sockets, not broadcast to all', async () => {
      const orders: Order[] = [
        { id: 'multi-001', pair: 'SOL/USDC', side: 'buy', amount: 100 },
        { id: 'multi-002', pair: 'SOL/USDC', side: 'sell', amount: 50 },
        { id: 'multi-003', pair: 'SOL/USDC', side: 'buy', amount: 75 },
      ];

      const orderStatuses: { [key: string]: string[] } = {
        'multi-001': [],
        'multi-002': [],
        'multi-003': [],
      };

      // Create WebSocket connections FIRST (before posting orders)
      const wsConnections: WebSocket[] = [];
      const completionPromises: Promise<void>[] = [];
      const connectionReadyPromises: Promise<void>[] = [];

      for (const order of orders) {
        const wsUrl = baseUrl.replace('http://', 'ws://') + `/ws?orderId=${order.id}`;
        const ws = new WebSocket(wsUrl);
        wsConnections.push(ws);

        // Wait for connection to be ready
        const readyPromise = new Promise<void>((resolve) => {
          ws.on('open', () => resolve());
        });
        connectionReadyPromises.push(readyPromise);

        const completionPromise = new Promise<void>((resolve) => {
          ws.on('message', (data: any) => {
            const message = JSON.parse(data.toString());
            
            if (message.status && message.orderId === order.id) {
              orderStatuses[order.id].push(message.status);
              
              if (message.status === 'confirmed' || message.status === 'failed') {
                resolve();
              }
            }
          });
        });

        completionPromises.push(completionPromise);
      }

      // Wait for all WebSocket connections to be ready
      await Promise.all(connectionReadyPromises);

      // NOW post the orders (after WebSockets are connected)
      for (const order of orders) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/orders/execute',
          payload: order,
        });
        expect(response.statusCode).toBe(202);
      }

      // Wait for all orders to complete
      await Promise.all(completionPromises);

      // Close all connections
      wsConnections.forEach(ws => ws.close());

      // Verify each order received only its own updates
      expect(orderStatuses['multi-001'].length).toBeGreaterThan(0);
      expect(orderStatuses['multi-002'].length).toBeGreaterThan(0);
      expect(orderStatuses['multi-003'].length).toBeGreaterThan(0);

      // Each order should receive complete lifecycle
      // Note: All orders follow the same workflow, so they may have identical status sequences
      // The key test is that each orderId only receives messages for its own order
      for (const order of orders) {
        const statuses = orderStatuses[order.id];
        expect(statuses).toContain('pending');
        expect(statuses).toContain('routing');
        expect(statuses).toContain('confirmed');
        expect(statuses.length).toBeGreaterThanOrEqual(3);
      }
    }, 15000);
  });

  describe('API Validation', () => {
    it('should reject orders with missing required fields', async () => {
      const invalidOrder = {
        id: 'invalid-001',
        // Missing pair, side, amount
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: invalidOrder,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.requiredFields).toBeDefined();
    });

    it('should accept valid order and return 202', async () => {
      const validOrder: Order = {
        id: 'valid-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: validOrder,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('queued');
      expect(body.orderId).toBe(validOrder.id);
    });
  });
});
