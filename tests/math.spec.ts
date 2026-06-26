/**
 * Tonked.io — Bonding Curve Math Tests
 * Comprehensive unit tests for lib/bondingCurve.ts
 */

import {
  getBuyQuote,
  getSellQuote,
  getPrice,
  getPriceInNanotons,
  getMarketCap,
  shouldMigrate,
  calculateFee,
  calculateSellTax,
  createInitialState,
  simulateBuy,
  simulateSell,
  formatTon,
  formatTokens,
  parseTon,
  getBondingProgress,
  calculateSlippage,
  NANOS_PER_TON,
  TOTAL_SUPPLY,
  INITIAL_VIRTUAL_TON,
  INITIAL_VIRTUAL_TOKENS,
  REAL_TOKEN_SUPPLY,
  MIGRATION_THRESHOLD,
  PRODUCTION_MIGRATION_THRESHOLD,
  TON_USD_PRICE_NUM,
  TON_USD_PRICE_DEN,
  START_MARKET_CAP_USD,
  MIGRATION_MARKET_CAP_USD,
  START_MARKET_CAP_TON,
  MIGRATION_MARKET_CAP_TON,
  FEE_BPS,
  SELL_TAX_BPS,
  BPS_DENOMINATOR,
  DEPLOY_FEE,
  MIGRATION_TOKEN_RESERVE,
  PRICE_PRECISION,
  CurveState,
} from '../lib/bondingCurve';

// ─── Helper ──────────────────────────────────────────────────────────────────

const TON = (n: number | bigint) => BigInt(n) * NANOS_PER_TON;

// ─── Constants Tests ─────────────────────────────────────────────────────────

describe('Constants', () => {
  it('NANOS_PER_TON is 10^9', () => {
    expect(NANOS_PER_TON).toBe(1_000_000_000n);
  });

  it('TOTAL_SUPPLY is 1 billion tokens', () => {
    expect(TOTAL_SUPPLY).toBe(1_000_000_000n * NANOS_PER_TON);
  });

  it('TON/USD snapshot is 2.454', () => {
    expect(TON_USD_PRICE_NUM).toBe(2_454n);
    expect(TON_USD_PRICE_DEN).toBe(1_000n);
  });

  it('INITIAL_VIRTUAL_TON matches the $5k launch market cap snapshot', () => {
    expect(INITIAL_VIRTUAL_TON).toBe(2_186_226_958_028n);
  });

  it('INITIAL_VIRTUAL_TOKENS is 1,073,000,191 tokens', () => {
    expect(INITIAL_VIRTUAL_TOKENS).toBe(1_073_000_191n * NANOS_PER_TON);
  });

  it('REAL_TOKEN_SUPPLY is 793.1 million tokens', () => {
    expect(REAL_TOKEN_SUPPLY).toBe(793_100_000n * NANOS_PER_TON);
  });

  it('START_MARKET_CAP_TON is $5k at the snapshot price', () => {
    expect(START_MARKET_CAP_USD).toBe(5_000n);
    expect((START_MARKET_CAP_TON * TON_USD_PRICE_NUM) / (NANOS_PER_TON * TON_USD_PRICE_DEN)).toBe(START_MARKET_CAP_USD);
  });

  it('MIGRATION_MARKET_CAP_TON is the requested 100 TON cap', () => {
    expect(MIGRATION_MARKET_CAP_TON).toBe(TON(100));
    expect(MIGRATION_MARKET_CAP_USD).toBe(245n);
    expect((MIGRATION_MARKET_CAP_TON * TON_USD_PRICE_NUM) / (NANOS_PER_TON * TON_USD_PRICE_DEN)).toBe(MIGRATION_MARKET_CAP_USD);
  });

  it('migration threshold is the 100 TON market cap target', () => {
    expect(PRODUCTION_MIGRATION_THRESHOLD).toBe(MIGRATION_MARKET_CAP_TON);
    expect(MIGRATION_THRESHOLD).toBe(MIGRATION_MARKET_CAP_TON);
  });

  it('FEE_BPS is 0 because bonding-curve TON fees are disabled', () => {
    expect(FEE_BPS).toBe(0n);
  });

  it('SELL_TAX_BPS is 200 (2%)', () => {
    expect(SELL_TAX_BPS).toBe(200n);
  });

  it('DEPLOY_FEE is 0.2 TON', () => {
    expect(DEPLOY_FEE).toBe(200_000_000n);
  });

  it('MIGRATION_TOKEN_RESERVE is ~206.9M tokens', () => {
    expect(MIGRATION_TOKEN_RESERVE).toBe(TOTAL_SUPPLY - REAL_TOKEN_SUPPLY);
    expect(MIGRATION_TOKEN_RESERVE).toBe(206_900_000n * NANOS_PER_TON);
  });
});

// ─── Fee Calculation ─────────────────────────────────────────────────────────

describe('calculateFee', () => {
  it('returns 0 because TON bonding-curve fees are disabled', () => {
    expect(calculateFee(TON(100))).toBe(0n);
    expect(calculateFee(TON(1))).toBe(0n);
  });

  it('returns 0 for zero or negative input', () => {
    expect(calculateFee(0n)).toBe(0n);
    expect(calculateFee(-1n)).toBe(0n);
  });

  it('rounds down on non-exact division', () => {
    // 1 nanoton * 100 / 10000 = 0.01 → rounds to 0
    expect(calculateFee(1n)).toBe(0n);
    // 99 nanotons → 99 * 100 / 10000 = 0.99 → rounds to 0
    expect(calculateFee(99n)).toBe(0n);
    // 100 nanotons → 100 * 100 / 10000 = 1
    expect(calculateFee(100n)).toBe(0n);
  });
});

describe('calculateSellTax', () => {
  it('calculates 2% token sell tax correctly', () => {
    expect(calculateSellTax(TON(100))).toBe(TON(2));
    expect(calculateSellTax(TON(1))).toBe((TON(1) * SELL_TAX_BPS) / BPS_DENOMINATOR);
  });

  it('returns 0 for zero or negative token input', () => {
    expect(calculateSellTax(0n)).toBe(0n);
    expect(calculateSellTax(-1n)).toBe(0n);
  });
});

// ─── Buy Quote ───────────────────────────────────────────────────────────────

describe('getBuyQuote', () => {
  const vTon = INITIAL_VIRTUAL_TON;
  const vTokens = INITIAL_VIRTUAL_TOKENS;

  it('returns positive tokensOut for valid input', () => {
    const result = getBuyQuote(TON(1), vTon, vTokens);
    expect(result.tokensOut).toBeGreaterThan(0n);
    expect(result.fee).toBe(0n);
    expect(result.tonInNet).toBe(TON(1));
  });

  it('buy fee is zero', () => {
    const result = getBuyQuote(TON(10), vTon, vTokens);
    expect(result.fee).toBe(0n);
  });

  it('new reserves maintain k invariant (approximately)', () => {
    const result = getBuyQuote(TON(5), vTon, vTokens);
    const kBefore = vTon * vTokens;
    const kAfter = result.newVirtualTonReserves * result.newVirtualTokenReserves;
    // kAfter should be >= kBefore due to rounding up
    expect(kAfter).toBeGreaterThanOrEqual(kBefore);
    // But very close (within the rounding error of 1 unit)
    expect(kAfter - kBefore).toBeLessThan(result.newVirtualTonReserves);
  });

  it('larger buy yields more tokens', () => {
    const small = getBuyQuote(TON(1), vTon, vTokens);
    const large = getBuyQuote(TON(10), vTon, vTokens);
    expect(large.tokensOut).toBeGreaterThan(small.tokensOut);
  });

  it('buying 10x TON yields less than 10x tokens (price impact)', () => {
    const small = getBuyQuote(TON(1), vTon, vTokens);
    const large = getBuyQuote(TON(10), vTon, vTokens);
    expect(large.tokensOut).toBeLessThan(small.tokensOut * 10n);
  });

  it('throws on zero tonIn', () => {
    expect(() => getBuyQuote(0n, vTon, vTokens)).toThrow('tonIn must be positive');
  });

  it('throws on negative tonIn', () => {
    expect(() => getBuyQuote(-1n, vTon, vTokens)).toThrow('tonIn must be positive');
  });

  it('throws on zero reserves', () => {
    expect(() => getBuyQuote(TON(1), 0n, vTokens)).toThrow('Reserves must be positive');
    expect(() => getBuyQuote(TON(1), vTon, 0n)).toThrow('Reserves must be positive');
  });

  it('updates virtual reserves correctly', () => {
    const result = getBuyQuote(TON(1), vTon, vTokens);
    expect(result.newVirtualTonReserves).toBe(vTon + result.tonInNet);
    expect(result.newVirtualTokenReserves).toBe(vTokens - result.tokensOut);
  });
});

// ─── Sell Quote ──────────────────────────────────────────────────────────────

describe('getSellQuote', () => {
  // First buy some tokens to have something to sell
  const vTon = INITIAL_VIRTUAL_TON;
  const vTokens = INITIAL_VIRTUAL_TOKENS;

  it('returns positive tonOut for valid input', () => {
    // Buy first, then sell from the new state
    const buyResult = getBuyQuote(TON(5), vTon, vTokens);
    const sellResult = getSellQuote(
      buyResult.tokensOut,
      buyResult.newVirtualTonReserves,
      buyResult.newVirtualTokenReserves,
    );
    expect(sellResult.tonOut).toBeGreaterThan(0n);
    expect(sellResult.fee).toBeGreaterThan(0n);
    expect(sellResult.tokensInNet).toBe(buyResult.tokensOut);
  });

  it('fee is 2% of gross TON output and TON output is net of the platform fee', () => {
    const buyResult = getBuyQuote(TON(5), vTon, vTokens);
    const sellResult = getSellQuote(
      buyResult.tokensOut,
      buyResult.newVirtualTonReserves,
      buyResult.newVirtualTokenReserves,
    );
    expect(sellResult.fee).toBe(
      sellResult.tonOutGross * SELL_TAX_BPS / BPS_DENOMINATOR
    );
    expect(sellResult.tonOut).toBe(sellResult.tonOutGross - sellResult.fee);
  });

  it('throws on zero tokensIn', () => {
    expect(() => getSellQuote(0n, vTon, vTokens)).toThrow('tokensIn must be positive');
  });

  it('throws on negative tokensIn', () => {
    expect(() => getSellQuote(-1n, vTon, vTokens)).toThrow('tokensIn must be positive');
  });
});

// ─── Round-Trip: Buy then Sell ───────────────────────────────────────────────

describe('Round-trip: buy X TON → sell all tokens → receive X minus ~2%', () => {
  it('loses approximately 2% on a round trip from the sell-side TON fee', () => {
    const tonIn = TON(10);
    let state = createInitialState();

    // Buy
    const { state: afterBuy, result: buyResult } = simulateBuy(state, tonIn);

    // Sell ALL tokens received
    const { result: sellResult } = simulateSell(afterBuy, buyResult.tokensOut);

    // The user should get back tonIn minus ~2% from the sell-side TON fee.
    const tonReceived = sellResult.tonOut;
    const loss = tonIn - tonReceived;

    // Loss should be close to 2% of tonIn
    // Allow tolerance: 1.9% to 2.1%
    const lossBps = (loss * BPS_DENOMINATOR) / tonIn;
    expect(lossBps).toBeGreaterThanOrEqual(190n); // >= 1.9%
    expect(lossBps).toBeLessThanOrEqual(210n);    // <= 2.1%
  });

  it('works for small amounts (0.1 TON)', () => {
    const tonIn = TON(1) / 10n; // 0.1 TON
    let state = createInitialState();

    const { state: afterBuy, result: buyResult } = simulateBuy(state, tonIn);
    const { result: sellResult } = simulateSell(afterBuy, buyResult.tokensOut);

    const tonReceived = sellResult.tonOut;
    expect(tonReceived).toBeLessThan(tonIn);
    expect(tonReceived).toBeGreaterThan(0n);
  });

  it('works for large amounts (50 TON)', () => {
    const tonIn = TON(50);
    let state = createInitialState();

    const { state: afterBuy, result: buyResult } = simulateBuy(state, tonIn);
    const { result: sellResult } = simulateSell(afterBuy, buyResult.tokensOut);

    const tonReceived = sellResult.tonOut;
    const lossBps = ((tonIn - tonReceived) * BPS_DENOMINATOR) / tonIn;
    // Higher slippage expected for larger trades, but fees should still be ~2%
    // The actual loss includes price impact from the round trip
    expect(lossBps).toBeGreaterThanOrEqual(150n); // at least 1.5%
    expect(lossBps).toBeLessThanOrEqual(300n);    // at most 3%
  });
});

// ─── 100 Sequential Buys — Monotonic Price Increase ──────────────────────────

describe('100 sequential buys — price must increase monotonically', () => {
  it('price increases after every buy', () => {
    let state = createInitialState();
    let previousPrice = getPrice(state.virtualTonReserves, state.virtualTokenReserves);

    for (let i = 0; i < 100; i++) {
      const tonIn = TON(1); // 1 TON each — large enough for price to always increase
      const { state: newState } = simulateBuy(state, tonIn);
      state = newState;

      const newPrice = getPrice(state.virtualTonReserves, state.virtualTokenReserves);
      expect(newPrice).toBeGreaterThan(previousPrice);
      previousPrice = newPrice;
    }
  });

  it('price increases with varying buy amounts', () => {
    let state = createInitialState();
    let previousPrice = getPrice(state.virtualTonReserves, state.virtualTokenReserves);

    const amounts = [
      TON(1) / 10n, TON(1) / 2n, TON(1), TON(2), TON(1) / 5n,
    ];

    for (let i = 0; i < 100; i++) {
      const tonIn = amounts[i % amounts.length];
      const { state: newState } = simulateBuy(state, tonIn);
      state = newState;

      const newPrice = getPrice(state.virtualTonReserves, state.virtualTokenReserves);
      expect(newPrice).toBeGreaterThan(previousPrice);
      previousPrice = newPrice;
    }
  });
});

// ─── Migration Threshold ─────────────────────────────────────────────────────

describe('Migration threshold', () => {
  it('initial launch market cap is already above the requested 100 TON threshold', () => {
    const initial = createInitialState();
    expect(getMarketCap(initial.virtualTonReserves, initial.virtualTokenReserves)).toBeGreaterThan(MIGRATION_THRESHOLD);
    expect(shouldMigrate(getMarketCap(initial.virtualTonReserves, initial.virtualTokenReserves))).toBe(true);
  });

  it('shouldMigrate returns false below migration threshold', () => {
    expect(shouldMigrate(MIGRATION_THRESHOLD / 2n)).toBe(false);
    expect(shouldMigrate(TON(0))).toBe(false);
    expect(shouldMigrate(MIGRATION_THRESHOLD - 1n)).toBe(false);
  });

  it('shouldMigrate returns true at exactly migration threshold', () => {
    expect(shouldMigrate(MIGRATION_THRESHOLD)).toBe(true);
  });

  it('shouldMigrate returns true above migration threshold', () => {
    expect(shouldMigrate(MIGRATION_THRESHOLD + 1n)).toBe(true);
    expect(shouldMigrate(MIGRATION_THRESHOLD + TON(100))).toBe(true);
  });

  it('accumulates to migration through sequential buys by market cap', () => {
    let state = createInitialState();
    let migrated = false;
    let buyCount = 0;

    while (!migrated && buyCount < 100) {
      const tonIn = TON(1_000);
      const { state: newState } = simulateBuy(state, tonIn);
      state = newState;
      buyCount++;
      migrated = shouldMigrate(getMarketCap(state.virtualTonReserves, state.virtualTokenReserves));
    }

    expect(migrated).toBe(true);
    expect(getMarketCap(state.virtualTonReserves, state.virtualTokenReserves)).toBeGreaterThanOrEqual(MIGRATION_THRESHOLD);
    expect(buyCount).toBeGreaterThan(0);
  });
});

// ─── Price Calculation ───────────────────────────────────────────────────────

describe('getPrice', () => {
  it('returns initial price correctly', () => {
    const price = getPrice(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
    // price = (1080 * 10^9 * 10^18) / (1073 * 10^9 * 10^9)
    expect(price).toBeGreaterThan(0n);

    // Get price in nanotons for human verification
    const priceNano = getPriceInNanotons(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
    // ~27.96 nanotons per nano-token → ~0.02796 TON per whole token
    expect(priceNano).toBeGreaterThan(2_000n);
    expect(priceNano).toBeLessThan(2_100n);
  });

  it('price increases after buys', () => {
    let state = createInitialState();
    const priceBefore = getPrice(state.virtualTonReserves, state.virtualTokenReserves);

    const { state: afterBuy } = simulateBuy(state, TON(5));
    const priceAfter = getPrice(afterBuy.virtualTonReserves, afterBuy.virtualTokenReserves);

    expect(priceAfter).toBeGreaterThan(priceBefore);
  });

  it('price decreases after sells', () => {
    let state = createInitialState();

    // Buy first
    const { state: afterBuy, result: buyResult } = simulateBuy(state, TON(5));
    const priceAfterBuy = getPrice(afterBuy.virtualTonReserves, afterBuy.virtualTokenReserves);

    // Sell half
    const { state: afterSell } = simulateSell(afterBuy, buyResult.tokensOut / 2n);
    const priceAfterSell = getPrice(afterSell.virtualTonReserves, afterSell.virtualTokenReserves);

    expect(priceAfterSell).toBeLessThan(priceAfterBuy);
  });

  it('throws on zero token reserves', () => {
    expect(() => getPrice(TON(10), 0n)).toThrow();
  });
});

// ─── Market Cap ──────────────────────────────────────────────────────────────

describe('getMarketCap', () => {
  it('returns the $5k launch market cap in TON', () => {
    const mcap = getMarketCap(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
    expect(mcap).toBe(START_MARKET_CAP_TON);
  });

  it('market cap increases with buys', () => {
    let state = createInitialState();
    const mcapBefore = getMarketCap(state.virtualTonReserves, state.virtualTokenReserves);

    const { state: afterBuy } = simulateBuy(state, TON(5));
    const mcapAfter = getMarketCap(afterBuy.virtualTonReserves, afterBuy.virtualTokenReserves);

    expect(mcapAfter).toBeGreaterThan(mcapBefore);
  });

  it('market cap decreases with sells', () => {
    let state = createInitialState();
    const { state: afterBuy, result: buyResult } = simulateBuy(state, TON(5));
    const mcapAfterBuy = getMarketCap(afterBuy.virtualTonReserves, afterBuy.virtualTokenReserves);

    const { state: afterSell } = simulateSell(afterBuy, buyResult.tokensOut / 2n);
    const mcapAfterSell = getMarketCap(afterSell.virtualTonReserves, afterSell.virtualTokenReserves);

    expect(mcapAfterSell).toBeLessThan(mcapAfterBuy);
  });
});

// ─── Bonding Progress ────────────────────────────────────────────────────────

describe('getBondingProgress', () => {
  it('returns 0 at start', () => {
    expect(getBondingProgress(0n)).toBe(0);
  });

  it('returns 100 at migration threshold', () => {
    expect(getBondingProgress(MIGRATION_THRESHOLD)).toBe(100);
  });

  it('returns ~50 at half threshold', () => {
    const half = MIGRATION_THRESHOLD / 2n;
    const progress = getBondingProgress(half);
    expect(progress).toBeGreaterThanOrEqual(49);
    expect(progress).toBeLessThanOrEqual(50);
  });

  it('returns 100 above threshold', () => {
    expect(getBondingProgress(MIGRATION_THRESHOLD + 1n)).toBe(100);
  });
});

// ─── Display Helpers ─────────────────────────────────────────────────────────

describe('formatTon', () => {
  it('formats whole TON correctly', () => {
    expect(formatTon(TON(1))).toBe('1.0000');
    expect(formatTon(TON(100))).toBe('100.0000');
  });

  it('formats fractional TON correctly', () => {
    expect(formatTon(1_500_000_000n)).toBe('1.5000');
    expect(formatTon(500_000_000n)).toBe('0.5000');
  });
});

describe('parseTon', () => {
  it('parses whole TON', () => {
    expect(parseTon('1')).toBe(TON(1));
    expect(parseTon('100')).toBe(TON(100));
  });

  it('parses fractional TON', () => {
    expect(parseTon('1.5')).toBe(1_500_000_000n);
    expect(parseTon('0.1')).toBe(100_000_000n);
  });

  it('parseTon and formatTon are inverse', () => {
    const original = '5.1234';
    const nano = parseTon(original);
    expect(formatTon(nano)).toBe('5.1234');
  });
});

// ─── Slippage ────────────────────────────────────────────────────────────────

describe('calculateSlippage', () => {
  it('returns 0 when actual >= expected', () => {
    expect(calculateSlippage(100n, 100n)).toBe(0n);
    expect(calculateSlippage(100n, 200n)).toBe(0n);
  });

  it('returns correct slippage in bps', () => {
    // 1% slippage = 100 bps
    expect(calculateSlippage(10000n, 9900n)).toBe(100n);
    // 5% slippage = 500 bps
    expect(calculateSlippage(10000n, 9500n)).toBe(500n);
  });

  it('returns 0 for zero expected', () => {
    expect(calculateSlippage(0n, 100n)).toBe(0n);
  });
});

// ─── Simulate Functions ──────────────────────────────────────────────────────

describe('simulateBuy / simulateSell', () => {
  it('simulateBuy updates all state fields', () => {
    const state = createInitialState();
    const { state: newState, result } = simulateBuy(state, TON(1));

    expect(newState.virtualTonReserves).toBe(result.newVirtualTonReserves);
    expect(newState.virtualTokenReserves).toBe(result.newVirtualTokenReserves);
    expect(newState.realTonReserves).toBe(result.tonInNet);
    expect(newState.realTokenReserves).toBe(REAL_TOKEN_SUPPLY - result.tokensOut);
  });

  it('simulateSell updates all state fields', () => {
    const state = createInitialState();
    const { state: afterBuy, result: buyResult } = simulateBuy(state, TON(5));
    const { state: afterSell, result: sellResult } = simulateSell(afterBuy, buyResult.tokensOut);

    expect(afterSell.virtualTonReserves).toBe(sellResult.newVirtualTonReserves);
    expect(afterSell.virtualTokenReserves).toBe(sellResult.newVirtualTokenReserves);
    expect(afterSell.realTonReserves).toBe(afterBuy.realTonReserves - sellResult.tonOutGross);
    expect(afterSell.realTokenReserves).toBe(afterBuy.realTokenReserves + sellResult.tokensInNet);
  });

  it('real token reserves never go negative', () => {
    let state = createInitialState();

    // Buy a lot
    for (let i = 0; i < 50; i++) {
      const { state: newState } = simulateBuy(state, TON(1));
      state = newState;
      expect(state.realTokenReserves).toBeGreaterThanOrEqual(0n);
    }
  });
});
