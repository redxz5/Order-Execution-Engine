export interface Order {
  id: string;
  userId?: string;
  pair: string; // e.g., "SOL/USDC"
  side: 'buy' | 'sell';
  amount: number;
  timestamp?: number;
}

export interface OrderJobData {
  order: Order;
}
