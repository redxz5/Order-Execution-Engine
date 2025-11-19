/**
 * Represents a price quote from a DEX (Decentralized Exchange)
 */
export interface Quote {
  dex: 'Raydium' | 'Meteora';
  price: number;
  fee: number;
}

/**
 * MockRouter simulates DEX quote fetching with realistic delays and price variance
 * Used for testing order execution without actual blockchain interactions
 */
export class MockRouter {
  private readonly BASE_PRICE = 150; // Base price for SOL in USD
  private readonly PRICE_VARIANCE = 0.005; // 0.5% price variance
  private readonly DEX_FEE = 0.003; // 0.3% DEX fee
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
   * @param variance - Percentage variance (e.g., 0.005 for ±0.5%)
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
      price: this.calculatePriceWithVariance(this.BASE_PRICE, this.PRICE_VARIANCE),
      fee: this.DEX_FEE,
    };

    const meteoraQuote: Quote = {
      dex: 'Meteora',
      price: this.calculatePriceWithVariance(this.BASE_PRICE, this.PRICE_VARIANCE),
      fee: this.DEX_FEE,
    };

    return [raydiumQuote, meteoraQuote];
  }
}
