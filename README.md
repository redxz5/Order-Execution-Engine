# Order Execution Engine

## Overview
This project implements a mock Order Execution Engine for a decentralized exchange (DEX) aggregator. It handles market orders, routes them to the best available DEX (simulated Raydium vs Meteora), and executes them with simulated delays.

## Architecture
- **Server**: Fastify (Node.js)
- **Queue**: BullMQ (Redis) - Handles job processing with concurrency control (max 10 concurrent orders) and exponential backoff retry
- **Database**: PostgreSQL (configured but not fully utilized in this mock phase)
- **Language**: TypeScript

## Features
- **Market Order Execution**: Processes market orders and routes them to the best available DEX
- **Mock Router**: Simulates quotes from Raydium and Meteora with random price variance and network delays
- **WebSocket Support**: Real-time order status updates through WebSocket connections
- **Queue Management**: BullMQ handles job queuing with:
  - Concurrency limit of 10 orders
  - Exponential backoff retry (3 attempts with 2s initial delay)
- **Order Lifecycle Events**: `pending` → `routing` → `building` → `submitted` → `confirmed` (or `failed`)

## Prerequisites
- Node.js (v16+)
- Docker & Docker Compose

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Infrastructure (Redis & Postgres)**
   ```bash
   docker-compose up -d
   ```

3. **Run the Server**
   ```bash
   npm start
   ```

## Running Tests

The project includes 12 comprehensive unit and integration tests covering:
- Routing logic (best price selection for buy/sell)
- Queue behavior and concurrency
- WebSocket lifecycle events
- MockRouter functionality (network delay, price variance)
- Order validation

Run tests with:
```bash
npm test
```

## Simulation

To simulate multiple concurrent orders and see the queue in action:
```bash
npx ts-node scripts/simulate-orders.ts
```

This script will:
1. Connect to the WebSocket endpoint
2. Submit 5 orders simultaneously
3. Display real-time order status updates

## API Endpoints

### HTTP
- **POST `/api/orders/execute`**: Submit a new market order
  - Request body:
    ```json
    {
      "id": "order-123",
      "userId": "user-1",
      "pair": "SOL/USDC",
      "side": "buy",
      "amount": 1,
      "timestamp": 1234567890
    }
    ```
  - Response: `202 Accepted` with order confirmation

### WebSocket
- **WS `/ws`**: Connect to receive real-time order updates
  - Events: `pending`, `routing`, `building`, `submitted`, `confirmed`, `failed`

## Project Structure
```
order-execution-engine/
├── src/
│   ├── app.ts                 # Main application entry point
│   ├── config/
│   │   └── index.ts           # Configuration (Redis, Queue)
│   ├── services/
│   │   ├── mockRouter.ts      # Mock DEX router (Raydium/Meteora)
│   │   └── orderExecutor.ts   # BullMQ worker for order processing
│   └── types/
│       └── index.ts           # TypeScript interfaces
├── scripts/
│   └── simulate-orders.ts     # Order simulation script
├── tests/
│   └── order.test.ts          # Test suite (12 tests)
├── docker-compose.yml         # Redis & PostgreSQL services
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript configuration
```

## Design Decisions

### BullMQ for Queue Management
- Robust job queuing with Redis
- Built-in concurrency control (max 10 orders)
- Retry mechanism with exponential backoff
- Job state management (pending, active, completed, failed)

### Fastify for HTTP/WebSocket Server
- High performance and low overhead
- Native WebSocket support via `@fastify/websocket`
- Excellent TypeScript support

### Mock Router Implementation
- Simulates network latency (200-500ms delay)
- Random price variance (±0.5%) for realistic DEX behavior
- Supports both Raydium and Meteora quotes
- Deterministic routing logic (best price selection)

### WebSocket for Real-time Updates
- Essential for trading applications
- Broadcasts order status to all connected clients
- Lifecycle events match real-world order execution flow

## Testing Strategy

The test suite covers:
1. **MockRouter Tests**: Quote generation, network delay, price variance
2. **Routing Logic Tests**: Best price selection for buy/sell orders
3. **Order Validation Tests**: Structure and field validation
4. **Integration Tests**: OrderExecutor instantiation and lifecycle
5. **Concurrency Tests**: Queue configuration validation

## License
MIT
