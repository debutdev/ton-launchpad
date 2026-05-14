import { Address, Cell, beginCell, toNano } from '@ton/core';
import {
  getBuyQuote,
  getBondingProgress,
  getMarketCap,
  getPriceInNanotons,
  getRequiredBuyGasReserve,
  getSellQuote,
  MIGRATION_GAS_RESERVE,
} from './bondingCurve';

export const OP_DEPLOY_TOKEN = 0x20001;
export const OP_BUY_TOKENS = 0x10001;
export const OP_SELL_TOKENS = 0x10002;
export const OP_JETTON_TRANSFER = 0x0f8a7ea5;

export const NANOS_PER_UNIT = 1_000_000_000n;
export const NANOS_PER_UNIT_NUMBER = 1_000_000_000;
export const DEFAULT_DEPLOY_VALUE = toNano('0.7');
export const DEFAULT_SELL_TRANSFER_VALUE = toNano('0.25');
export const DEFAULT_SELL_FORWARD_TON = toNano('0.15');
export const TONCONNECT_TESTNET_CHAIN = '-3';
export const DEFAULT_TESTNET_MIGRATION_MARKET_CAP_NANO =
  process.env.NEXT_PUBLIC_TESTNET_MIGRATION_MARKET_CAP_NANO || '2041489812551';

export type DbTokenRow = {
  id?: string | null;
  address?: string;
  jetton_address?: string | null;
  master_address?: string | null;
  creator_address?: string | null;
  name?: string | null;
  symbol?: string | null;
  description?: string | null;
  image_url?: string | null;
  metadata_url?: string | null;
  twitter_url?: string | null;
  telegram_url?: string | null;
  website_url?: string | null;
  virtual_ton_reserves?: string | number | null;
  virtual_token_reserves?: string | number | null;
  real_ton_reserves?: string | number | null;
  real_token_reserves?: string | number | null;
  token_price_ton?: string | number | null;
  token_price_usd?: string | number | null;
  market_cap_ton?: string | number | null;
  market_cap_usd?: string | number | null;
  market_cap_usd_snapshot?: string | number | null;
  migration_market_cap_ton?: string | number | null;
  migration_state?: string | number | null;
  is_migrated?: boolean | null;
  migrated?: boolean | null;
  ston_pool_address?: string | null;
  lp_status?: string | null;
  tx_count?: string | number | null;
  volume_24h_ton?: string | number | null;
  created_at?: string | null;
};

export type DbTradeRow = {
  id?: string | null;
  token_address?: string | null;
  user_address?: string | null;
  trader_address?: string | null;
  type?: 'buy' | 'sell' | string | null;
  source?: 'bonding_curve' | 'dedust' | string | null;
  ton_amount?: string | number | null;
  token_amount?: string | number | null;
  fee_ton?: string | number | null;
  fee_token_amount?: string | number | null;
  market_cap_ton_after?: string | number | null;
  price_ton_after?: string | number | null;
  virtual_ton_after?: string | number | null;
  virtual_token_after?: string | number | null;
  tx_hash?: string | null;
  tx_lt?: string | number | null;
  block_time?: string | null;
  timestamp?: string | null;
  created_at?: string | null;
};

export type DbCandleRow = {
  token_address: string;
  timeframe: '1m' | '5m' | '1h' | '1d' | string;
  bucket_start: string;
  open_market_cap_ton: string | number;
  high_market_cap_ton: string | number;
  low_market_cap_ton: string | number;
  close_market_cap_ton: string | number;
  open_price_ton: string | number;
  high_price_ton: string | number;
  low_price_ton: string | number;
  close_price_ton: string | number;
  buy_volume_ton?: string | number | null;
  sell_volume_ton?: string | number | null;
  total_volume_ton?: string | number | null;
  trade_count?: string | number | null;
};

export function parseNano(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function defaultMigrationMarketCapNano(): bigint {
  return parseNano(DEFAULT_TESTNET_MIGRATION_MARKET_CAP_NANO);
}

export function parseDecimalToNano(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return 0n;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return BigInt(whole || '0') * NANOS_PER_UNIT + BigInt(fraction.padEnd(9, '0').slice(0, 9) || '0');
}

export function formatNano(value: bigint, maxFractionDigits = 4): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / NANOS_PER_UNIT;
  const fraction = (absolute % NANOS_PER_UNIT).toString().padStart(9, '0');
  const trimmedFraction = fraction.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/, '');
  return `${sign}${whole}${trimmedFraction ? `.${trimmedFraction}` : ''}`;
}

export function nanoToNumber(value: bigint): number {
  return Number(value) / NANOS_PER_UNIT_NUMBER;
}

export function compactNumber(value: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    ...options,
  }).format(value);
}

export function shortAddress(address: string): string {
  return address.length < 16 ? address : `${address.slice(0, 6)}...${address.slice(-5)}`;
}

export function resolveIpfsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('ipfs://')) return `https://gateway.pinata.cloud/ipfs/${url.slice('ipfs://'.length)}`;
  return url;
}

export function makeJettonContentCell(metadataUrl: string): Cell {
  return beginCell().storeUint(1, 8).storeStringTail(metadataUrl).endCell();
}

export function deployTokenBody(queryId: bigint, metadataUrl: string, initialBuyTon: bigint = 0n): Cell {
  return beginCell()
    .storeUint(OP_DEPLOY_TOKEN, 32)
    .storeUint(queryId, 64)
    .storeRef(makeJettonContentCell(metadataUrl))
    .storeCoins(initialBuyTon)
    .endCell();
}

export function buyTokensBody(queryId: bigint, minTokensOut: bigint = 0n): Cell {
  return beginCell()
    .storeUint(OP_BUY_TOKENS, 32)
    .storeUint(queryId, 64)
    .storeCoins(minTokensOut)
    .endCell();
}

export function sellForwardPayload(queryId: bigint, minTonOut: bigint = 0n): Cell {
  return beginCell()
    .storeUint(OP_SELL_TOKENS, 32)
    .storeUint(queryId, 64)
    .storeCoins(minTonOut)
    .endCell();
}

export function jettonTransferBody(args: {
  queryId: bigint;
  amount: bigint;
  destination: Address;
  responseDestination: Address | null;
  forwardTonAmount: bigint;
  forwardPayload: Cell;
  forwardPayloadByRef?: boolean;
}): Cell {
  const encodedForwardPayload = args.forwardPayloadByRef
    ? beginCell().storeBit(1).storeRef(args.forwardPayload).endCell()
    : beginCell().storeBit(0).storeSlice(args.forwardPayload.beginParse()).endCell();

  return beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(args.queryId, 64)
    .storeCoins(args.amount)
    .storeAddress(args.destination)
    .storeAddress(args.responseDestination)
    .storeMaybeRef(null)
    .storeCoins(args.forwardTonAmount)
    .storeSlice(encodedForwardPayload.beginParse())
    .endCell();
}

export function quoteBondingCurveBuy(row: DbTokenRow, tonIn: bigint) {
  const virtualTonReserves = parseNano(row.virtual_ton_reserves);
  const virtualTokenReserves = parseNano(row.virtual_token_reserves);
  if (tonIn <= 0n || virtualTonReserves <= 0n || virtualTokenReserves <= 0n) return null;
  const quote = getBuyQuote(tonIn, virtualTonReserves, virtualTokenReserves);
  const migrationCap = parseNano(row.migration_market_cap_ton) || defaultMigrationMarketCapNano();
  const projectedMarketCap = getMarketCap(quote.newVirtualTonReserves, quote.newVirtualTokenReserves);
  const realTonReserves = parseNano(row.real_ton_reserves);
  const legacyTestnetMigrationThreshold = 200_000_000n;
  const isLegacyTestnetCurve = virtualTonReserves < 1_500_000_000_000n;
  const gasReserve = migrationCap > 0n && projectedMarketCap >= migrationCap
    ? MIGRATION_GAS_RESERVE
    : isLegacyTestnetCurve && realTonReserves + tonIn >= legacyTestnetMigrationThreshold
    ? MIGRATION_GAS_RESERVE
    : getRequiredBuyGasReserve(tonIn, virtualTonReserves, virtualTokenReserves);
  return { ...quote, gasReserve, txValue: tonIn + gasReserve };
}

export function quoteBondingCurveSell(row: DbTokenRow, tokensIn: bigint) {
  const virtualTonReserves = parseNano(row.virtual_ton_reserves);
  const virtualTokenReserves = parseNano(row.virtual_token_reserves);
  if (tokensIn <= 0n || virtualTonReserves <= 0n || virtualTokenReserves <= 0n) return null;
  return getSellQuote(tokensIn, virtualTonReserves, virtualTokenReserves);
}

export function normalizeTokenRow(row: DbTokenRow, trades: DbTradeRow[] = []) {
  const virtualTonReserves = parseNano(row.virtual_ton_reserves);
  const virtualTokenReserves = parseNano(row.virtual_token_reserves);
  const computedMarketCapNano = virtualTonReserves > 0n && virtualTokenReserves > 0n
    ? getMarketCap(virtualTonReserves, virtualTokenReserves)
    : 0n;
  const computedPriceNano = virtualTonReserves > 0n && virtualTokenReserves > 0n
    ? getPriceInNanotons(virtualTonReserves, virtualTokenReserves)
    : 0n;
  const marketCapNano = computedMarketCapNano || parseNano(row.market_cap_ton);
  const priceNano = computedPriceNano || parseNano(row.token_price_ton);
  const holderSet = new Set<string>();
  let volumeNano = parseNano(row.volume_24h_ton);

  for (const trade of trades) {
    volumeNano += parseNano(trade.ton_amount);
    const trader = trade.trader_address || trade.user_address;
    if (trader) holderSet.add(trader);
  }

  const migrationState = Number(row.migration_state ?? (row.migrated || row.is_migrated ? 2 : 0));
  const migrationCapNano = parseNano(row.migration_market_cap_ton) || defaultMigrationMarketCapNano();

  return {
    id: row.id || null,
    address: row.address || '',
    creatorAddress: row.creator_address || row.address || '',
    jettonAddress: row.jetton_address || row.master_address || null,
    name: row.name?.trim() || 'Unknown meme',
    ticker: (row.symbol?.trim() || 'UNK').toUpperCase(),
    description: row.description?.trim() || '',
    imageUrl: resolveIpfsUrl(row.image_url),
    metadataUrl: row.metadata_url || null,
    marketCapTon: nanoToNumber(marketCapNano),
    priceTon: nanoToNumber(priceNano),
    holders: holderSet.size,
    volumeTon: nanoToNumber(volumeNano),
    progressPercent: getBondingProgress(marketCapNano),
    migrationMarketCapNano: migrationCapNano.toString(),
    migrationMarketCapTon: nanoToNumber(migrationCapNano),
    migrationState,
    migrated: Boolean(row.migrated || row.is_migrated || migrationState >= 2),
    stonPoolAddress: row.ston_pool_address || null,
    lpStatus: row.lp_status || 'pending',
    txCount: Number(row.tx_count || trades.length || 0),
    virtualTonReserves: virtualTonReserves.toString(),
    virtualTokenReserves: virtualTokenReserves.toString(),
    createdAt: row.created_at || null,
    twitterUrl: row.twitter_url || null,
    telegramUrl: row.telegram_url || null,
    websiteUrl: row.website_url || null,
  };
}
