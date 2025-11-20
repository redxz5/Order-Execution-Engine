# MockRouter Test Coverage

## Overview
Comprehensive unit tests for the `MockRouter` class using Jest with controlled `Math.random()` mocking.

## Test Statistics
- **Total Tests**: 23
- **Test Suites**: 6 categories
- **All Tests Passing**: ✅

## Test Categories

### 1. Best Price Selection (3 tests)
- ✅ Raydium 5% better price - Verifies Raydium is selected when offering better pricing
- ✅ Meteora 5% better price - Verifies Meteora is selected when offering better pricing  
- ✅ Zero variance tie - Confirms Raydium is default when prices are identical

### 2. Slippage Calculation (3 tests)
- ✅ 1% slippage calculation - Validates minAmountOut with 1% slippage
- ✅ 2% slippage calculation - Validates minAmountOut with 2% slippage
- ✅ Default slippage - Confirms 1% default when not specified

### 3. Fee Handling (3 tests)
- ✅ Raydium fee structure - Verifies 0.003 (0.3%) fee for Raydium
- ✅ Meteora fee structure - Verifies 0.002 (0.2%) fee for Meteora
- ✅ Both DEX fees in getQuotes - Ensures both quotes include correct fees

### 4. Input Validation (5 tests)
- ✅ Empty token address - Throws appropriate error
- ✅ Whitespace token address - Throws appropriate error
- ✅ Zero amount - Throws appropriate error
- ✅ Negative amount - Throws appropriate error
- ✅ Valid inputs - Accepts valid token and amount

### 5. High Latency Simulation (4 tests)
- ✅ Network delay before return - Uses Jest fake timers to verify delay
- ✅ Minimum delay (200ms) - Tests lower bound of network delay
- ✅ Maximum delay (500ms) - Tests upper bound of network delay
- ✅ getQuotes delay - Confirms delay applies to getQuotes method

### 6. Price Variance Boundaries (3 tests)
- ✅ Raydium -4% variance - Maximum negative variance for Raydium
- ✅ Meteora +5% variance - Maximum positive variance for Meteora
- ✅ Mid-range variance - Tests variance calculation at arbitrary points

### 7. Quote Structure Validation (2 tests)
- ✅ BestQuoteResult fields - Validates all required fields present
- ✅ Quote objects structure - Ensures proper Quote interface compliance

## Key Testing Techniques

### Math.random() Mocking
```typescript
randomSpy = jest.spyOn(global.Math, 'random');
randomSpy.mockImplementation(() => 0.5);
```

### Fake Timers for Latency
```typescript
jest.useFakeTimers();
jest.advanceTimersByTime(350);
```

### Error Testing
```typescript
await expect(router.getQuote('', 100)).rejects.toThrow('Invalid token address');
```

## Coverage Metrics
- **Line Coverage**: All public and private methods tested
- **Branch Coverage**: All conditional paths covered
- **Edge Cases**: Boundary values, errors, and tie scenarios tested

## Requirements Fulfilled
1. ✅ Raydium 5% better price scenario
2. ✅ Meteora 5% better price scenario
3. ✅ Zero variance tie handling
4. ✅ Slippage calculation validation
5. ✅ Fee structure verification (0.003 Raydium, 0.002 Meteora)
6. ✅ Invalid token address error
7. ✅ Zero amount error
8. ✅ High latency simulation with fake timers

## Variance Implementation
- **Raydium**: ±4% variance around base price (150)
- **Meteora**: ±5% variance around base price (150)
- **Formula**: `price = basePrice + basePrice * (random * variance * 2 - variance)`
