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

const activeWebSocketConnections = new Set<WebSocket>();

/**
 * Broadcasts an order status update to all connected WebSocket clients
 * @param orderId - Unique identifier for the order
 * @param status - Current status of the order (pending, routing, building, submitted, confirmed, failed)
 * @param details - Optional additional details about the order status
 */
const broadcastOrderStatus = (orderId: string, status: string, details?: any): void => {
  const statusMessage = JSON.stringify({ orderId, status, details });
  
  for (const wsConnection of activeWebSocketConnections) {
    sendMessageToClient(wsConnection, statusMessage);
  }
};

/**
 * Safely sends a message to a WebSocket client
 * @param wsConnection - WebSocket connection to send message to
 * @param message - Message to send
 */
const sendMessageToClient = (wsConnection: WebSocket, message: string): void => {
  try {
    if (wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(message);
    }
  } catch (error) {
    app.log.error({ error, message: 'Failed to send message to WebSocket client' });
  }
};

// Initialize Order Executor (Worker)
new OrderExecutor(broadcastOrderStatus);

/**
 * Validates if an order has all required fields
 * @param order - Order object to validate
 * @returns true if order is valid, false otherwise
 */
const isValidOrder = (order: Order): boolean => {
  return !!(order.id && order.userId && order.amount && order.pair && order.side);
};

/**
 * Adds an order to the execution queue with retry configuration
 * @param order - Order to be queued for execution
 * @returns Promise that resolves when order is successfully queued
 * @throws Error if queuing fails
 */
const queueOrderForExecution = async (order: Order): Promise<void> => {
  await orderQueue.add('execute-order', { order }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  });
};

/**
 * Handles new WebSocket connection and manages connection lifecycle
 * @param connection - WebSocket connection object
 */
const handleWebSocketConnection = (connection: any): void => {
  const clientSocket = connection.socket || connection;
  activeWebSocketConnections.add(clientSocket);
  
  clientSocket.on('message', (incomingMessage: any) => {
    const echoResponse = `Connected. You said: ${incomingMessage}`;
    sendMessageToClient(clientSocket, echoResponse);
  });

  clientSocket.on('close', () => {
    activeWebSocketConnections.delete(clientSocket);
    app.log.info('WebSocket client disconnected');
  });
  
  app.log.info('New WebSocket client connected');
};

app.register(async (fastify) => {
  /**
   * WebSocket Endpoint: /ws
   * Clients connect here to receive real-time order status updates
   */
  fastify.get('/ws', { websocket: true } as any, handleWebSocketConnection);

  /**
   * HTTP Endpoint: POST /api/orders/execute
   * Receives a market order and queues it for execution
   * @route POST /api/orders/execute
   * @param request.body - Order object containing id, userId, pair, side, amount, timestamp
   * @returns 202 Accepted with order confirmation or 400/500 error
   */
  fastify.post<{ Body: Order }>('/api/orders/execute', async (request, reply) => {
    const orderData = request.body;

    // Validate order has all required fields
    if (!isValidOrder(orderData)) {
      request.log.warn({ order: orderData }, 'Invalid order received - missing required fields');
      return reply.status(400).send({ 
        error: 'Invalid order data. Missing required fields.',
        requiredFields: ['id', 'userId', 'amount', 'pair', 'side']
      });
    }

    try {
      await queueOrderForExecution(orderData);
      
      request.log.info({ orderId: orderData.id }, 'Order queued successfully');
      
      return reply.status(202).send({
        status: 'queued',
        message: 'Order received and queued for execution',
        orderId: orderData.id
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      request.log.error({ error, orderId: orderData.id }, 'Failed to queue order');
      
      return reply.status(500).send({ 
        error: 'Failed to queue order',
        details: errorMessage
      });
    }
  });
});

/**
 * Starts the Fastify server and begins listening for requests
 * @param port - Port number to listen on (default: 3000)
 * @param host - Host address to bind to (default: 0.0.0.0)
 */
const startServer = async (port: number = 3000, host: string = '0.0.0.0'): Promise<void> => {
  try {
    await app.listen({ port, host });
    app.log.info(`Server running at http://${host}:${port}`);
    app.log.info('WebSocket endpoint available at /ws');
    app.log.info('Order execution endpoint available at POST /api/orders/execute');
  } catch (error) {
    app.log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

// Graceful shutdown handler
process.on('SIGINT', async () => {
  app.log.info('Received SIGINT, shutting down gracefully...');
  await app.close();
  process.exit(0);
});

startServer();
