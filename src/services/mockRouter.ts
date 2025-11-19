export interface Quote {
  dex: 'Raydium' | 'Meteora';
  price: number;
  fee: number;
}

export class MockRouter {
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRandomPrice(basePrice: number, variance: number): number {
    const change = basePrice * (Math.random() * variance * 2 - variance);
    return basePrice + change;
  }

  async getQuotes(pair: string, amount: number): Promise<Quote[]> {
    // Simulate network delay (200ms - 500ms)
    await this.delay(200 + Math.random() * 300);

    // Base price simulation (e.g., SOL = 150)
    const basePrice = 150; 

    const raydiumQuote: Quote = {
      dex: 'Raydium',
      price: this.getRandomPrice(basePrice, 0.005), // 0.5% variance
      fee: 0.003, // 0.3% fee
    };

    const meteoraQuote: Quote = {
      dex: 'Meteora',
      price: this.getRandomPrice(basePrice, 0.005),
      fee: 0.003,
    };

    return [raydiumQuote, meteoraQuote];
  }
}
