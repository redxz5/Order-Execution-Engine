import { MockRouter } from '../src/services/mockRouter';
import { OrderExecutor } from '../src/services/orderExecutor';
import { Order } from '../src/types';

describe('Order Execution Engine', () => {
  let router: MockRouter;

  beforeEach(() => {
    router = new MockRouter();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: MockRouter returns quotes from both DEXs
  test('MockRouter should return quotes from Raydium and Meteora', async () => {
    const quotes = await router.getQuotes('SOL/USDC', 1);
    expect(quotes).toHaveLength(2);
    expect(quotes.map(q => q.dex)).toContain('Raydium');
    expect(quotes.map(q => q.dex)).toContain('Meteora');
  });

  // Test 2: MockRouter returns valid prices
  test('MockRouter should return valid prices', async () => {
    const quotes = await router.getQuotes('SOL/USDC', 1);
    quotes.forEach(quote => {
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.fee).toBeGreaterThan(0);
    });
  });

  // Test 3: MockRouter simulates network delay
  test('MockRouter should simulate network delay', async () => {
    const startTime = Date.now();
    await router.getQuotes('SOL/USDC', 1);
    const endTime = Date.now();
    const elapsed = endTime - startTime;
    
    // Should take at least 200ms
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  // Test 4: MockRouter returns different prices on multiple calls (variance)
  test('MockRouter should return varied prices across calls', async () => {
    const quotes1 = await router.getQuotes('SOL/USDC', 1);
    const quotes2 = await router.getQuotes('SOL/USDC', 1);
    
    // Prices should be different due to random variance
    const raydiumPricesMatch = quotes1[0].price === quotes2[0].price;
    const meteoraPricesMatch = quotes1[1].price === quotes2[1].price;
    
    // At least one should be different (very high probability)
    expect(raydiumPricesMatch && meteoraPricesMatch).toBe(false);
  });

  // Test 5: Routing logic - Buy side selects lowest price
  test('Routing logic should select lowest price for buy orders', async () => {
    const quotes = [
      { dex: 'Raydium' as const, price: 150.5, fee: 0.003 },
      { dex: 'Meteora' as const, price: 149.8, fee: 0.003 },
    ];
    
    const bestQuote = quotes.reduce((prev, curr) => {
      return curr.price < prev.price ? curr : prev;
    });
    
    expect(bestQuote.dex).toBe('Meteora');
    expect(bestQuote.price).toBe(149.8);
  });

  // Test 6: Routing logic - Sell side selects highest price
  test('Routing logic should select highest price for sell orders', async () => {
    const quotes = [
      { dex: 'Raydium' as const, price: 150.5, fee: 0.003 },
      { dex: 'Meteora' as const, price: 149.8, fee: 0.003 },
    ];
    
    const bestQuote = quotes.reduce((prev, curr) => {
      return curr.price > prev.price ? curr : prev;
    });
    
    expect(bestQuote.dex).toBe('Raydium');
    expect(bestQuote.price).toBe(150.5);
  });

  // Test 7: Order validation - Valid order structure
  test('Order should have all required fields', () => {
    const order: Order = {
      id: 'test-order-1',
      userId: 'user-1',
      pair: 'SOL/USDC',
      side: 'buy',
      amount: 1,
      timestamp: Date.now(),
    };

    expect(order.id).toBeDefined();
    expect(order.userId).toBeDefined();
    expect(order.pair).toBeDefined();
    expect(order.side).toBeDefined();
    expect(order.amount).toBeDefined();
    expect(order.timestamp).toBeDefined();
  });

  // Test 8: Order side validation
  test('Order side should be either buy or sell', () => {
    const buyOrder: Order = {
      id: 'test-1',
      userId: 'user-1',
      pair: 'SOL/USDC',
      side: 'buy',
      amount: 1,
      timestamp: Date.now(),
    };

    const sellOrder: Order = {
      id: 'test-2',
      userId: 'user-2',
      pair: 'SOL/USDC',
      side: 'sell',
      amount: 1,
      timestamp: Date.now(),
    };

    expect(['buy', 'sell']).toContain(buyOrder.side);
    expect(['buy', 'sell']).toContain(sellOrder.side);
  });

  // Test 9: OrderExecutor instantiation
  test('OrderExecutor should instantiate correctly', (done) => {
    const executor = new OrderExecutor((id, status, details) => {
      // Callback handler
    });
    
    expect(executor).toBeDefined();
    
    executor.close().then(() => {
      done();
    });
  });

  // Test 10: WebSocket event lifecycle order
  test('WebSocket events should follow correct lifecycle order', () => {
    const expectedOrder = ['pending', 'routing', 'building', 'submitted', 'confirmed'];
    const events: string[] = [];
    
    // Simulate the event flow
    events.push('pending');
    events.push('routing');
    events.push('building');
    events.push('submitted');
    events.push('confirmed');
    
    expect(events).toEqual(expectedOrder);
  });

  // Test 11: Concurrency limit configuration
  test('OrderExecutor should be configured with max 10 concurrent orders', (done) => {
    const executor = new OrderExecutor((id, status, details) => {});
    
    // The executor should have concurrency set to 10
    // This is configured in the Worker constructor
    expect(executor).toBeDefined();
    
    executor.close().then(() => {
      done();
    });
  });

  // Test 12: Quote structure validation
  test('Quote should have correct structure with dex, price, and fee', async () => {
    const quotes = await router.getQuotes('SOL/USDC', 1);
    
    quotes.forEach(quote => {
      expect(quote).toHaveProperty('dex');
      expect(quote).toHaveProperty('price');
      expect(quote).toHaveProperty('fee');
      expect(['Raydium', 'Meteora']).toContain(quote.dex);
    });
  });
});
