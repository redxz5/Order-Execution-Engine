import { Queue, Worker, Job } from 'bullmq';
import { Order, OrderJobData } from '../src/types';

// Note: These tests require a running Redis instance
// Run: docker-compose up -d redis (or ensure Redis is running on localhost:6379)

const QUEUE_NAME = 'test-order-queue';
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

describe('Order Queue System - Integration Tests', () => {
  let queue: Queue;
  let worker: Worker;
  let processedJobs: string[] = [];
  let activeJobs: Set<string> = new Set();

  beforeEach(() => {
    processedJobs = [];
    activeJobs = new Set();
    
    // Create queue with Redis
    queue = new Queue(QUEUE_NAME, { 
      connection: REDIS_CONFIG,
    });
  });

  afterEach(async () => {
    // Clean up worker first
    if (worker) {
      await worker.close();
      worker = null as any;
    }
    
    // Then clean and close queue
    if (queue) {
      try {
        await queue.obliterate({ force: true });
      } catch (err) {
        // Queue may already be closed
      }
      await queue.close();
    }
  });

  describe('Standard Processing', () => {
    it('should add a job to the queue and verify the processor function is called', async () => {
      const testOrder: Order = {
        id: 'order-001',
        userId: 'user-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
        timestamp: Date.now(),
      };

      let processorCalled = false;
      let receivedOrder: Order | null = null;

      // Create worker with processor function
      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          processorCalled = true;
          receivedOrder = job.data.order;
          processedJobs.push(job.data.order.id);
        },
        { connection: REDIS_CONFIG }
      );

      // Add job to queue
      await queue.add('execute-order', { order: testOrder });

      // Wait for job to be processed
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(processorCalled).toBe(true);
      expect(receivedOrder).toEqual(testOrder);
      expect(processedJobs).toContain('order-001');
    });

    it('should process multiple jobs in sequence', async () => {
      const orders: Order[] = [
        { id: 'order-001', pair: 'SOL/USDC', side: 'buy', amount: 100 },
        { id: 'order-002', pair: 'SOL/USDC', side: 'sell', amount: 50 },
        { id: 'order-003', pair: 'SOL/USDC', side: 'buy', amount: 75 },
      ];

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          processedJobs.push(job.data.order.id);
        },
        { connection: REDIS_CONFIG }
      );

      // Add all jobs
      for (const order of orders) {
        await queue.add('execute-order', { order });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(processedJobs).toHaveLength(3);
      expect(processedJobs).toContain('order-001');
      expect(processedJobs).toContain('order-002');
      expect(processedJobs).toContain('order-003');
    });
  });

  describe('Concurrency Limit', () => {
    it('should ensure only 10 jobs are active at once, with remaining 5 waiting', async () => {
      const maxConcurrent = 10;
      const totalJobs = 15;
      const jobDuration = 1000; // 1 second per job

      let maxActiveAtOnce = 0;
      const jobStates: { [key: string]: 'waiting' | 'active' | 'completed' } = {};

      // Initialize all jobs as waiting
      for (let i = 1; i <= totalJobs; i++) {
        jobStates[`order-${String(i).padStart(3, '0')}`] = 'waiting';
      }

      // Create worker with concurrency limit
      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          const orderId = job.data.order.id;
          
          // Mark as active
          activeJobs.add(orderId);
          jobStates[orderId] = 'active';
          
          // Track max concurrent
          if (activeJobs.size > maxActiveAtOnce) {
            maxActiveAtOnce = activeJobs.size;
          }

          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, jobDuration));

          // Mark as completed
          activeJobs.delete(orderId);
          jobStates[orderId] = 'completed';
          processedJobs.push(orderId);
        },
        { 
          connection: REDIS_CONFIG,
          concurrency: maxConcurrent,
        }
      );

      // Add 15 jobs rapidly
      const addPromises = [];
      for (let i = 1; i <= totalJobs; i++) {
        const order: Order = {
          id: `order-${String(i).padStart(3, '0')}`,
          pair: 'SOL/USDC',
          side: 'buy',
          amount: 100,
        };
        addPromises.push(queue.add('execute-order', { order }));
      }
      await Promise.all(addPromises);

      // Wait a bit for jobs to start processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check that no more than 10 are active
      expect(activeJobs.size).toBeLessThanOrEqual(maxConcurrent);

      // Get queue metrics
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();

      // At this point, we should have 10 active and 5 waiting (approximately)
      expect(active.length).toBeLessThanOrEqual(maxConcurrent);
      expect(waiting.length + active.length).toBeLessThanOrEqual(totalJobs);

      // Wait for all jobs to complete
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify max concurrent was respected
      expect(maxActiveAtOnce).toBeLessThanOrEqual(maxConcurrent);
      expect(maxActiveAtOnce).toBeGreaterThan(0);

      // Verify all jobs eventually completed
      expect(processedJobs.length).toBe(totalJobs);
    });
  });

  describe('Retry Logic', () => {
    it('should succeed after initial failure (Success after fail)', async () => {
      const testOrder: Order = {
        id: 'retry-order-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      let attemptCount = 0;
      let finalStatus: 'success' | 'failed' = 'failed';

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          attemptCount++;
          
          // Fail on first attempt, succeed on second
          if (attemptCount === 1) {
            throw new Error('Simulated failure on first attempt');
          }
          
          // Success on second attempt
          finalStatus = 'success';
          processedJobs.push(job.data.order.id);
        },
        { connection: REDIS_CONFIG }
      );

      // Track completion
      worker.on('completed', (job) => {
        finalStatus = 'success';
      });

      // Add job with retry configuration
      await queue.add('execute-order', { order: testOrder }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 100, // Shorter delay for testing
        },
      });

      // Wait for retries and completion
      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(attemptCount).toBe(2); // Failed once, succeeded on second
      expect(finalStatus).toBe('success');
      expect(processedJobs).toContain('retry-order-001');
    });

    it('should move to Failed state after max retries exceeded', async () => {
      const testOrder: Order = {
        id: 'fail-order-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      let attemptCount = 0;
      let failedJob: Job<OrderJobData> | undefined;
      let failureReason = '';

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          attemptCount++;
          // Always fail
          throw new Error(`Simulated failure - attempt ${attemptCount}`);
        },
        { connection: REDIS_CONFIG }
      );

      // Track failures
      worker.on('failed', (job, err) => {
        if (job) {
          failedJob = job as Job<OrderJobData>;
          failureReason = err.message;
        }
      });

      // Add job with 3 max attempts
      const job = await queue.add('execute-order', { order: testOrder }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 100,
        },
      });

      // Wait for all retry attempts
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify it attempted 3 times
      expect(attemptCount).toBe(3);

      // Verify job is in failed state
      const failedJobs = await queue.getFailed();
      expect(failedJobs.length).toBeGreaterThan(0);
      
      const ourFailedJob = failedJobs.find(j => j.data.order.id === 'fail-order-001');
      expect(ourFailedJob).toBeDefined();
      expect(ourFailedJob?.attemptsMade).toBe(3);
    });

    it('should apply exponential backoff between retry attempts', async () => {
      const testOrder: Order = {
        id: 'backoff-order-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      const attemptTimestamps: number[] = [];

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          attemptTimestamps.push(Date.now());
          
          // Fail first two attempts
          if (attemptTimestamps.length < 3) {
            throw new Error('Simulated failure for backoff test');
          }
        },
        { connection: REDIS_CONFIG }
      );

      await queue.add('execute-order', { order: testOrder }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 500, // Base delay: 500ms
        },
      });

      // Wait for all attempts
      await new Promise(resolve => setTimeout(resolve, 5000));

      expect(attemptTimestamps.length).toBe(3);

      // Check delays between attempts (exponential: 500ms, 1000ms, 2000ms...)
      if (attemptTimestamps.length >= 2) {
        const delay1 = attemptTimestamps[1] - attemptTimestamps[0];
        // First retry should have ~500ms delay (allow some variance)
        expect(delay1).toBeGreaterThanOrEqual(400);
      }

      if (attemptTimestamps.length >= 3) {
        const delay2 = attemptTimestamps[2] - attemptTimestamps[1];
        // Second retry should have ~1000ms delay (exponential backoff)
        expect(delay2).toBeGreaterThanOrEqual(800);
      }
    }, 10000); // 10 second timeout for this test
  });

  describe('Failure Reason Persistence', () => {
    it('should save error message when job fails permanently', async () => {
      const testOrder: Order = {
        id: 'error-persist-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      const customErrorMessage = 'Custom error: Network timeout during order execution';

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          throw new Error(customErrorMessage);
        },
        { connection: REDIS_CONFIG }
      );

      let capturedError: Error | undefined;

      worker.on('failed', (job, err) => {
        capturedError = err;
      });

      await queue.add('execute-order', { order: testOrder }, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 100 },
      });

      // Wait for failure
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify error was captured
      expect(capturedError).toBeDefined();
      expect(capturedError?.message).toBe(customErrorMessage);

      // Verify failed job contains error info
      const failedJobs = await queue.getFailed();
      const ourJob = failedJobs.find(j => j.data.order.id === 'error-persist-001');
      
      expect(ourJob).toBeDefined();
      expect(ourJob?.failedReason).toContain(customErrorMessage);
    });

    it('should preserve stack trace in failed job', async () => {
      const testOrder: Order = {
        id: 'stacktrace-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          const err = new Error('Detailed error for stack trace test');
          throw err;
        },
        { connection: REDIS_CONFIG }
      );

      await queue.add('execute-order', { order: testOrder }, {
        attempts: 1,
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      const failedJobs = await queue.getFailed();
      const ourJob = failedJobs.find(j => j.data.order.id === 'stacktrace-001');

      expect(ourJob).toBeDefined();
      expect(ourJob?.failedReason).toBeDefined();
      expect(ourJob?.stacktrace).toBeDefined();
      // Stack trace is an array of strings
      expect(ourJob?.stacktrace?.[0]).toContain('Error: Detailed error for stack trace test');
    });
  });

  describe('Order Idempotency', () => {
    it('should not create duplicate jobs for the same Order ID', async () => {
      const testOrder: Order = {
        id: 'idempotent-order-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          processedJobs.push(job.data.order.id);
          await new Promise(resolve => setTimeout(resolve, 500));
        },
        { connection: REDIS_CONFIG }
      );

      // Add same order twice with jobId to ensure idempotency
      await queue.add('execute-order', { order: testOrder }, {
        jobId: testOrder.id, // Use order ID as job ID for idempotency
      });

      // Try to add again
      await queue.add('execute-order', { order: testOrder }, {
        jobId: testOrder.id,
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should only process once
      const orderOccurrences = processedJobs.filter(id => id === 'idempotent-order-001');
      expect(orderOccurrences.length).toBe(1);

      // Verify queue state
      const allJobs = await queue.getJobs(['completed', 'active', 'waiting']);
      const ourJobs = allJobs.filter(j => j.data.order.id === 'idempotent-order-001');
      expect(ourJobs.length).toBe(1);
    });

    it('should reject duplicate job submission when using jobId', async () => {
      const testOrder: Order = {
        id: 'duplicate-check-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      // Add first job
      const job1 = await queue.add('execute-order', { order: testOrder }, {
        jobId: testOrder.id,
      });

      expect(job1).toBeDefined();
      expect(job1.id).toBe(testOrder.id);

      // Try to add duplicate - BullMQ returns the existing job when jobId already exists
      const job2 = await queue.add('execute-order', { order: testOrder }, {
        jobId: testOrder.id,
      });

      // Should return the same job (same ID)
      expect(job2).toBeDefined();
      expect(job2?.id).toBe(job1.id);
      
      // Verify only one job exists in the queue
      const allJobs = await queue.getJobs(['completed', 'active', 'waiting', 'delayed']);
      const ourJobs = allJobs.filter(j => j.data.order.id === 'duplicate-check-001');
      expect(ourJobs.length).toBe(1);
    });

    it('should allow different orders with different IDs', async () => {
      const order1: Order = {
        id: 'unique-order-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      const order2: Order = {
        id: 'unique-order-002',
        pair: 'SOL/USDC',
        side: 'sell',
        amount: 50,
      };

      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          processedJobs.push(job.data.order.id);
        },
        { connection: REDIS_CONFIG }
      );

      await queue.add('execute-order', { order: order1 }, { jobId: order1.id });
      await queue.add('execute-order', { order: order2 }, { jobId: order2.id });

      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(processedJobs).toContain('unique-order-001');
      expect(processedJobs).toContain('unique-order-002');
      expect(processedJobs.length).toBe(2);
    });
  });

  describe('Queue State Management', () => {
    it('should track job states correctly (waiting -> active -> completed)', async () => {
      const testOrder: Order = {
        id: 'state-track-001',
        pair: 'SOL/USDC',
        side: 'buy',
        amount: 100,
      };

      const states: string[] = [];

      // Add job first, before worker starts
      const job = await queue.add('execute-order', { order: testOrder });
      
      // Check initial state immediately (should be waiting)
      let jobState = await job.getState();
      states.push(jobState);

      // Now create worker to process it
      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          states.push('processing');
          await new Promise(resolve => setTimeout(resolve, 500));
        },
        { connection: REDIS_CONFIG }
      );

      // Wait a bit for it to become active
      await new Promise(resolve => setTimeout(resolve, 100));
      jobState = await job.getState();
      states.push(jobState);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 1000));
      jobState = await job.getState();
      states.push(jobState);

      expect(states).toContain('waiting');
      expect(states).toContain('active');
      expect(states).toContain('completed');
    });

    it('should clean up completed jobs when requested', async () => {
      worker = new Worker<OrderJobData>(
        QUEUE_NAME,
        async (job: Job<OrderJobData>) => {
          processedJobs.push(job.data.order.id);
        },
        { connection: REDIS_CONFIG }
      );

      // Add and process 3 jobs
      for (let i = 1; i <= 3; i++) {
        await queue.add('execute-order', { 
          order: {
            id: `cleanup-${i}`,
            pair: 'SOL/USDC',
            side: 'buy',
            amount: 100,
          }
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get completed jobs
      let completedJobs = await queue.getCompleted();
      expect(completedJobs.length).toBe(3);

      // Clean up completed jobs
      await queue.clean(0, 100, 'completed');

      // Verify cleanup
      completedJobs = await queue.getCompleted();
      expect(completedJobs.length).toBe(0);
    });
  });
});
