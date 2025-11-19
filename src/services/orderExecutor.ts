import { Worker, Job } from 'bullmq';
import { REDIS_CONFIG, QUEUE_NAME } from '../config';
import { OrderJobData } from '../types';
import { MockRouter, Quote } from './mockRouter';
import { Order } from '../types';

/**
 * OrderExecutor class manages the execution of orders using BullMQ workers
 * Handles order routing, price selection, and execution lifecycle
 */
export class OrderExecutor {
  private worker: Worker;
  private dexRouter: MockRouter;
  private statusUpdateCallback: (orderId: string, status: string, details?: any) => void;

  /**
   * Creates an instance of OrderExecutor
   * @param statusUpdateCallback - Callback function to emit status updates for orders
   */
  constructor(statusUpdateCallback: (orderId: string, status: string, details?: any) => void) {
    this.statusUpdateCallback = statusUpdateCallback;
    this.dexRouter = new MockRouter();
    
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

    this.worker.on('failed', this.handleJobFailure.bind(this));
  }

  /**
   * Handles worker job failures and emits failed status
   * @param job - The failed job
   * @param error - Error that caused the failure
   */
  private handleJobFailure(job: Job<OrderJobData> | undefined, error: Error): void {
    if (job) {
      this.statusUpdateCallback(job.data.order.id, 'failed', { error: error.message });
    }
  }

  /**
   * Gracefully closes the worker and releases resources
   * @returns Promise that resolves when worker is closed
   */
  async close(): Promise<void> {
    await this.worker.close();
  }

  /**
   * Processes an order through its complete lifecycle
   * Status flow: pending → routing → building → submitted → confirmed
   * @param job - BullMQ job containing order data
   */
  private async processOrder(job: Job<OrderJobData>): Promise<void> {
    const { order } = job.data;
    
    // Step 1: Mark order as pending
    this.statusUpdateCallback(order.id, 'pending');
    
    // Step 2: Fetch quotes from DEXes
    this.statusUpdateCallback(order.id, 'routing');
    const quotes = await this.dexRouter.getQuotes(order.pair, order.amount);
    
    // Step 3: Select best quote based on order side
    const bestQuote = this.selectBestQuote(quotes, order.side);

    // Step 4: Build transaction with selected DEX
    this.statusUpdateCallback(order.id, 'building', { selectedDex: bestQuote.dex, price: bestQuote.price });
    await this.simulateTransactionBuilding();

    // Step 5: Submit transaction
    this.statusUpdateCallback(order.id, 'submitted');
    
    // Step 6: Execute and settle transaction
    await this.simulateTransactionExecution();
    
    // Step 7: Confirm execution with details
    const executionDetails = this.buildExecutionDetails(bestQuote);
    this.statusUpdateCallback(order.id, 'confirmed', executionDetails);
  }

  /**
   * Selects the best quote based on order side
   * Buy orders select lowest price, sell orders select highest price
   * @param quotes - Array of quotes from different DEXes
   * @param orderSide - Side of order ('buy' or 'sell')
   * @returns The best quote based on order side
   */
  private selectBestQuote(quotes: Quote[], orderSide: 'buy' | 'sell'): Quote {
    return quotes.reduce((bestQuote, currentQuote) => {
      if (orderSide === 'buy') {
        return currentQuote.price < bestQuote.price ? currentQuote : bestQuote;
      } else {
        return currentQuote.price > bestQuote.price ? currentQuote : bestQuote;
      }
    });
  }

  /**
   * Simulates transaction building delay (500ms)
   * @returns Promise that resolves after delay
   */
  private async simulateTransactionBuilding(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Simulates transaction execution and settlement delay (1000ms)
   * @returns Promise that resolves after delay
   */
  private async simulateTransactionExecution(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Builds execution details object for confirmed orders
   * @param quote - The quote that was executed
   * @returns Execution details with transaction hash, price, and DEX
   */
  private buildExecutionDetails(quote: Quote): object {
    return { 
      txHash: 'simulated_tx_hash_' + Math.random().toString(36).substring(7),
      price: quote.price,
      dex: quote.dex
    };
  }
}
