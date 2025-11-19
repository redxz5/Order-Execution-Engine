import { Worker, Job } from 'bullmq';
import { REDIS_CONFIG, QUEUE_NAME } from '../config';
import { OrderJobData } from '../types';
import { MockRouter } from './mockRouter';

export class OrderExecutor {
  private worker: Worker;
  private router: MockRouter;
  private statusCallback: (orderId: string, status: string, details?: any) => void;

  constructor(statusCallback: (orderId: string, status: string, details?: any) => void) {
    this.statusCallback = statusCallback;
    this.router = new MockRouter();
    
    this.worker = new Worker<OrderJobData>(
      QUEUE_NAME,
      async (job) => {
        await this.processOrder(job);
      },
      {
        connection: REDIS_CONFIG,
        concurrency: 10, // Requirement: Max 10 concurrent orders
      }
    );

    this.worker.on('failed', (job, err) => {
      if (job) {
        this.statusCallback(job.data.order.id, 'failed', { error: err.message });
      }
    });
  }

  async close() {
    await this.worker.close();
  }

  private async processOrder(job: Job<OrderJobData>) {
    const { order } = job.data;
    
    // 1. Pending
    this.statusCallback(order.id, 'pending');
    
    // 2. Routing
    this.statusCallback(order.id, 'routing');
    const quotes = await this.router.getQuotes(order.pair, order.amount);
    
    // Select best price
    // For 'buy', we want lowest price. For 'sell', highest.
    const bestQuote = quotes.reduce((prev, curr) => {
        if (order.side === 'buy') {
            return curr.price < prev.price ? curr : prev;
        } else {
            return curr.price > prev.price ? curr : prev;
        }
    });

    // 3. Building (Simulate transaction building)
    this.statusCallback(order.id, 'building', { selectedDex: bestQuote.dex, price: bestQuote.price });
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate build time

    // 4. Submitted
    this.statusCallback(order.id, 'submitted');
    
    // 5. Execution / Settlement
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate confirmation time
    
    // 6. Confirmed
    this.statusCallback(order.id, 'confirmed', { 
        txHash: 'simulated_tx_hash_' + Math.random().toString(36).substring(7),
        price: bestQuote.price,
        dex: bestQuote.dex
    });
  }
}
