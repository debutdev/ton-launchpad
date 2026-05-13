import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Address, beginCell, Cell, Slice } from '@ton/core';
import { TonClient } from '@ton/ton';
import { DEX } from '@ston-fi/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  INITIAL_VIRTUAL_TOKENS,
  INITIAL_VIRTUAL_TON,
  REAL_TOKEN_SUPPLY,
  TON_USD_PRICE_DEN,
  TON_USD_PRICE_NUM,
  TOTAL_SUPPLY,
  getMarketCap,
  getPriceInNanotons,
} from '../lib/bondingCurve';
import { CURRENT_ACTON_TESTNET_FACTORY_ADDRESS } from './deployment_config';

dotenv.config();

const FACTORY_ADDRESS =
  CURRENT_ACTON_TESTNET_FACTORY_ADDRESS ||
  process.env.ACTON_TESTNET_FACTORY_ADDRESS ||
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  'EQBcjlqVj-4x5NYsGWmJPyM599BK4lsoyrxPWA4ze9spwo9N';
const PLATFORM_WALLET_ADDRESS = process.env.TESTNET_PLATFORM_WALLET || process.env.NEXT_PUBLIC_PLATFORM_WALLET || '';
const PLATFORM_WALLET = PLATFORM_WALLET_ADDRESS ? Address.parse(PLATFORM_WALLET_ADDRESS) : null;
const STONFI_ROUTER = process.env.STONFI_ROUTER_ADDRESS ? Address.parse(process.env.STONFI_ROUTER_ADDRESS) : null;
const STONFI_PTON_PROXY = process.env.STONFI_PTON_PROXY_ADDRESS ? Address.parse(process.env.STONFI_PTON_PROXY_ADDRESS) : null;
const LIVE_EVENTS_WEBHOOK_URL = process.env.LIVE_EVENTS_WEBHOOK_URL || '';
const LIVE_EVENTS_SECRET = process.env.LIVE_EVENTS_SECRET || '';
const FACTORY_POLL_INTERVAL_MS = Number(process.env.INDEXER_FACTORY_POLL_INTERVAL_MS || 12000);
const CURVE_POLL_INTERVAL_MS = Number(process.env.INDEXER_CURVE_POLL_INTERVAL_MS || 5000);
const POOL_POLL_INTERVAL_MS = Number(process.env.INDEXER_POOL_POLL_INTERVAL_MS || 6000);
const CURVES_PER_TICK = Math.max(1, Number(process.env.INDEXER_CURVES_PER_TICK || 2));
const POOLS_PER_TICK = Math.max(1, Number(process.env.INDEXER_POOLS_PER_TICK || 2));
const RPC_RETRY_ATTEMPTS = Math.max(1, Number(process.env.INDEXER_RPC_RETRY_ATTEMPTS || 3));
const RPC_RETRY_BASE_MS = Math.max(1000, Number(process.env.INDEXER_RPC_RETRY_BASE_MS || 4000));
const INDEXER_LOCK_PATH = process.env.INDEXER_LOCK_PATH || path.join(process.cwd(), 'logs', 'indexer.lock');
const TONAPI_WEBHOOK_PORT = Number(process.env.PORT || process.env.TONAPI_WEBHOOK_PORT || 8790);
const TONAPI_WEBHOOK_SECRET = process.env.TONAPI_WEBHOOK_SECRET || '';
const TONAPI_WEBHOOK_ENABLED = process.env.TONAPI_WEBHOOK_ENABLED !== 'false';
const TON_USD_PRICE = Number(TON_USD_PRICE_NUM) / Number(TON_USD_PRICE_DEN);

const OP_TOKEN_DEPLOYED = 0x20002;
const OP_BUY_TOKENS = 0x10001;
const OP_SELL_TOKENS = 0x10002;
const OP_JETTON_NOTIFICATION = 0x7362d09c;
const OP_MINT = 0x642b7d07;
const OP_JETTON_TRANSFER_INTERNAL = 0x178d4519;
const OP_STONFI_SWAP = 0x6664de2a;
const OP_STONFI_PAY_TO = 0x657b54f5;
const BUY_GAS_RESERVE = 100000000n;
const MIGRATION_GAS_RESERVE = 1200000000n;
const SELL_TAX_NUMERATOR = 2n;
const SELL_TAX_DENOMINATOR = 100n;

type TokenRow = {
  address: string;
  jetton_address?: string | null;
  master_address?: string | null;
  virtual_ton_reserves?: string | number | null;
  virtual_token_reserves?: string | number | null;
  real_ton_reserves?: string | number | null;
  real_token_reserves?: string | number | null;
  migration_state?: number | string | null;
  ston_pool_address?: string | null;
  created_at?: string | null;
};

type ReserveSnapshot = {
  virtualTonReserves: bigint;
  virtualTokenReserves: bigint;
  realTonReserves: bigint;
  realTokenReserves: bigint;
  currentSupply: bigint;
  migrationState: number;
  migrated: boolean;
  marketCapTon: bigint;
  priceTon: bigint;
};

type StonPoolState = {
  tokenAddress: string;
  jettonAddress: string;
  lastReserve0: bigint;
  lastReserve1: bigint;
  tokenReserveIndex: 0 | 1 | null;
  token0WalletAddress?: string;
  token1WalletAddress?: string;
  customRouterWalletAddress?: string;
};

type StonPoolData = {
  reserve0: bigint;
  reserve1: bigint;
  token0WalletAddress: Address;
  token1WalletAddress: Address;
};

type StonfiPoolSwap = {
  fromUser: Address;
  amount0In: bigint;
  amount1In: bigint;
};

type StonfiPayTo = {
  toAddress: Address;
  originalCaller: Address;
  exitCode: number;
  amount0Out: bigint;
  amount1Out: bigint;
  token0Address: Address;
  token1Address: Address;
};

type TonapiWebhookBody = {
  account_id?: string;
  lt?: number | string;
  tx_hash?: string;
};

const client = new TonClient({
  endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
  apiKey: process.env.TONCENTER_API_KEY || undefined,
});

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const seenTxs = new Set<string>();
const bondingCurves = new Map<string, { address: string }>();
const stonPools = new Map<string, StonPoolState>();
const pollRunning = new Map<string, boolean>();
const lastRetryLog = new Map<string, number>();
const invalidCurveAddresses = new Set<string>();
let curveCursor = 0;
let poolCursor = 0;

function acquireIndexerLock() {
  fs.mkdirSync(path.dirname(INDEXER_LOCK_PATH), { recursive: true });
  try {
    const fd = fs.openSync(INDEXER_LOCK_PATH, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch {
    const pid = fs.existsSync(INDEXER_LOCK_PATH) ? fs.readFileSync(INDEXER_LOCK_PATH, 'utf8').trim() : 'unknown';
    throw new Error(`Another indexer appears to be running (lock ${INDEXER_LOCK_PATH}, pid ${pid}). Close old indexer terminals or delete the stale lock file.`);
  }

  const release = () => {
    try {
      if (fs.existsSync(INDEXER_LOCK_PATH) && fs.readFileSync(INDEXER_LOCK_PATH, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(INDEXER_LOCK_PATH);
      }
    } catch {
      // Best-effort cleanup on shutdown.
    }
  };

  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(0);
  });
}

function parseNano(value: unknown): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  try {
    return BigInt(value as string | number | bigint);
  } catch {
    return 0n;
  }
}

function inferBuyAmount(attachedTon: bigint): bigint {
  if (attachedTon <= BUY_GAS_RESERVE) return 0n;
  const gasReserve = attachedTon > MIGRATION_GAS_RESERVE ? MIGRATION_GAS_RESERVE : BUY_GAS_RESERVE;
  return attachedTon > gasReserve ? attachedTon - gasReserve : 0n;
}

function sameAddress(a: Address | string | null | undefined, b: Address | string | null | undefined): boolean {
  if (!a || !b) return false;
  return (typeof a === 'string' ? Address.parse(a) : a).equals(typeof b === 'string' ? Address.parse(b) : b);
}

function grossFromSellTaxNet(netAmount: bigint): bigint {
  if (netAmount <= 0n) return 0n;
  let gross = (netAmount * SELL_TAX_DENOMINATOR + (SELL_TAX_DENOMINATOR - SELL_TAX_NUMERATOR - 1n)) / (SELL_TAX_DENOMINATOR - SELL_TAX_NUMERATOR);
  while (gross - (gross * SELL_TAX_NUMERATOR / SELL_TAX_DENOMINATOR) < netAmount) gross += 1n;
  while (gross > 0n && gross - (gross * SELL_TAX_NUMERATOR / SELL_TAX_DENOMINATOR) > netAmount) gross -= 1n;
  return gross;
}

function readMaybeRef(slice: Slice): Cell | null {
  if (slice.remainingBits === 0) return null;
  return slice.loadMaybeRef();
}

function parseForwardPayload(slice: Slice): Slice | null {
  const payloadCell = beginCell().storeSlice(slice).endCell();

  try {
    const direct = payloadCell.beginParse();
    if (direct.remainingBits >= 32 && direct.preloadUint(32) === OP_SELL_TOKENS) return direct;
  } catch {
    // Fall through to TEP-74 Either<Cell, ^Cell> parsing.
  }

  try {
    const either = payloadCell.beginParse();
    if (either.remainingBits < 1) return null;
    const byRef = either.loadBit();
    return byRef ? either.loadRef().beginParse() : either;
  } catch {
    return null;
  }
}

function txTime(tx: { now?: number }): string {
  return new Date(Number(tx.now || Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

function parseMintedAmount(body: Cell | null | undefined): bigint {
  if (!body) return 0n;
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_MINT) return 0n;
    slice.loadUintBig(64);
    slice.loadAddress();
    const transfer = slice.loadRef().beginParse();
    if (transfer.loadUint(32) !== OP_JETTON_TRANSFER_INTERNAL) return 0n;
    transfer.loadUintBig(64);
    return transfer.loadCoins();
  } catch {
    return 0n;
  }
}

function getBucketStart(date: Date, timeframe: '1m' | '5m' | '1h' | '1d'): string {
  const bucket = new Date(date);
  bucket.setUTCSeconds(0, 0);
  if (timeframe === '5m') bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 5) * 5);
  if (timeframe === '1h') bucket.setUTCMinutes(0);
  if (timeframe === '1d') bucket.setUTCHours(0, 0, 0, 0);
  return bucket.toISOString();
}

function contentUrlFromCell(content: Cell): string {
  try {
    const slice = content.beginParse();
    const tag = slice.loadUint(8);
    if (tag !== 1) return '';
    return slice.loadStringTail();
  } catch {
    return '';
  }
}

function ipfsToGateway(url: string): string {
  return url.startsWith('ipfs://') ? `https://gateway.pinata.cloud/ipfs/${url.slice('ipfs://'.length)}` : url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableRpcError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { isAxiosError?: boolean; response?: { status?: number }; message?: string; code?: string };
  const message = maybe.message || '';
  return Boolean(
    maybe.isAxiosError ||
    maybe.response?.status === 429 ||
    maybe.code === 'ECONNRESET' ||
    message.includes('429') ||
    message.includes('EOF') ||
    message.includes('ECONNRESET') ||
    message.includes('socket hang up'),
  );
}

function logRetriable(label: string, attempt: number, delay: number, error: unknown) {
  const now = Date.now();
  const last = lastRetryLog.get(label) || 0;
  if (now - last < 30000) return;
  lastRetryLog.set(label, now);
  const message = error instanceof Error ? error.message : String(error);
  console.log(`RPC retry ${attempt}/${RPC_RETRY_ATTEMPTS} on ${label}: ${message}; waiting ${Math.round(delay / 1000)}s`);
}

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= RPC_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetriableRpcError(error) || attempt === RPC_RETRY_ATTEMPTS) throw error;
      const delay = RPC_RETRY_BASE_MS * attempt;
      logRetriable(label, attempt, delay, error);
      await sleep(delay);
    }
  }

  throw new Error(`RPC retry exhausted: ${label}`);
}

function selectBatch<T>(items: T[], cursor: number, count: number): { batch: T[]; nextCursor: number } {
  if (items.length === 0) return { batch: [], nextCursor: 0 };
  const size = Math.min(count, items.length);
  const batch: T[] = [];
  for (let index = 0; index < size; index += 1) {
    batch.push(items[(cursor + index) % items.length]);
  }
  return { batch, nextCursor: (cursor + size) % items.length };
}

function startPoller(label: string, intervalMs: number, fn: () => Promise<void>) {
  const run = async () => {
    if (pollRunning.get(label)) return;
    pollRunning.set(label, true);
    try {
      await fn();
    } catch (error) {
      console.error(`${label} poller error:`, error instanceof Error ? error.message : error);
    } finally {
      pollRunning.set(label, false);
    }
  };

  setInterval(() => void run(), intervalMs);
  void run();
}

function markInvalidCurve(address: string, reason: string) {
  if (invalidCurveAddresses.has(address)) return;
  invalidCurveAddresses.add(address);
  bondingCurves.delete(address);
  console.warn(`Skipping non-readable curve ${address.slice(0, 12)}...: ${reason}`);
}

function readHttpBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Webhook body too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function parseAnyAddress(value: string): Address | null {
  try {
    return value.includes(':') ? Address.parseRaw(value) : Address.parse(value);
  } catch {
    return null;
  }
}

function findAddressIndex(addresses: string[], target: Address): number {
  return addresses.findIndex((candidate) => sameAddress(candidate, target));
}

async function processTonapiWebhook(event: TonapiWebhookBody) {
  if (!event.account_id) return;
  const account = parseAnyAddress(event.account_id);
  if (!account) {
    console.warn('Ignoring TonAPI webhook with invalid account_id');
    return;
  }

  if (sameAddress(account, FACTORY_ADDRESS)) {
    await pollFactory();
    return;
  }

  const curves = Array.from(bondingCurves.keys());
  const curveIndex = findAddressIndex(curves, account);
  if (curveIndex >= 0) {
    curveCursor = curveIndex;
    await pollBondingCurves();
    return;
  }

  const pools = Array.from(stonPools.keys());
  const poolIndex = findAddressIndex(pools, account);
  if (poolIndex >= 0) {
    poolCursor = poolIndex;
    await pollStonfiPools();
    return;
  }

  console.log(`TonAPI webhook ignored for unwatched account ${event.account_id}`);
}

function startTonapiWebhookReceiver() {
  if (!TONAPI_WEBHOOK_ENABLED) return;

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, factory: FACTORY_ADDRESS }));
      return;
    }

    if (request.method !== 'POST' || url.pathname !== '/tonapi/webhook') {
      response.writeHead(404).end('Not found');
      return;
    }

    if (TONAPI_WEBHOOK_SECRET && url.searchParams.get('secret') !== TONAPI_WEBHOOK_SECRET) {
      response.writeHead(401).end('Unauthorized');
      return;
    }

    try {
      const event = JSON.parse(await readHttpBody(request)) as TonapiWebhookBody;
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      void processTonapiWebhook(event).catch((error) => {
        console.error('TonAPI webhook processing error:', error instanceof Error ? error.message : error);
      });
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Bad request' }));
    }
  });

  server.listen(TONAPI_WEBHOOK_PORT, () => {
    console.log(`TonAPI webhook receiver listening on http://0.0.0.0:${TONAPI_WEBHOOK_PORT}/tonapi/webhook`);
  });
}

async function publishLiveEvent(type: string, payload: unknown) {
  if (!LIVE_EVENTS_WEBHOOK_URL) return;
  try {
    await fetch(LIVE_EVENTS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(LIVE_EVENTS_SECRET ? { authorization: `Bearer ${LIVE_EVENTS_SECRET}` } : {}),
      },
      body: JSON.stringify({ type, payload, createdAt: new Date().toISOString() }),
    });
  } catch (error) {
    console.error('Live webhook publish error:', error instanceof Error ? error.message : error);
  }
}

async function fetchTokenMetadata(jettonMaster: Address) {
  try {
    const result = await retry('get_jetton_data', () => client.runMethod(jettonMaster, 'get_jetton_data'));
    result.stack.readBigNumber();
    result.stack.readBoolean();
    result.stack.readAddress();
    const metadataUrl = contentUrlFromCell(result.stack.readCell());
    if (!metadataUrl) return {};

    const response = await fetch(ipfsToGateway(metadataUrl));
    if (!response.ok) return { metadata_url: metadataUrl };
    const metadata = await response.json() as Record<string, unknown>;

    return {
      metadata_url: metadataUrl,
      name: typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : 'Unknown',
      symbol: typeof metadata.symbol === 'string' && metadata.symbol.trim() ? metadata.symbol.trim().toUpperCase() : 'UNK',
      description: typeof metadata.description === 'string' ? metadata.description : null,
      image_url: typeof metadata.image === 'string' ? metadata.image : null,
      twitter_url: typeof metadata.twitter === 'string' ? metadata.twitter : null,
      telegram_url: typeof metadata.telegram === 'string' ? metadata.telegram : null,
      website_url: typeof metadata.website === 'string' ? metadata.website : null,
    };
  } catch (error) {
    console.error('Metadata fetch error:', error instanceof Error ? error.message : error);
    return {};
  }
}

async function getTokenRow(address: string): Promise<TokenRow | null> {
  const { data, error } = await supabase
    .from('tokens')
    .select('address, jetton_address, master_address, virtual_ton_reserves, virtual_token_reserves, real_ton_reserves, real_token_reserves, migration_state, ston_pool_address')
    .eq('address', address)
    .maybeSingle();
  if (error) {
    console.error('Token row query error:', error.message);
    return null;
  }
  return data as TokenRow | null;
}

async function upsertToken(record: Record<string, unknown>, eventType: 'token.created' | 'token.updated') {
  const { data, error } = await supabase
    .from('tokens')
    .upsert(record, { onConflict: 'address' })
    .select()
    .single();
  if (error) {
    console.error('Token upsert error:', error.message);
    return null;
  }
  await publishLiveEvent(eventType, data);
  return data;
}

async function updateToken(address: string, record: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('tokens')
    .update(record)
    .eq('address', address)
    .select()
    .maybeSingle();
  if (error) {
    console.error('Token update error:', error.message);
    return null;
  }
  if (data) await publishLiveEvent('token.updated', data);
  return data;
}

async function upsertTrade(record: Record<string, unknown>) {
  const normalized = {
    source: 'bonding_curve',
    ...record,
    user_address: record.user_address || record.trader_address,
    trader_address: record.trader_address || record.user_address,
  };
  const { data, error } = await supabase
    .from('trades')
    .upsert(normalized, { onConflict: 'tx_hash' })
    .select()
    .single();
  if (error) {
    console.error('Trade upsert error:', error.message);
    return null;
  }
  await publishLiveEvent('trade.created', data);
  return data;
}

async function getRouterWalletAddress(jettonMaster: Address): Promise<Address | null> {
  if (!STONFI_ROUTER) return null;
  try {
    const result = await retry('get_wallet_address(router)', () =>
      client.runMethod(jettonMaster, 'get_wallet_address', [
        { type: 'slice', cell: beginCell().storeAddress(STONFI_ROUTER).endCell() },
      ]),
    );
    return result.stack.readAddress();
  } catch (error) {
    console.error('Router wallet lookup error:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function ensureStonPoolState(poolAddress: string, state: StonPoolState, data: StonPoolData) {
  state.token0WalletAddress = data.token0WalletAddress.toString();
  state.token1WalletAddress = data.token1WalletAddress.toString();

  if (state.tokenReserveIndex !== null) return;

  const customRouterWallet = await getRouterWalletAddress(Address.parse(state.jettonAddress));
  if (customRouterWallet) {
    state.customRouterWalletAddress = customRouterWallet.toString();
    if (sameAddress(customRouterWallet, data.token0WalletAddress)) {
      state.tokenReserveIndex = 0;
      return;
    }
    if (sameAddress(customRouterWallet, data.token1WalletAddress)) {
      state.tokenReserveIndex = 1;
      return;
    }
  }

  state.tokenReserveIndex = 0;
  console.warn(`Could not match custom router wallet for STON.fi pool ${poolAddress}; falling back to token0 as custom token`);
}

function poolMarketData(state: StonPoolState, data: StonPoolData) {
  const tokenReserve = state.tokenReserveIndex === 1 ? data.reserve1 : data.reserve0;
  const tonReserve = state.tokenReserveIndex === 1 ? data.reserve0 : data.reserve1;
  const marketCapTon = tokenReserve > 0n ? (tonReserve * TOTAL_SUPPLY) / tokenReserve : 0n;
  const priceTon = tokenReserve > 0n ? (tonReserve * 1000000000n * 1000000000n) / tokenReserve : 0n;
  return { tokenReserve, tonReserve, marketCapTon, priceTon };
}

function parsePoolSwapBody(body: Cell): StonfiPoolSwap | null {
  const parse = (skipQueryId: boolean): StonfiPoolSwap | null => {
    try {
      const slice = body.beginParse();
      if (slice.loadUint(32) !== OP_STONFI_SWAP) return null;
      if (skipQueryId) slice.loadUintBig(64);
      const fromUser = slice.loadAddress();
      const amount0In = slice.loadCoins();
      const amount1In = slice.loadCoins();
      if (amount0In <= 0n && amount1In <= 0n) return null;
      return { fromUser, amount0In, amount1In };
    } catch {
      return null;
    }
  };

  return parse(true) || parse(false);
}

function parsePayToBody(body: Cell): StonfiPayTo | null {
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_STONFI_PAY_TO) return null;
    slice.loadUintBig(64);
    const toAddress = slice.loadAddress();
    slice.loadAddress();
    const originalCaller = slice.loadAddress();
    const exitCode = slice.loadUint(32);
    readMaybeRef(slice);
    if (slice.remainingRefs === 0) return null;
    const additional = slice.loadRef().beginParse();
    additional.loadCoins();
    const amount0Out = additional.loadCoins();
    const token0Address = additional.loadAddress();
    const amount1Out = additional.loadCoins();
    const token1Address = additional.loadAddress();
    return { toAddress, originalCaller, exitCode, amount0Out, amount1Out, token0Address, token1Address };
  } catch {
    return null;
  }
}

function findPayTo(tx: Awaited<ReturnType<TonClient['getTransactions']>>[number]): StonfiPayTo | null {
  for (const outMsg of tx.outMessages.values()) {
    if (!outMsg.body) continue;
    const payTo = parsePayToBody(outMsg.body);
    if (payTo) return payTo;
  }
  return null;
}

async function recordExactStonfiSwap(args: {
  tokenAddress: string;
  poolAddress: string;
  txHash: string;
  txLt: string;
  at: string;
  type: 'buy' | 'sell';
  trader: Address;
  tokenAmount: bigint;
  tonAmount: bigint;
  marketCapTon: bigint;
  priceTon: bigint;
  feeTokenAmount: bigint;
}) {
  const trade = await upsertTrade({
    token_address: args.tokenAddress,
    trader_address: args.trader.toString(),
    user_address: args.trader.toString(),
    type: args.type,
    source: 'stonfi',
    ton_amount: args.tonAmount.toString(),
    token_amount: args.tokenAmount.toString(),
    fee_ton: '0',
    fee_token_amount: args.feeTokenAmount.toString(),
    platform_revenue_token_amount: args.feeTokenAmount.toString(),
    token_price_ton: args.priceTon.toString(),
    token_price_usd: (Number(args.priceTon) / 1e9 * TON_USD_PRICE).toString(),
    market_cap_ton_after: args.marketCapTon.toString(),
    price_ton_after: args.priceTon.toString(),
    block_time: args.at,
    tx_lt: args.txLt,
    tx_hash: args.txHash,
  });

  if (trade) {
    await upsertCandles({
      tokenAddress: args.tokenAddress,
      type: args.type,
      tonAmount: args.tonAmount,
      marketCapTon: args.marketCapTon,
      priceTon: args.priceTon,
      at: args.at,
    });
    await refreshTradeCount(args.tokenAddress);
  }
  return trade;
}

async function recordStonfiPoolMove(args: {
  poolAddress: string;
  tokenAddress: string;
  type: 'buy' | 'sell';
  tokenAmount: bigint;
  tonAmount: bigint;
  marketCapTon: bigint;
  priceTon: bigint;
  at: string;
  sequence: string;
}) {
  const txHash = `stonfi:${args.poolAddress}:${args.sequence}`;
  const trade = await upsertTrade({
    token_address: args.tokenAddress,
    trader_address: args.poolAddress,
    user_address: args.poolAddress,
    type: args.type,
    source: 'stonfi',
    ton_amount: args.tonAmount.toString(),
    token_amount: args.tokenAmount.toString(),
    fee_ton: '0',
    fee_token_amount: args.type === 'sell' ? (args.tokenAmount * 2n / 100n).toString() : '0',
    platform_revenue_token_amount: args.type === 'sell' ? (args.tokenAmount * 2n / 100n).toString() : '0',
    token_price_ton: args.priceTon.toString(),
    token_price_usd: (Number(args.priceTon) / 1e9 * TON_USD_PRICE).toString(),
    market_cap_ton_after: args.marketCapTon.toString(),
    price_ton_after: args.priceTon.toString(),
    block_time: args.at,
    tx_lt: '0',
    tx_hash: txHash,
  });

  if (trade) {
    await refreshTradeCount(args.tokenAddress);
  }
  return trade;
}

async function upsertCandles(args: {
  tokenAddress: string;
  type: 'buy' | 'sell';
  tonAmount: bigint;
  marketCapTon: bigint;
  priceTon: bigint;
  at: string;
}) {
  const timeframes: Array<'1m' | '5m' | '1h' | '1d'> = ['1m', '5m', '1h', '1d'];
  const at = new Date(args.at);

  for (const timeframe of timeframes) {
    const bucketStart = getBucketStart(at, timeframe);
    const { data: existing } = await supabase
      .from('token_candles')
      .select('*')
      .eq('token_address', args.tokenAddress)
      .eq('timeframe', timeframe)
      .eq('bucket_start', bucketStart)
      .maybeSingle();

    const buyVolume = args.type === 'buy' ? args.tonAmount : 0n;
    const sellVolume = args.type === 'sell' ? args.tonAmount : 0n;
    const candle = existing
      ? {
          ...existing,
          high_market_cap_ton: (parseNano(existing.high_market_cap_ton) > args.marketCapTon ? parseNano(existing.high_market_cap_ton) : args.marketCapTon).toString(),
          low_market_cap_ton: (parseNano(existing.low_market_cap_ton) < args.marketCapTon ? parseNano(existing.low_market_cap_ton) : args.marketCapTon).toString(),
          close_market_cap_ton: args.marketCapTon.toString(),
          high_price_ton: (parseNano(existing.high_price_ton) > args.priceTon ? parseNano(existing.high_price_ton) : args.priceTon).toString(),
          low_price_ton: (parseNano(existing.low_price_ton) < args.priceTon ? parseNano(existing.low_price_ton) : args.priceTon).toString(),
          close_price_ton: args.priceTon.toString(),
          buy_volume_ton: (parseNano(existing.buy_volume_ton) + buyVolume).toString(),
          sell_volume_ton: (parseNano(existing.sell_volume_ton) + sellVolume).toString(),
          total_volume_ton: (parseNano(existing.total_volume_ton) + args.tonAmount).toString(),
          trade_count: Number(existing.trade_count || 0) + 1,
          updated_at: new Date().toISOString(),
        }
      : {
          token_address: args.tokenAddress,
          timeframe,
          bucket_start: bucketStart,
          open_market_cap_ton: args.marketCapTon.toString(),
          high_market_cap_ton: args.marketCapTon.toString(),
          low_market_cap_ton: args.marketCapTon.toString(),
          close_market_cap_ton: args.marketCapTon.toString(),
          open_price_ton: args.priceTon.toString(),
          high_price_ton: args.priceTon.toString(),
          low_price_ton: args.priceTon.toString(),
          close_price_ton: args.priceTon.toString(),
          buy_volume_ton: buyVolume.toString(),
          sell_volume_ton: sellVolume.toString(),
          total_volume_ton: args.tonAmount.toString(),
          trade_count: 1,
        };

    const { data, error } = await supabase
      .from('token_candles')
      .upsert(candle, { onConflict: 'token_address,timeframe,bucket_start' })
      .select()
      .single();
    if (error) {
      console.error('Candle upsert error:', error.message);
    } else {
      await publishLiveEvent('candle.updated', data);
    }
  }
}

async function deriveStonPool(tokenAddress: string, jettonAddress: string): Promise<string | null> {
  if (!STONFI_ROUTER || !STONFI_PTON_PROXY) return null;
  try {
    const router = new DEX.v2_1.Router.CPI(STONFI_ROUTER);
    const poolAddress = await router.getPoolAddressByJettonMinters(client as any, {
      token0: Address.parse(jettonAddress),
      token1: STONFI_PTON_PROXY,
    });
    const pool = poolAddress.toString();
    stonPools.set(pool, {
      tokenAddress,
      jettonAddress,
      lastReserve0: 0n,
      lastReserve1: 0n,
      tokenReserveIndex: null,
    });
    return pool;
  } catch (error) {
    console.error('STON.fi pool derive error:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function updateReserves(bcAddress: string): Promise<ReserveSnapshot | null> {
  try {
    const result = await retry('getReserves', () => client.runMethod(Address.parse(bcAddress), 'getReserves'));
    const reader = result.stack;
    const virtualTonReserves = reader.readBigNumber();
    const virtualTokenReserves = reader.readBigNumber();
    const realTonReserves = reader.readBigNumber();
    const realTokenReserves = reader.readBigNumber();
    const fifthValue = reader.readBigNumber();
    let currentSupply = REAL_TOKEN_SUPPLY - realTokenReserves;
    let migrationState = fifthValue === 0n ? 0 : 2;
    try {
      currentSupply = fifthValue;
      migrationState = Number(reader.readBigNumber());
    } catch {
      // Older testnet curves returned ReserveData as:
      // virtualTon, virtualToken, realTon, realToken, migrated.
      // Keep them indexable while the live factory is being rolled forward.
    }
    const marketCapTon = getMarketCap(virtualTonReserves, virtualTokenReserves);
    const priceTon = getPriceInNanotons(virtualTonReserves, virtualTokenReserves);
    const migrated = migrationState >= 2;
    const row = await getTokenRow(bcAddress);
    const jettonAddress = row?.jetton_address || row?.master_address || '';
    const stonPoolAddress = migrated && jettonAddress && !row?.ston_pool_address
      ? await deriveStonPool(bcAddress, jettonAddress)
      : row?.ston_pool_address || null;

    await updateToken(bcAddress, {
      virtual_ton_reserves: virtualTonReserves.toString(),
      virtual_token_reserves: virtualTokenReserves.toString(),
      real_ton_reserves: realTonReserves.toString(),
      real_token_reserves: realTokenReserves.toString(),
      token_price_ton: priceTon.toString(),
      token_price_usd: (Number(priceTon) / 1e9 * TON_USD_PRICE).toString(),
      market_cap_ton: marketCapTon.toString(),
      market_cap_usd: (Number(marketCapTon) / 1e9 * TON_USD_PRICE).toString(),
      market_cap_usd_snapshot: TON_USD_PRICE.toString(),
      migration_state: migrationState,
      is_migrated: migrated,
      migrated,
      ston_pool_address: stonPoolAddress,
      lp_status: migrationState >= 2 ? 'locked' : migrationState === 1 ? 'migrating' : 'pending',
    });

    return { virtualTonReserves, virtualTokenReserves, realTonReserves, realTokenReserves, currentSupply, migrationState, migrated, marketCapTon, priceTon };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('EOF') || message.includes('exit_code') || message.includes('Unable to execute get method')) {
      markInvalidCurve(bcAddress, message);
    } else {
      console.error(`getReserves error (${bcAddress.slice(0, 12)}...):`, message);
    }
    return null;
  }
}

function deriveBondingTradeSnapshot(
  before: TokenRow | null,
  type: 'buy' | 'sell',
  tonAmount: bigint,
  tokenAmount: bigint,
  feeTon: bigint = 0n,
): ReserveSnapshot {
  const beforeVirtualTon = parseNano(before?.virtual_ton_reserves) || INITIAL_VIRTUAL_TON;
  const beforeVirtualTokens = parseNano(before?.virtual_token_reserves) || INITIAL_VIRTUAL_TOKENS;
  const beforeRealTon = parseNano(before?.real_ton_reserves);
  const beforeRealTokens = parseNano(before?.real_token_reserves) || REAL_TOKEN_SUPPLY;
  const grossTon = tonAmount + feeTon;
  const migrationState = Number(before?.migration_state || 0);

  const virtualTonReserves = type === 'buy'
    ? beforeVirtualTon + tonAmount
    : beforeVirtualTon > grossTon
    ? beforeVirtualTon - grossTon
    : beforeVirtualTon;
  const virtualTokenReserves = type === 'buy'
    ? beforeVirtualTokens > tokenAmount
      ? beforeVirtualTokens - tokenAmount
      : beforeVirtualTokens
    : beforeVirtualTokens + tokenAmount;
  const realTonReserves = type === 'buy'
    ? beforeRealTon + tonAmount
    : beforeRealTon > grossTon
    ? beforeRealTon - grossTon
    : 0n;
  const realTokenReserves = type === 'buy'
    ? beforeRealTokens > tokenAmount
      ? beforeRealTokens - tokenAmount
      : beforeRealTokens
    : beforeRealTokens + tokenAmount;
  const currentSupply = REAL_TOKEN_SUPPLY > realTokenReserves ? REAL_TOKEN_SUPPLY - realTokenReserves : 0n;
  const marketCapTon = getMarketCap(virtualTonReserves, virtualTokenReserves);
  const priceTon = getPriceInNanotons(virtualTonReserves, virtualTokenReserves);

  return {
    virtualTonReserves,
    virtualTokenReserves,
    realTonReserves,
    realTokenReserves,
    currentSupply,
    migrationState,
    migrated: migrationState >= 2,
    marketCapTon,
    priceTon,
  };
}

async function updateTokenFromTradeSnapshot(bcAddress: string, snapshot: ReserveSnapshot) {
  await updateToken(bcAddress, {
    virtual_ton_reserves: snapshot.virtualTonReserves.toString(),
    virtual_token_reserves: snapshot.virtualTokenReserves.toString(),
    real_ton_reserves: snapshot.realTonReserves.toString(),
    real_token_reserves: snapshot.realTokenReserves.toString(),
    token_price_ton: snapshot.priceTon.toString(),
    token_price_usd: (Number(snapshot.priceTon) / 1e9 * TON_USD_PRICE).toString(),
    market_cap_ton: snapshot.marketCapTon.toString(),
    market_cap_usd: (Number(snapshot.marketCapTon) / 1e9 * TON_USD_PRICE).toString(),
    market_cap_usd_snapshot: TON_USD_PRICE.toString(),
  });
}

async function refreshTradeCount(tokenAddress: string) {
  const { count, error: countError } = await supabase
    .from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('token_address', tokenAddress);
  if (countError) return;
  await updateToken(tokenAddress, { tx_count: count || 0 });
}

async function handleTokenDeployed(body: Cell) {
  const slice = body.beginParse();
  if (slice.loadUint(32) !== OP_TOKEN_DEPLOYED) return;
  slice.loadUintBig(64);
  const bondingCurveAddr = slice.loadAddress();
  const jettonMasterAddr = slice.loadAddress();
  const creator = slice.loadAddress();
  const bcAddrStr = bondingCurveAddr.toString();
  const jmAddrStr = jettonMasterAddr.toString();
  const metadata = await fetchTokenMetadata(jettonMasterAddr);
  const initialMarketCap = getMarketCap(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
  const initialPrice = getPriceInNanotons(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);

  console.log(`New token deployed: ${bcAddrStr}`);
  invalidCurveAddresses.delete(bcAddrStr);
  const existing = await getTokenRow(bcAddrStr);
  if (existing) {
    bondingCurves.set(bcAddrStr, { address: bcAddrStr });
    return;
  }

  await upsertToken({
    address: bcAddrStr,
    jetton_address: jmAddrStr,
    master_address: jmAddrStr,
    creator_address: creator.toString(),
    name: 'Unknown',
    symbol: 'UNK',
    ...metadata,
    virtual_ton_reserves: INITIAL_VIRTUAL_TON.toString(),
    virtual_token_reserves: INITIAL_VIRTUAL_TOKENS.toString(),
    real_ton_reserves: '0',
    real_token_reserves: REAL_TOKEN_SUPPLY.toString(),
    token_price_ton: initialPrice.toString(),
    token_price_usd: (Number(initialPrice) / 1e9 * TON_USD_PRICE).toString(),
    market_cap_ton: initialMarketCap.toString(),
    market_cap_usd: (Number(initialMarketCap) / 1e9 * TON_USD_PRICE).toString(),
    market_cap_usd_snapshot: TON_USD_PRICE.toString(),
    migration_state: 0,
    is_migrated: false,
    migrated: false,
    lp_status: 'pending',
    tx_count: 0,
  }, 'token.created');

  bondingCurves.set(bcAddrStr, { address: bcAddrStr });
}

async function pollFactory() {
  try {
    const txs = await retry('getTransactions(factory)', () =>
      client.getTransactions(Address.parse(FACTORY_ADDRESS), { limit: 20, archival: false }),
    );

    for (const tx of txs) {
      const txHash = tx.hash().toString('hex');
      if (seenTxs.has(txHash)) continue;
      seenTxs.add(txHash);

      for (const outMsg of tx.outMessages.values()) {
        if (outMsg.body) {
          try {
            await handleTokenDeployed(outMsg.body);
          } catch {
            // Not TokenDeployed.
          }
        }
      }
    }
  } catch (error) {
    console.error('Factory poll error:', error instanceof Error ? error.message : error);
  }
}

async function pollBondingCurves() {
  const curveAddresses = Array.from(bondingCurves.keys()).filter((address) => !invalidCurveAddresses.has(address));
  const selected = selectBatch(curveAddresses, curveCursor, CURVES_PER_TICK);
  curveCursor = selected.nextCursor;

  for (const addr of selected.batch) {
    try {
      const txs = await retry('getTransactions(curve)', () =>
        client.getTransactions(Address.parse(addr), { limit: 40, archival: false }),
      );
      let shouldSyncReserves = false;

      for (const tx of [...txs].reverse()) {
        const txHash = tx.hash().toString('hex');
        const uniqueKey = `${addr}:${txHash}`;
        if (seenTxs.has(uniqueKey)) continue;
        seenTxs.add(uniqueKey);

        const inMsg = tx.inMessage;
        if (!inMsg?.body) continue;

        try {
          const slice = inMsg.body.beginParse();
          const op = slice.loadUint(32);
          const before = await getTokenRow(addr);

          if (op === OP_BUY_TOKENS) {
            const attachedTon = inMsg.info.type === 'internal' ? inMsg.info.value.coins : 0n;
            const tonAmount = inferBuyAmount(attachedTon);
            const userAddr = inMsg.info.type === 'internal' ? inMsg.info.src.toString() : 'unknown';
            const mintedAmount = Array.from(tx.outMessages.values()).reduce((sum, outMsg) => sum + parseMintedAmount(outMsg.body), 0n);
            if (mintedAmount <= 0n) continue;
            const reserves = deriveBondingTradeSnapshot(before, 'buy', tonAmount, mintedAmount);
            await updateTokenFromTradeSnapshot(addr, reserves);
            shouldSyncReserves = true;
            const at = txTime(tx);
            const trade = await upsertTrade({
              token_address: addr,
              trader_address: userAddr,
              user_address: userAddr,
              type: 'buy',
              source: 'bonding_curve',
              ton_amount: tonAmount.toString(),
              token_amount: mintedAmount.toString(),
              fee_ton: '0',
              fee_token_amount: '0',
              platform_revenue_token_amount: '0',
              token_price_ton: reserves.priceTon.toString(),
              token_price_usd: (Number(reserves.priceTon) / 1e9 * TON_USD_PRICE).toString(),
              market_cap_ton_after: reserves.marketCapTon.toString(),
              price_ton_after: reserves.priceTon.toString(),
              virtual_ton_after: reserves.virtualTonReserves.toString(),
              virtual_token_after: reserves.virtualTokenReserves.toString(),
              block_time: at,
              tx_lt: tx.lt.toString(),
              tx_hash: txHash,
            });
            if (trade) {
              await upsertCandles({ tokenAddress: addr, type: 'buy', tonAmount, marketCapTon: reserves.marketCapTon, priceTon: reserves.priceTon, at });
              await refreshTradeCount(addr);
            }
          } else if (op === OP_JETTON_NOTIFICATION) {
            slice.loadUintBig(64);
            const tokenAmount = slice.loadCoins();
            const seller = slice.loadAddress();
            const forwardPayload = parseForwardPayload(slice);
            if (!forwardPayload || forwardPayload.loadUint(32) !== OP_SELL_TOKENS) continue;

            const sellerStr = seller.toString();
            let tonAmount = 0n;
            let platformFeeTon = 0n;
            for (const outMsg of tx.outMessages.values()) {
              if (outMsg.info.type !== 'internal') continue;
              if (outMsg.info.dest.equals(seller)) tonAmount += outMsg.info.value.coins;
              if (PLATFORM_WALLET && outMsg.info.dest.equals(PLATFORM_WALLET)) platformFeeTon += outMsg.info.value.coins;
            }

            const reserves = deriveBondingTradeSnapshot(before, 'sell', tonAmount, tokenAmount, platformFeeTon);
            await updateTokenFromTradeSnapshot(addr, reserves);
            shouldSyncReserves = true;
            const at = txTime(tx);
            const trade = await upsertTrade({
              token_address: addr,
              trader_address: sellerStr,
              user_address: sellerStr,
              type: 'sell',
              source: 'bonding_curve',
              ton_amount: tonAmount.toString(),
              token_amount: tokenAmount.toString(),
              fee_ton: platformFeeTon.toString(),
              fee_token_amount: '0',
              platform_revenue_token_amount: '0',
              token_price_ton: reserves.priceTon.toString(),
              token_price_usd: (Number(reserves.priceTon) / 1e9 * TON_USD_PRICE).toString(),
              market_cap_ton_after: reserves.marketCapTon.toString(),
              price_ton_after: reserves.priceTon.toString(),
              virtual_ton_after: reserves.virtualTonReserves.toString(),
              virtual_token_after: reserves.virtualTokenReserves.toString(),
              block_time: at,
              tx_lt: tx.lt.toString(),
              tx_hash: txHash,
            });
            if (trade) {
              await upsertCandles({ tokenAddress: addr, type: 'sell', tonAmount, marketCapTon: reserves.marketCapTon, priceTon: reserves.priceTon, at });
              await refreshTradeCount(addr);
            }
          }
        } catch {
          // Not a supported curve message.
        }
      }

      if (shouldSyncReserves) await updateReserves(addr);
    } catch (error) {
      console.error(`BC poll error (${addr.slice(0, 12)}...):`, error instanceof Error ? error.message : error);
    }
  }
}

async function pollStonfiPoolTransactions(poolAddress: string, state: StonPoolState, data: StonPoolData): Promise<boolean> {
  const market = poolMarketData(state, data);
  let recorded = false;
  const txs = await retry('getTransactions(stonfi pool)', () =>
    client.getTransactions(Address.parse(poolAddress), { limit: 20, archival: false }),
  );

  for (const tx of txs.reverse()) {
    const txHash = tx.hash().toString('hex');
    const uniqueKey = `stonfi-pool:${poolAddress}:${txHash}`;
    if (seenTxs.has(uniqueKey)) continue;
    seenTxs.add(uniqueKey);

    const inMsg = tx.inMessage;
    if (!inMsg?.body) continue;

    const swap = parsePoolSwapBody(inMsg.body);
    if (!swap) continue;

    const payTo = findPayTo(tx);
    if (!payTo) continue;

    const tokenIn = state.tokenReserveIndex === 1 ? swap.amount1In : swap.amount0In;
    const tonIn = state.tokenReserveIndex === 1 ? swap.amount0In : swap.amount1In;
    const tokenOut = state.tokenReserveIndex === 1 ? payTo.amount1Out : payTo.amount0Out;
    const tonOut = state.tokenReserveIndex === 1 ? payTo.amount0Out : payTo.amount1Out;
    const at = txTime(tx);

    if (tonIn > 0n && tokenOut > 0n) {
      const trade = await recordExactStonfiSwap({
        tokenAddress: state.tokenAddress,
        poolAddress,
        txHash,
        txLt: tx.lt.toString(),
        at,
        type: 'buy',
        trader: swap.fromUser,
        tokenAmount: tokenOut,
        tonAmount: tonIn,
        marketCapTon: market.marketCapTon,
        priceTon: market.priceTon,
        feeTokenAmount: 0n,
      });
      recorded = recorded || Boolean(trade);
    } else if (tokenIn > 0n && tonOut > 0n) {
      const grossTokenAmount = grossFromSellTaxNet(tokenIn);
      const feeTokenAmount = grossTokenAmount > tokenIn ? grossTokenAmount - tokenIn : 0n;
      const trade = await recordExactStonfiSwap({
        tokenAddress: state.tokenAddress,
        poolAddress,
        txHash,
        txLt: tx.lt.toString(),
        at,
        type: 'sell',
        trader: swap.fromUser,
        tokenAmount: grossTokenAmount || tokenIn,
        tonAmount: tonOut,
        marketCapTon: market.marketCapTon,
        priceTon: market.priceTon,
        feeTokenAmount,
      });
      recorded = recorded || Boolean(trade);
    }
  }

  return recorded;
}

async function pollStonfiPools() {
  const poolEntries = Array.from(stonPools.entries());
  const selected = selectBatch(poolEntries, poolCursor, POOLS_PER_TICK);
  poolCursor = selected.nextCursor;

  for (const [poolAddress, state] of selected.batch) {
    try {
      const pool = new DEX.v2_1.Pool.CPI(poolAddress);
      const data = await pool.getPoolData(client as any);
      await ensureStonPoolState(poolAddress, state, data);
      const reserve0 = data.reserve0;
      const reserve1 = data.reserve1;
      if (reserve0 <= 0n || reserve1 <= 0n) continue;
      const exactTradeRecorded = await pollStonfiPoolTransactions(poolAddress, state, data);
      if (reserve0 === state.lastReserve0 && reserve1 === state.lastReserve1) continue;
      const previousReserve0 = state.lastReserve0;
      const previousReserve1 = state.lastReserve1;

      const { marketCapTon, priceTon } = poolMarketData(state, data);
      const previousTokenReserve = state.tokenReserveIndex === 1 ? previousReserve1 : previousReserve0;
      const previousTonReserve = state.tokenReserveIndex === 1 ? previousReserve0 : previousReserve1;
      const currentTokenReserve = state.tokenReserveIndex === 1 ? reserve1 : reserve0;
      const currentTonReserve = state.tokenReserveIndex === 1 ? reserve0 : reserve1;
      const tokenDelta = previousTokenReserve === 0n ? 0n : (currentTokenReserve > previousTokenReserve ? currentTokenReserve - previousTokenReserve : previousTokenReserve - currentTokenReserve);
      const tonDelta = previousTonReserve === 0n ? 0n : (currentTonReserve > previousTonReserve ? currentTonReserve - previousTonReserve : previousTonReserve - currentTonReserve);
      const tradeType = previousTokenReserve !== 0n && currentTokenReserve > previousTokenReserve ? 'sell' : 'buy';
      state.lastReserve0 = reserve0;
      state.lastReserve1 = reserve1;

      await updateToken(state.tokenAddress, {
        ston_pool_address: poolAddress,
        token_price_ton: priceTon.toString(),
        token_price_usd: (Number(priceTon) / 1e9 * TON_USD_PRICE).toString(),
        market_cap_ton: marketCapTon.toString(),
        market_cap_usd: (Number(marketCapTon) / 1e9 * TON_USD_PRICE).toString(),
        migration_state: 2,
        is_migrated: true,
        migrated: true,
        lp_status: 'locked',
      });

      if (!exactTradeRecorded && previousReserve0 !== 0n && previousReserve1 !== 0n && tokenDelta > 0n && tonDelta > 0n) {
        const at = new Date().toISOString();
        const sequence = `${Date.now()}:${reserve0}:${reserve1}`;
        await recordStonfiPoolMove({
          poolAddress,
          tokenAddress: state.tokenAddress,
          type: tradeType,
          tokenAmount: tokenDelta,
          tonAmount: tonDelta,
          marketCapTon,
          priceTon,
          at,
          sequence,
        });
        await upsertCandles({
          tokenAddress: state.tokenAddress,
          type: tradeType,
          tonAmount: tonDelta,
          marketCapTon,
          priceTon,
          at,
        });
      }
    } catch (error) {
      console.error(`STON.fi pool poll error (${poolAddress.slice(0, 12)}...):`, error instanceof Error ? error.message : error);
    }
  }
}

async function bootstrap() {
  console.log('Loading existing tokens from database...');
  const { data, error } = await supabase
    .from('tokens')
    .select('address, jetton_address, master_address, migrated, is_migrated, migration_state, ston_pool_address, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('Bootstrap error:', error.message);
    return;
  }

  for (const token of (data || []) as Array<TokenRow & { migrated?: boolean; is_migrated?: boolean }>) {
    if (!token.address) continue;
    if (Number(token.migration_state || 0) < 2 && !token.migrated && !token.is_migrated) {
      const reserves = await updateReserves(token.address);
      if (reserves) bondingCurves.set(token.address, { address: token.address });
      await sleep(250);
    }
    const pool = token.ston_pool_address;
    const jetton = token.jetton_address || token.master_address || '';
    if (pool && jetton) {
      stonPools.set(pool, { tokenAddress: token.address, jettonAddress: jetton, lastReserve0: 0n, lastReserve1: 0n, tokenReserveIndex: null });
    }
  }
  console.log(`Watching ${bondingCurves.size} active curves and ${stonPools.size} STON.fi pools`);
}

async function main() {
  acquireIndexerLock();
  console.log('Tonked indexer');
  console.log(`Factory: ${FACTORY_ADDRESS}`);
  console.log(`Factory polling: ${FACTORY_POLL_INTERVAL_MS}ms`);
  console.log(`Curve polling: ${CURVE_POLL_INTERVAL_MS}ms, ${CURVES_PER_TICK} curve(s) per tick`);
  console.log(`Pool polling: ${POOL_POLL_INTERVAL_MS}ms, ${POOLS_PER_TICK} pool(s) per tick`);
  console.log(`Live webhook: ${LIVE_EVENTS_WEBHOOK_URL || 'disabled'}`);

  await bootstrap();
  startTonapiWebhookReceiver();
  startPoller('factory', FACTORY_POLL_INTERVAL_MS, pollFactory);
  startPoller('curves', CURVE_POLL_INTERVAL_MS, pollBondingCurves);
  startPoller('stonfi-pools', POOL_POLL_INTERVAL_MS, pollStonfiPools);
}

main().catch(console.error);
