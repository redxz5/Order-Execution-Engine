import { MockRouter } from '../src/services/mockRouter';

describe('MockRouter - Comprehensive Unit Tests', () => {
  let router: MockRouter;
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    router = new MockRouter();
    randomSpy = jest.spyOn(global.Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  describe('Best Price Selection', () => {
    it('should return Raydium when Raydium offers 5% better price', async () => {
      // Mock random values to make Raydium 5% cheaper than base price
      // First call: network delay (doesn't matter for price)
      // Second call: Raydium variance - we want -5% from base (150)
      // Third call: Meteora variance - we want 0% from base
      
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay (250ms)
        if (callCount === 2) return 0; // Raydium: 0 gives -4% (min variance)
        if (callCount === 3) return 1; // Meteora: 1 gives +5% (max variance)
        return 0.5;
      });

      const result = await router.getQuote('SOL', 100);

      expect(result.dex).toBe('Raydium');
      expect(result.fee).toBe(0.003); // Raydium fee
      expect(result.price).toBeLessThan(150); // Should be below base price
    });

    it('should return Meteora when Meteora offers 5% better price', async () => {
      // Mock random values to make Meteora 5% cheaper than base price
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay
        if (callCount === 2) return 1; // Raydium: 1 gives +4% (max variance)
        if (callCount === 3) return 0; // Meteora: 0 gives -5% (min variance)
        return 0.5;
      });

      const result = await router.getQuote('SOL', 100);

      expect(result.dex).toBe('Meteora');
      expect(result.fee).toBe(0.002); // Meteora fee
      expect(result.price).toBeLessThan(150); // Should be below base price
    });

    it('should default to Raydium when prices are identical (zero variance tie)', async () => {
      // Mock random to return 0.5 for both DEXes (gives 0% variance)
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay
        if (callCount === 2) return 0.5; // Raydium: 0.5 gives 0% variance
        if (callCount === 3) return 0.5; // Meteora: 0.5 gives 0% variance
        return 0.5;
      });

      const result = await router.getQuote('SOL', 100);

      // When prices are equal, Raydium should be selected (<=)
      expect(result.dex).toBe('Raydium');
      expect(result.price).toBe(150); // Base price with 0 variance
    });
  });

  describe('Slippage Calculation', () => {
    it('should calculate minAmountOut correctly with 1% slippage', async () => {
      // Control random to get predictable price
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay
        if (callCount === 2) return 0.5; // Raydium: 0% variance = 150
        if (callCount === 3) return 0.5; // Meteora: 0% variance = 150
        return 0.5;
      });

      const amount = 100;
      const expectedPrice = 150;
      const slippage = 1; // 1%

      const result = await router.getQuote('SOL', amount, slippage);

      // Expected output = amount * price = 100 * 150 = 15000
      // With 1% slippage = 15000 * 0.99 = 14850
      expect(result.minAmountOut).toBe(14850);
    });

    it('should calculate minAmountOut correctly with 2% slippage', async () => {
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay
        if (callCount === 2) return 0.5; // Raydium: 0% variance = 150
        if (callCount === 3) return 0.5; // Meteora: 0% variance = 150
        return 0.5;
      });

      const amount = 100;
      const slippage = 2; // 2%

      const result = await router.getQuote('SOL', amount, slippage);

      // Expected output = 100 * 150 = 15000
      // With 2% slippage = 15000 * 0.98 = 14700
      expect(result.minAmountOut).toBe(14700);
    });

    it('should use default 1% slippage when not provided', async () => {
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5;
        if (callCount === 2) return 0.5;
        if (callCount === 3) return 0.5;
        return 0.5;
      });

      const result = await router.getQuote('SOL', 100);

      // Should use default 1% slippage
      expect(result.minAmountOut).toBe(14850);
    });
  });

  describe('Fee Handling', () => {
    it('should return correct fee structure for Raydium (0.003)', async () => {
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5;
        if (callCount === 2) return 0; // Make Raydium cheaper
        if (callCount === 3) return 1; // Make Meteora expensive
        return 0.5;
      });

      const result = await router.getQuote('SOL', 100);

      expect(result.dex).toBe('Raydium');
      expect(result.fee).toBe(0.003); // 0.3% fee
    });

    it('should return correct fee structure for Meteora (0.002)', async () => {
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5;
        if (callCount === 2) return 1; // Make Raydium expensive
        if (callCount === 3) return 0; // Make Meteora cheaper
        return 0.5;
      });

      const result = await router.getQuote('SOL', 100);

      expect(result.dex).toBe('Meteora');
      expect(result.fee).toBe(0.002); // 0.2% fee
    });

    it('should include fee in getQuotes response for both DEXes', async () => {
      randomSpy.mockImplementation(() => 0.5);

      const quotes = await router.getQuotes('SOL/USDC', 100);

      expect(quotes).toHaveLength(2);
      
      const raydiumQuote = quotes.find(q => q.dex === 'Raydium');
      const meteoraQuote = quotes.find(q => q.dex === 'Meteora');

      expect(raydiumQuote?.fee).toBe(0.003);
      expect(meteoraQuote?.fee).toBe(0.002);
    });
  });

  describe('Input Validation', () => {
    it('should throw error when token address is empty string', async () => {
      await expect(router.getQuote('', 100)).rejects.toThrow(
        'Invalid token address: Token address cannot be empty'
      );
    });

    it('should throw error when token address is whitespace only', async () => {
      await expect(router.getQuote('   ', 100)).rejects.toThrow(
        'Invalid token address: Token address cannot be empty'
      );
    });

    it('should throw error when amount is zero', async () => {
      await expect(router.getQuote('SOL', 0)).rejects.toThrow(
        'Invalid amount: Amount must be greater than zero'
      );
    });

    it('should throw error when amount is negative', async () => {
      await expect(router.getQuote('SOL', -100)).rejects.toThrow(
        'Invalid amount: Amount must be greater than zero'
      );
    });

    it('should accept valid token address and amount', async () => {
      randomSpy.mockImplementation(() => 0.5);

      await expect(router.getQuote('SOL', 100)).resolves.toBeDefined();
    });
  });

  describe('High Latency Simulation', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should wait for simulated network delay before returning quote', async () => {
      // Mock random to control delay: 200ms + (0.5 * 300) = 350ms
      randomSpy.mockImplementation(() => 0.5);

      const quotePromise = router.getQuote('SOL', 100);

      // Advance time by 200ms - should not resolve yet
      jest.advanceTimersByTime(200);
      await Promise.resolve(); // Flush promises

      // Advance remaining time (150ms to reach 350ms)
      jest.advanceTimersByTime(150);
      
      const result = await quotePromise;
      expect(result).toBeDefined();
      expect(result.dex).toBeDefined();
    });

    it('should wait for minimum network delay (200ms)', async () => {
      // Mock random to return 0 for delay: 200ms + (0 * 300) = 200ms
      randomSpy.mockImplementation(() => 0);

      const quotePromise = router.getQuote('SOL', 100);

      // Advance time by 199ms - should not resolve yet
      jest.advanceTimersByTime(199);
      await Promise.resolve();

      // Advance by 1ms to reach 200ms minimum
      jest.advanceTimersByTime(1);
      
      const result = await quotePromise;
      expect(result).toBeDefined();
    });

    it('should wait for maximum network delay (500ms)', async () => {
      // Mock random to return 1 for delay: 200ms + (1 * 300) = 500ms
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 1; // Max delay
        return 0.5; // Other calls
      });

      const quotePromise = router.getQuote('SOL', 100);

      // Advance time by 499ms - should not resolve yet
      jest.advanceTimersByTime(499);
      await Promise.resolve();

      // Advance by 1ms to reach 500ms maximum
      jest.advanceTimersByTime(1);
      
      const result = await quotePromise;
      expect(result).toBeDefined();
    });

    it('should simulate delay for getQuotes as well', async () => {
      randomSpy.mockImplementation(() => 0.5);

      const quotesPromise = router.getQuotes('SOL/USDC', 100);

      // Advance time by full delay
      jest.advanceTimersByTime(350);
      
      const result = await quotesPromise;
      expect(result).toHaveLength(2);
    });
  });

  describe('Price Variance Boundaries', () => {
    it('should apply maximum negative variance for Raydium (-4%)', async () => {
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay
        if (callCount === 2) return 0; // Raydium: min variance
        if (callCount === 3) return 1; // Meteora: max variance
        return 0.5;
      });

      const result = await router.getQuote('SOL', 100);

      // Raydium: 150 - (150 * 0.04) = 144
      expect(result.price).toBe(144);
    });

    it('should apply maximum positive variance for Meteora (+5%)', async () => {
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay
        if (callCount === 2) return 0; // Raydium: min variance (will be selected)
        if (callCount === 3) return 1; // Meteora: max variance
        return 0.5;
      });

      const quotes = await router.getQuotes('SOL/USDC', 100);
      const meteoraQuote = quotes.find(q => q.dex === 'Meteora');

      // Meteora: 150 + (150 * 0.05) = 157.5
      expect(meteoraQuote?.price).toBe(157.5);
    });

    it('should handle mid-range variance correctly', async () => {
      let callCount = 0;
      randomSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0.5; // Network delay
        if (callCount === 2) return 0.75; // Raydium: 75% of range
        if (callCount === 3) return 0.25; // Meteora: 25% of range
        return 0.5;
      });

      const quotes = await router.getQuotes('SOL/USDC', 100);
      
      const raydiumQuote = quotes.find(q => q.dex === 'Raydium');
      const meteoraQuote = quotes.find(q => q.dex === 'Meteora');

      // Raydium: 150 + 150 * (0.75 * 0.08 - 0.04) = 150 + 150 * 0.02 = 153
      expect(raydiumQuote?.price).toBe(153);

      // Meteora: 150 + 150 * (0.25 * 0.10 - 0.05) = 150 + 150 * -0.025 = 146.25
      expect(meteoraQuote?.price).toBe(146.25);
    });
  });

  describe('Quote Structure Validation', () => {
    it('should return all required fields in BestQuoteResult', async () => {
      randomSpy.mockImplementation(() => 0.5);

      const result = await router.getQuote('SOL', 100, 1);

      expect(result).toHaveProperty('dex');
      expect(result).toHaveProperty('price');
      expect(result).toHaveProperty('fee');
      expect(result).toHaveProperty('minAmountOut');
      
      expect(['Raydium', 'Meteora']).toContain(result.dex);
      expect(typeof result.price).toBe('number');
      expect(typeof result.fee).toBe('number');
      expect(typeof result.minAmountOut).toBe('number');
    });

    it('should return valid Quote objects from getQuotes', async () => {
      randomSpy.mockImplementation(() => 0.5);

      const quotes = await router.getQuotes('SOL/USDC', 100);

      quotes.forEach(quote => {
        expect(quote).toHaveProperty('dex');
        expect(quote).toHaveProperty('price');
        expect(quote).toHaveProperty('fee');
        expect(['Raydium', 'Meteora']).toContain(quote.dex);
        expect(typeof quote.price).toBe('number');
        expect(typeof quote.fee).toBe('number');
      });
    });
  });
});
