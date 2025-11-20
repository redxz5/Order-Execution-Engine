/**
 * Represents a price quote from a DEX (Decentralized Exchange)
 */
export interface Quote {
  dex: 'Raydium' | 'Meteora';
  price: number;
  fee: number;
  minAmountOut?: number;
}

/**
 * Result of getting the best quote from multiple DEXes
 */
export interface BestQuoteResult {
  dex: 'Raydium' | 'Meteora';
  price: number;
  fee: number;
  minAmountOut: number;
}

/**
 * MockRouter simulates DEX quote fetching with realistic delays and price variance
 * Used for testing order execution without actual blockchain interactions
 */
export class MockRouter {
  private readonly BASE_PRICE = 150; // Base price for SOL in USD
  private readonly RAYDIUM_VARIANCE = 0.04; // 4% price variance for Raydium
  private readonly METEORA_VARIANCE = 0.05; // 5% price variance for Meteora
  private readonly RAYDIUM_FEE = 0.003; // 0.3% fee for Raydium
  private readonly METEORA_FEE = 0.002; // 0.2% fee for Meteora
  private readonly MIN_NETWORK_DELAY_MS = 200;
  private readonly MAX_NETWORK_DELAY_MS = 500;

  /**
   * Simulates network delay with random duration
   * @param durationMs - Delay duration in milliseconds
   * @returns Promise that resolves after the delay
   */
  private async simulateDelay(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  /**
   * Generates a random price with variance around base price
   * @param basePrice - Starting price before applying variance
   * @param variance - Percentage variance (e.g., 0.04 for ±4%)
   * @returns Price with random variance applied
   */
  private calculatePriceWithVariance(basePrice: number, variance: number): number {
    const priceChange = basePrice * (Math.random() * variance * 2 - variance);
    return basePrice + priceChange;
  }

  /**
   * Calculates realistic network delay within configured range
   * @returns Random delay in milliseconds between min and max
   */
  private getNetworkDelay(): number {
    const delayRange = this.MAX_NETWORK_DELAY_MS - this.MIN_NETWORK_DELAY_MS;
    return this.MIN_NETWORK_DELAY_MS + Math.random() * delayRange;
  }

  /**
   * Calculates minimum amount out based on slippage tolerance
   * @param amount - Input amount
   * @param price - Price per token
   * @param slippagePercent - Slippage tolerance (e.g., 1 for 1%)
   * @returns Minimum amount out after slippage
   */
  private calculateMinAmountOut(amount: number, price: number, slippagePercent: number): number {
    const expectedOut = amount * price;
    const slippageFactor = 1 - (slippagePercent / 100);
    return expectedOut * slippageFactor;
  }

  /**
   * Validates input parameters for quote fetching
   * @param tokenAddress - Token address to validate
   * @param amount - Amount to validate
   * @throws Error if inputs are invalid
   */
  private validateInputs(tokenAddress: string, amount: number): void {
    if (!tokenAddress || tokenAddress.trim() === '') {
      throw new Error('Invalid token address: Token address cannot be empty');
    }
    if (amount <= 0) {
      throw new Error('Invalid amount: Amount must be greater than zero');
    }
  }

  /**
   * Fetches quotes from multiple DEXes (Raydium and Meteora)
   * Simulates network delay and price variance
   * @param pair - Trading pair (e.g., "SOL/USDC")
   * @param amount - Order amount
   * @returns Array of quotes from different DEXes
   */
  async getQuotes(pair: string, amount: number): Promise<Quote[]> {
    // Simulate realistic network delay
    await this.simulateDelay(this.getNetworkDelay());

    const raydiumQuote: Quote = {
      dex: 'Raydium',
      price: this.calculatePriceWithVariance(this.BASE_PRICE, this.RAYDIUM_VARIANCE),
      fee: this.RAYDIUM_FEE,
    };

    const meteoraQuote: Quote = {
      dex: 'Meteora',
      price: this.calculatePriceWithVariance(this.BASE_PRICE, this.METEORA_VARIANCE),
      fee: this.METEORA_FEE,
    };

    return [raydiumQuote, meteoraQuote];
  }

  /**
   * Gets the best quote from available DEXes with slippage protection
   * @param tokenAddress - Address of the token to trade
   * @param amount - Amount to trade
   * @param slippagePercent - Slippage tolerance percentage (default: 1%)
   * @returns Best quote with minimum amount out
   * @throws Error if inputs are invalid
   */
  async getQuote(tokenAddress: string, amount: number, slippagePercent: number = 1): Promise<BestQuoteResult> {
    this.validateInputs(tokenAddress, amount);

    // Simulate realistic network delay
    await this.simulateDelay(this.getNetworkDelay());

    const raydiumPrice = this.calculatePriceWithVariance(this.BASE_PRICE, this.RAYDIUM_VARIANCE);
    const meteoraPrice = this.calculatePriceWithVariance(this.BASE_PRICE, this.METEORA_VARIANCE);

    // Select best DEX (lowest price is best for buy orders)
    const isRaydiumBetter = raydiumPrice <= meteoraPrice;
    const bestDex = isRaydiumBetter ? 'Raydium' : 'Meteora';
    const bestPrice = isRaydiumBetter ? raydiumPrice : meteoraPrice;
    const bestFee = isRaydiumBetter ? this.RAYDIUM_FEE : this.METEORA_FEE;

    return {
      dex: bestDex,
      price: bestPrice,
      fee: bestFee,
      minAmountOut: this.calculateMinAmountOut(amount, bestPrice, slippagePercent),
    };
  }
}
