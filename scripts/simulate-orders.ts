import WebSocket from 'ws';
import axios from 'axios';

const WS_URL = 'ws://localhost:3000/ws';
const API_URL = 'http://localhost:3000/api/orders/execute';

const NUM_ORDERS = 5;

async function simulate() {
  console.log('Starting simulation...');

  // 1. Connect to WebSocket
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('WebSocket connected');
  });

  ws.on('message', (data) => {
    console.log('WS Update:', data.toString());
  });

  // Wait for WS connection
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 2. Submit Orders
  console.log(`Submitting ${NUM_ORDERS} orders...`);

  for (let i = 0; i < NUM_ORDERS; i++) {
    const order = {
      id: `order-${Date.now()}-${i}`,
      userId: `user-${i}`,
      pair: 'SOL/USDC',
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      amount: Math.floor(Math.random() * 10) + 1,
      timestamp: Date.now(),
    };

    try {
      await axios.post(API_URL, order);
      console.log(`Submitted Order ${order.id}`);
    } catch (error: any) {
      console.error(`Failed to submit order ${order.id}:`, error.message);
    }
  }

  // Keep script running to receive WS updates
  console.log('Waiting for updates...');
}

simulate();
