import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { Queue } from 'bullmq';
import { REDIS_CONFIG, QUEUE_NAME } from './config';
import { Order } from './types';
import { OrderExecutor } from './services/orderExecutor';
import { WebSocket } from 'ws';

const app = Fastify({ logger: true });

// Initialize BullMQ Queue
const orderQueue = new Queue(QUEUE_NAME, { connection: REDIS_CONFIG });

// Register WebSocket support
app.register(fastifyWebsocket);

const connections = new Set<WebSocket>();

// Initialize Order Executor (Worker)
new OrderExecutor((orderId, status, details) => {
  const message = JSON.stringify({ orderId, status, details });
  // Broadcast to all connected clients
  for (const connection of connections) {
    try {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(message);
      }
    } catch (e) {
      console.error('Failed to send message to client', e);
    }
  }
});

app.register(async (fastify) => {
  // WebSocket Endpoint: /ws
  // Clients connect here to receive order updates
  fastify.get('/ws', { websocket: true } as any, (connection: any, req: any) => {
    const socket = connection.socket || connection;
    connections.add(socket);
    
    socket.on('message', (message: any) => {
      // For now, just echo back. In Phase 3, we will push updates here.
      socket.send(`Connected. You said: ${message}`);
    });

    socket.on('close', () => {
      connections.delete(socket);
    });
  });

  // HTTP Endpoint: POST /api/orders/execute
  // Receives an order and pushes it to the queue
  fastify.post<{ Body: Order }>('/api/orders/execute', async (request, reply) => {
    const order = request.body;

    // Basic Validation
    if (!order.id || !order.userId || !order.amount || !order.pair) {
      return reply.status(400).send({ error: 'Invalid order data. Missing required fields.' });
    }

    try {
      // Add to Queue with retry configuration
      await orderQueue.add('execute-order', { order }, {
        attempts: 3, // Retry up to 3 times on failure
        backoff: {
          type: 'exponential', // Exponential backoff
          delay: 2000, // Initial delay 2 seconds
        },
      });
      
      request.log.info(`Order ${order.id} queued successfully.`);
      
      return reply.status(202).send({
        status: 'queued',
        message: 'Order received and queued for execution',
        orderId: order.id
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to queue order' });
    }
  });
});

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running at http://localhost:3000');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
