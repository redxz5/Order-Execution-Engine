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

The project includes **56 comprehensive tests** across 4 test suites:

### Test Coverage
- **Order Tests (12 tests)**: Basic order validation, routing logic, and OrderExecutor integration
- **MockRouter Tests (23 tests)**: 
  - Best price selection (Raydium vs Meteora)
  - Slippage calculation (1%, 2%, default scenarios)
  - Fee handling (0.003 Raydium, 0.002 Meteora)
  - Input validation (empty tokens, zero/negative amounts)
  - High latency simulation (200-500ms)
  - Price variance boundaries (±4% Raydium, ±5% Meteora)
- **Queue Integration Tests (13 tests)**:
  - Standard processing (single and multiple jobs)
  - Concurrency limits (10 max concurrent, waiting queue)
  - Retry logic (exponential backoff, max retries)
  - Failure persistence (error messages, stack traces)
  - Order idempotency (duplicate jobId handling)
  - Queue state management (waiting→active→completed)
- **WebSocket Integration Tests (8 tests)**:
  - Full lifecycle (pending→routing→building→submitted→confirmed)
  - Lifecycle failures (pending→routing→failed)
  - Invalid order ID handling
  - Premature disconnects (client closes, order continues)
  - Simultaneous connections (order-specific routing)
  - API validation (400 for missing fields, 202 for valid)

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
│   ├── order.test.ts          # Basic order tests (12 tests)
│   ├── router.test.ts         # MockRouter unit tests (23 tests)
│   ├── queue.test.ts          # Queue integration tests (13 tests)
│   └── websocket.test.ts      # WebSocket integration tests (8 tests)
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

The comprehensive test suite (56 tests) covers:

1. **Unit Tests (MockRouter)**:
   - Quote generation with controlled randomness (Math.random mocking)
   - Network delay simulation using fake timers
   - Price variance boundaries per DEX
   - Fee calculations and best price selection
   - Input validation and error handling

2. **Integration Tests (Queue)**:
   - BullMQ job processing with actual Redis
   - Concurrency control and queue state management
   - Retry logic with exponential backoff
   - Failure persistence and error tracking
   - Order idempotency handling

3. **Integration Tests (WebSocket)**:
   - Full order lifecycle testing with real-time updates
   - Order-specific message routing (simultaneous connections)
   - API validation using fastify.inject
   - Client disconnect handling
   - Invalid order scenarios

4. **Order Validation Tests**:
   - Structure and field validation
   - Routing logic for buy/sell orders
   - OrderExecutor integration

## License
MIT
