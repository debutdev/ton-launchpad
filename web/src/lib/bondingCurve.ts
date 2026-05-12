/**
 * Tonked.io — Bonding Curve Math Library
 *
 * Constant product AMM (x * y = k) with virtual reserves.
 * All values are in nanotons / nano-tokens (9 decimal places).
 * BigInt ONLY — no floating point anywhere.
 *
 * This must produce IDENTICAL results to the Tact smart contract.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** 1 TON = 1_000_000_000 nanotons */
export const NANOS_PER_TON = 1_000_000_000n;

/** Total token supply: 1,000,000,000 tokens (in nano-tokens) */
export const TOTAL_SUPPLY = 1_000_000_000n * NANOS_PER_TON;

/** TON/USD snapshot used for launch economics: Binance TONUSDT = 2.454 */
export const TON_USD_PRICE_NUM = 2_454n;
export const TON_USD_PRICE_DEN = 1_000n;

/** Target launch market cap in USD */
export const START_MARKET_CAP_USD = 5_000n;

/** Target migration market cap in USD */
export const MIGRATION_MARKET_CAP_USD = 69_000n;

/** Launch market cap converted to TON at the snapshot price */
export const START_MARKET_CAP_TON = 2_037_489_812_551n;

/** Migration market cap converted to TON at the snapshot price */
export const MIGRATION_MARKET_CAP_TON = 28_117_359_413_203n;

/** Initial virtual token reserves: 1,073,000,191 tokens */
export const INITIAL_VIRTUAL_TOKENS = 1_073_000_191n * NANOS_PER_TON;

/** Initial virtual TON reserves matching the $5k snapshot market cap */
export const INITIAL_VIRTUAL_TON = 2_186_226_958_028n;

/** Real token supply available for bonding curve trading: 793,100,000 tokens */
export const REAL_TOKEN_SUPPLY = 793_100_000n * NANOS_PER_TON;

/** Production migration threshold, measured as market cap in nanotons */
export const MIGRATION_THRESHOLD = MIGRATION_MARKET_CAP_TON;
export const PRODUCTION_MIGRATION_THRESHOLD = MIGRATION_MARKET_CAP_TON;

/** Gas reserve kept by the bonding curve for normal buys */
export const BUY_GAS_RESERVE = NANOS_PER_TON / 10n;

/** Gas reserve kept when a buy triggers DEX migration */
export const MIGRATION_GAS_RESERVE = (NANOS_PER_TON * 8n) / 10n;

/** Buy-side TON fee in basis points. Disabled. */
export const FEE_BPS = 0n;

/** Sell fee in basis points: curve sells pay TON fees; migrated swaps tax tokens. */
export const SELL_TAX_BPS = 200n;

/** Fee denominator for basis points */
export const BPS_DENOMINATOR = 10_000n;

/** Precision multiplier for price calculations (10^18) */
export const PRICE_PRECISION = NANOS_PER_TON * NANOS_PER_TON;

/** Deploy fee: 0.2 TON */
export const DEPLOY_FEE = NANOS_PER_TON / 5n; // 200_000_000n

/** Tokens reserved for DEX migration liquidity (~206,900,000 tokens) */
export const MIGRATION_TOKEN_RESERVE = TOTAL_SUPPLY - REAL_TOKEN_SUPPLY;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BuyQuoteResult {
  /** Tokens the buyer will receive (nano-tokens) */
  tokensOut: bigint;
  /** Bonding curve TON fee, currently always 0 (nanotons) */
  fee: bigint;
  /** Net TON going into reserves (nanotons) */
  tonInNet: bigint;
  /** New virtual TON reserves after trade */
  newVirtualTonReserves: bigint;
  /** New virtual token reserves after trade */
  newVirtualTokenReserves: bigint;
}

export interface SellQuoteResult {
  /** TON the seller will receive (nanotons) */
  tonOut: bigint;
  /** TON platform fee charged from the curve payout (nanotons) */
  fee: bigint;
  /** Gross TON from the curve (nanotons) */
  tonOutGross: bigint;
  /** Tokens received by the curve (nano-tokens) */
  tokensInNet: bigint;
  /** New virtual TON reserves after trade */
  newVirtualTonReserves: bigint;
  /** New virtual token reserves after trade */
  newVirtualTokenReserves: bigint;
}

export interface CurveState {
  virtualTonReserves: bigint;
  virtualTokenReserves: bigint;
  realTonReserves: bigint;
  realTokenReserves: bigint;
}

// ─── Core Math Functions ─────────────────────────────────────────────────────

/**
 * Calculate the legacy bonding-curve TON fee for a given amount.
 * This is disabled and should return 0.
 */
export function calculateFee(amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  return (amount * FEE_BPS) / BPS_DENOMINATOR;
}

export function calculateSellTax(tokensIn: bigint): bigint {
  if (tokensIn <= 0n) return 0n;
  return (tokensIn * SELL_TAX_BPS) / BPS_DENOMINATOR;
}

/**
 * Return the gas reserve a buy must attach for the current testnet migration
 * state. The amount passed here is the user's intended economic buy amount.
 */
export function getRequiredBuyGasReserve(
  tonIn: bigint,
  virtualTonReserves: bigint,
  virtualTokenReserves: bigint,
): bigint {
  if (tonIn <= 0n) return BUY_GAS_RESERVE;

  const quote = getBuyQuote(tonIn, virtualTonReserves, virtualTokenReserves);
  const postBuyMarketCap = getMarketCap(
    quote.newVirtualTonReserves,
    quote.newVirtualTokenReserves,
  );
  return shouldMigrate(postBuyMarketCap) ? MIGRATION_GAS_RESERVE : BUY_GAS_RESERVE;
}

/**
 * Get a quote for buying tokens with TON.
 *
 * Formula:
 *   k = virtualTon * virtualTokens
 *   tonInNet = tonIn
 *   newVirtualTon = virtualTon + tonInNet
 *   newVirtualTokens = k / newVirtualTon
 *   tokensOut = virtualTokens - newVirtualTokens
 *
 * @param tonIn - Amount of TON to spend (nanotons)
 * @param virtualTonReserves - Current virtual TON reserves (nanotons)
 * @param virtualTokenReserves - Current virtual token reserves (nano-tokens)
 * @returns BuyQuoteResult with tokens out, fee, and updated reserves
 * @throws Error if tonIn <= 0 or reserves are invalid
 */
export function getBuyQuote(
  tonIn: bigint,
  virtualTonReserves: bigint,
  virtualTokenReserves: bigint,
): BuyQuoteResult {
  if (tonIn <= 0n) {
    throw new Error('tonIn must be positive');
  }
  if (virtualTonReserves <= 0n || virtualTokenReserves <= 0n) {
    throw new Error('Reserves must be positive');
  }

  // TON fees are disabled for buys.
  const fee = calculateFee(tonIn);
  const tonInNet = tonIn - fee;

  // Constant product: k = x * y
  const k = virtualTonReserves * virtualTokenReserves;

  // New reserves after adding TON
  const newVirtualTonReserves = virtualTonReserves + tonInNet;

  // k / newVirtualTon — integer division rounds down, so newVirtualTokenReserves is
  // slightly lower than the true value, meaning tokensOut is slightly higher.
  // To prevent giving out more tokens than the curve warrants, we round UP
  // the new token reserves by adding (denominator - 1) before dividing.
  const newVirtualTokenReserves =
    (k + newVirtualTonReserves - 1n) / newVirtualTonReserves;

  // Tokens received by buyer
  const tokensOut = virtualTokenReserves - newVirtualTokenReserves;

  if (tokensOut <= 0n) {
    throw new Error('Trade too small — zero tokens out');
  }

  return {
    tokensOut,
    fee,
    tonInNet,
    newVirtualTonReserves,
    newVirtualTokenReserves,
  };
}

/**
 * Get a quote for selling tokens for TON.
 *
 * Formula:
 *   k = virtualTon * virtualTokens
 *   tokensInNet = tokensIn
 *   newVirtualTokens = virtualTokens + tokensInNet
 *   newVirtualTon = k / newVirtualTokens
 *   tonOutGross = virtualTon - newVirtualTon
 *   tonFee = tonOutGross * 2%
 *   tonOutNet = tonOutGross - tonFee
 *
 * @param tokensIn - Amount of tokens to sell (nano-tokens)
 * @param virtualTonReserves - Current virtual TON reserves (nanotons)
 * @param virtualTokenReserves - Current virtual token reserves (nano-tokens)
 * @returns SellQuoteResult with TON out, fee, and updated reserves
 * @throws Error if tokensIn <= 0 or reserves are invalid
 */
export function getSellQuote(
  tokensIn: bigint,
  virtualTonReserves: bigint,
  virtualTokenReserves: bigint,
): SellQuoteResult {
  if (tokensIn <= 0n) {
    throw new Error('tokensIn must be positive');
  }
  if (virtualTonReserves <= 0n || virtualTokenReserves <= 0n) {
    throw new Error('Reserves must be positive');
  }

  const tokensInNet = tokensIn;

  // Constant product: k = x * y
  const k = virtualTonReserves * virtualTokenReserves;

  // New reserves after adding net tokens
  const newVirtualTokenReserves = virtualTokenReserves + tokensInNet;

  // k / newVirtualTokens — round UP new TON reserves so the seller gets
  // slightly less TON (protects the pool from rounding exploitation)
  const newVirtualTonReserves =
    (k + newVirtualTokenReserves - 1n) / newVirtualTokenReserves;

  // TON released by the curve
  const tonOutGross = virtualTonReserves - newVirtualTonReserves;

  if (tonOutGross <= 0n) {
    throw new Error('Trade too small — zero TON out');
  }

  const fee = (tonOutGross * SELL_TAX_BPS) / BPS_DENOMINATOR;
  const tonOut = tonOutGross - fee;

  if (tonOut <= 0n) {
    throw new Error('Trade too small - zero TON after fee');
  }

  return {
    tonOut,
    fee,
    tonOutGross,
    tokensInNet,
    newVirtualTonReserves,
    newVirtualTokenReserves,
  };
}

/**
 * Calculate the current token price.
 *
 * Returns price scaled by PRICE_PRECISION (10^18).
 * To get price of 1 whole token in TON:
 *   priceInTon = getPrice(...) / PRICE_PRECISION
 *
 * To get price in nanotons per whole token:
 *   priceNano = getPrice(...) / NANOS_PER_TON
 *
 * Example: initial price ≈ 27_959_925_442 (scaled by 10^18)
 *   → 27_959_925_442 / 10^9 ≈ 27.96 nanotons per nano-token
 *   → 27_959_925_442 / 10^18 ≈ 0.02796 TON per token
 */
export function getPrice(
  virtualTonReserves: bigint,
  virtualTokenReserves: bigint,
): bigint {
  if (virtualTokenReserves <= 0n) {
    throw new Error('Token reserves must be positive');
  }
  // price = (virtualTon * 10^18) / virtualTokens
  return (virtualTonReserves * PRICE_PRECISION) / virtualTokenReserves;
}

/**
 * Get price of 1 whole token in nanotons (for display / USD conversion).
 */
export function getPriceInNanotons(
  virtualTonReserves: bigint,
  virtualTokenReserves: bigint,
): bigint {
  return getPrice(virtualTonReserves, virtualTokenReserves) / NANOS_PER_TON;
}

/**
 * Calculate market cap in nanotons.
 *
 * marketCap = pricePerToken_nanotons * totalSupplyTokens / NANOS_PER_TON
 */
export function getMarketCap(
  virtualTonReserves: bigint,
  virtualTokenReserves: bigint,
): bigint {
  if (virtualTokenReserves <= 0n) {
    throw new Error('Token reserves must be positive');
  }
  return (virtualTonReserves * TOTAL_SUPPLY) / virtualTokenReserves;
}

/**
 * Check if the bonding curve should migrate to the configured DEX.
 *
 * @param marketCapTon - Current market cap in nanotons
 * @returns true if marketCapTon >= MIGRATION_MARKET_CAP_TON
 */
export function shouldMigrate(marketCapTon: bigint): boolean {
  return marketCapTon >= MIGRATION_MARKET_CAP_TON;
}

/**
 * Create the initial state for a new bonding curve.
 */
export function createInitialState(): CurveState {
  return {
    virtualTonReserves: INITIAL_VIRTUAL_TON,
    virtualTokenReserves: INITIAL_VIRTUAL_TOKENS,
    realTonReserves: 0n,
    realTokenReserves: REAL_TOKEN_SUPPLY,
  };
}

/**
 * Simulate a buy trade and return the updated curve state.
 */
export function simulateBuy(
  state: CurveState,
  tonIn: bigint,
): { state: CurveState; result: BuyQuoteResult } {
  const result = getBuyQuote(
    tonIn,
    state.virtualTonReserves,
    state.virtualTokenReserves,
  );

  const newState: CurveState = {
    virtualTonReserves: result.newVirtualTonReserves,
    virtualTokenReserves: result.newVirtualTokenReserves,
    realTonReserves: state.realTonReserves + result.tonInNet,
    realTokenReserves: state.realTokenReserves - result.tokensOut,
  };

  return { state: newState, result };
}

/**
 * Simulate a sell trade and return the updated curve state.
 */
export function simulateSell(
  state: CurveState,
  tokensIn: bigint,
): { state: CurveState; result: SellQuoteResult } {
  const result = getSellQuote(
    tokensIn,
    state.virtualTonReserves,
    state.virtualTokenReserves,
  );

  const newState: CurveState = {
    virtualTonReserves: result.newVirtualTonReserves,
    virtualTokenReserves: result.newVirtualTokenReserves,
    realTonReserves: state.realTonReserves - result.tonOutGross,
    realTokenReserves: state.realTokenReserves + result.tokensInNet,
  };

  return { state: newState, result };
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

/**
 * Convert nanotons to a human-readable TON string.
 */
export function formatTon(nanotons: bigint, decimals: number = 4): string {
  const whole = nanotons / NANOS_PER_TON;
  const frac = nanotons % NANOS_PER_TON;
  const fracStr = frac.toString().padStart(9, '0').slice(0, decimals);
  return `${whole}.${fracStr}`;
}

/**
 * Convert nano-tokens to a human-readable token string.
 */
export function formatTokens(nanoTokens: bigint, decimals: number = 2): string {
  const whole = nanoTokens / NANOS_PER_TON;
  const frac = nanoTokens % NANOS_PER_TON;
  const fracStr = frac.toString().padStart(9, '0').slice(0, decimals);
  if (decimals === 0) return whole.toString();
  return `${whole}.${fracStr}`;
}

/**
 * Parse a TON amount string (e.g. "1.5") to nanotons.
 */
export function parseTon(ton: string): bigint {
  const parts = ton.split('.');
  const whole = BigInt(parts[0] || '0') * NANOS_PER_TON;
  if (parts.length === 1 || !parts[1]) return whole;
  const fracStr = parts[1].padEnd(9, '0').slice(0, 9);
  return whole + BigInt(fracStr);
}

/**
 * Calculate the bonding progress as a percentage (0–100).
 * Returns an integer percentage.
 */
export function getBondingProgress(marketCapTon: bigint): number {
  if (marketCapTon <= 0n) return 0;
  if (marketCapTon >= MIGRATION_MARKET_CAP_TON) return 100;
  return Number((marketCapTon * 100n) / MIGRATION_MARKET_CAP_TON);
}

/**
 * Calculate slippage between expected and actual amounts.
 * Returns basis points (100 = 1%).
 */
export function calculateSlippage(
  expected: bigint,
  actual: bigint,
): bigint {
  if (expected <= 0n) return 0n;
  if (actual >= expected) return 0n;
  return ((expected - actual) * BPS_DENOMINATOR) / expected;
}
