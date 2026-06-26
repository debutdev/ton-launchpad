import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Address, beginCell, Cell, SendMode, Slice, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { Asset, Factory, Pool, PoolType } from '@dedust/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { jettonTransferBody } from '../wrappers/acton/LaunchpadActon';
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
import { CURRENT_ACTON_TESTNET_FACTORY_ADDRESS, CURRENT_FACTORY_ADDRESS } from './deployment_config';
import {
  dedustAssetIsJetton,
  dedustAssetIsNative,
  OP_DEDUST_JETTON_SWAP,
  OP_DEDUST_POOL_SWAP,
  OP_JETTON_NOTIFICATION,
  parseDedustJettonVaultSender,
  parseDedustNativeSwapPool,
  parseDedustPoolSwapBody,
  parseDedustSwapEvent,
  parseForwardPayload,
  readBodyOp,
} from './dedust_attribution';

dotenv.config();

const IS_TESTNET = process.env.TON_NETWORK === 'testnet';

function requireNetworkAddress(value: string, name: string): string {
  if (!value) return value;
  try {
    const parsed = Address.parseFriendly(value);
    if (!IS_TESTNET && parsed.isTestOnly) {
      throw new Error(`${name} is a testnet-only address; set a mainnet address for mainnet indexer runs`);
    }
  } catch (error: any) {
    if (String(error?.message || '').includes('testnet-only address')) throw error;
    Address.parse(value);
  }
  return value;
}

const FACTORY_ADDRESS =
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  process.env.ACTON_FACTORY_ADDRESS ||
  CURRENT_FACTORY_ADDRESS ||
  (IS_TESTNET ? process.env.ACTON_TESTNET_FACTORY_ADDRESS || CURRENT_ACTON_TESTNET_FACTORY_ADDRESS : '');
if (!FACTORY_ADDRESS) {
  throw new Error('Set NEXT_PUBLIC_FACTORY_ADDRESS to the active launchpad factory for this network');
}
requireNetworkAddress(FACTORY_ADDRESS, 'NEXT_PUBLIC_FACTORY_ADDRESS');
const PLATFORM_WALLET_ADDRESS =
  process.env.PLATFORM_WALLET ||
  process.env.NEXT_PUBLIC_PLATFORM_WALLET ||
  (IS_TESTNET ? process.env.TESTNET_PLATFORM_WALLET : '') ||
  '';
if (PLATFORM_WALLET_ADDRESS) requireNetworkAddress(PLATFORM_WALLET_ADDRESS, 'PLATFORM_WALLET');
const PLATFORM_WALLET = PLATFORM_WALLET_ADDRESS ? Address.parse(PLATFORM_WALLET_ADDRESS) : null;
const DEFAULT_DEDUST_FACTORY_ADDRESS = 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67';
const DEDUST_FACTORY_ADDRESS =
  process.env.DEDUST_FACTORY_ADDRESS ||
  process.env.NEXT_PUBLIC_DEDUST_FACTORY_ADDRESS ||
  DEFAULT_DEDUST_FACTORY_ADDRESS;
const DEDUST_FACTORY = DEDUST_FACTORY_ADDRESS ? Address.parse(DEDUST_FACTORY_ADDRESS) : null;
const LIVE_EVENTS_WEBHOOK_URL = process.env.LIVE_EVENTS_WEBHOOK_URL || '';
const LIVE_EVENTS_SECRET = process.env.LIVE_EVENTS_SECRET || '';
const FACTORY_POLL_INTERVAL_MS = Number(process.env.INDEXER_FACTORY_POLL_INTERVAL_MS || 12000);
const CURVE_POLL_INTERVAL_MS = Number(process.env.INDEXER_CURVE_POLL_INTERVAL_MS || 5000);
const POOL_POLL_INTERVAL_MS = Number(process.env.INDEXER_POOL_POLL_INTERVAL_MS || 6000);
const CURVES_PER_TICK = Math.max(1, Number(process.env.INDEXER_CURVES_PER_TICK || 2));
const POOLS_PER_TICK = Math.max(1, Number(process.env.INDEXER_POOLS_PER_TICK || 2));
const BOOTSTRAP_TOKEN_LIMIT = Math.max(50, Number(process.env.INDEXER_BOOTSTRAP_TOKEN_LIMIT || 500));
const RPC_RETRY_ATTEMPTS = Math.max(1, Number(process.env.INDEXER_RPC_RETRY_ATTEMPTS || 3));
const RPC_RETRY_BASE_MS = Math.max(1000, Number(process.env.INDEXER_RPC_RETRY_BASE_MS || 4000));
const RPC_TIMEOUT_MS = Math.max(5000, Number(process.env.INDEXER_RPC_TIMEOUT_MS || 20000));
const INDEXER_LOCK_PATH = process.env.INDEXER_LOCK_PATH || path.join(process.cwd(), 'logs', 'indexer.lock');
const TONAPI_WEBHOOK_PORT = Number(process.env.PORT || process.env.TONAPI_WEBHOOK_PORT || 8790);
const TONAPI_WEBHOOK_SECRET = process.env.TONAPI_WEBHOOK_SECRET || '';
const TONAPI_WEBHOOK_ENABLED = process.env.TONAPI_WEBHOOK_ENABLED !== 'false';
const INDEXER_RUN_ONCE = process.env.INDEXER_RUN_ONCE === 'true';
const AUTO_SWEEP_FEES_ENABLED = process.env.AUTO_SWEEP_FEES_ENABLED === 'true';
const AUTO_SWEEP_MIN_FEE_TOKENS = parseTokenUnits(process.env.AUTO_SWEEP_MIN_FEE_TOKENS || '1000');
const AUTO_SWEEP_TX_VALUE = toNano(process.env.AUTO_SWEEP_TX_VALUE_TON || '0.4');
const AUTO_SWEEP_FORWARD_TON = toNano(process.env.AUTO_SWEEP_FORWARD_TON || '0.25');
const AUTO_SWEEP_MAX_SPEND = toNano(process.env.AUTO_SWEEP_MAX_SPEND_TON || '0.5');
const AUTO_SWEEP_MIN_PLATFORM_TON = toNano(process.env.AUTO_SWEEP_MIN_PLATFORM_TON || '0.5');
const AUTO_SWEEP_MIN_TON_OUT = BigInt(process.env.AUTO_SWEEP_MIN_TON_OUT_NANO || '0');
const AUTO_SWEEP_COOLDOWN_MS = Math.max(30_000, Number(process.env.AUTO_SWEEP_COOLDOWN_MS || 120_000));
const AUTO_SWEEP_BALANCE_RETRY_MS = Math.max(
  AUTO_SWEEP_COOLDOWN_MS,
  Number(process.env.AUTO_SWEEP_BALANCE_RETRY_MS || 3_600_000),
);
const AUTO_SWEEP_SCAN_INTERVAL_MS = Math.max(60_000, Number(process.env.AUTO_SWEEP_SCAN_INTERVAL_MS || 180_000));
const AUTO_SWEEP_WALLET_GLOBAL_ID = Number(process.env.AUTO_SWEEP_WALLET_GLOBAL_ID || (IS_TESTNET ? '-3' : '-239'));
const PLATFORM_WALLET_MNEMONIC =
  process.env.PLATFORM_WALLET_MNEMONIC || (IS_TESTNET ? process.env.TESTNET_PLATFORM_WALLET_MNEMONIC : '') || '';
const TON_USD_PRICE = Number(TON_USD_PRICE_NUM) / Number(TON_USD_PRICE_DEN);

const OP_TOKEN_DEPLOYED = 0x20002;
const OP_BUY_TOKENS = 0x10001;
const OP_SELL_TOKENS = 0x10002;
const OP_MINT = 0x642b7d07;
const OP_JETTON_TRANSFER_INTERNAL = 0x178d4519;
const BUY_GAS_RESERVE = 100000000n;
const MIGRATION_GAS_RESERVE = 1200000000n;
const SELL_TAX_NUMERATOR = 2n;
const SELL_TAX_DENOMINATOR = 100n;
const DEDUST_EVENT_PARSER_VERSION = 3;

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

type DexPoolState = {
  tokenAddress: string;
  jettonAddress: string;
  lastReserve0: bigint;
  lastReserve1: bigint;
  lastPoolLt?: bigint;
  tokenReserveIndex: 0 | 1 | null;
  nativeVaultAddress?: string;
  jettonVaultAddress?: string;
};

type DexPoolData = {
  reserve0: bigint;
  reserve1: bigint;
  assets: [Asset, Asset];
};

type TonapiWebhookBody = {
  account_id?: string;
  lt?: number | string;
  tx_hash?: string;
};

type DedustSwapAttribution = {
  traderAddress: string;
  txHash: string;
  txLt: string;
  blockTime: string;
  amountIn: bigint;
};

type IndexerStateValue = Record<string, string | number | boolean | null>;

const client = new TonClient({
  endpoint: process.env.TONCENTER_ENDPOINT || (IS_TESTNET ? 'https://testnet.toncenter.com/api/v2/jsonRPC' : 'https://toncenter.com/api/v2/jsonRPC'),
  apiKey: process.env.TONCENTER_API_KEY || undefined,
});

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const seenTxs = new Set<string>();
const bondingCurves = new Map<string, { address: string }>();
const dexPools = new Map<string, DexPoolState>();
const pollRunning = new Map<string, boolean>();
const lastRetryLog = new Map<string, number>();
const invalidCurveAddresses = new Set<string>();
const invalidPoolAddresses = new Set<string>();
const autoSweepCooldown = new Map<string, number>();
const autoSweepLastAttempt = new Map<string, { amount: bigint; at: number }>();
const autoSweepInFlight = new Set<string>();
const inMemoryIndexerState = new Map<string, IndexerStateValue>();
let autoSweepWallet: Promise<{ wallet: any; secretKey: Buffer | Uint8Array; address: Address } | null> | null = null;
let autoSweepQueue = Promise.resolve();
let autoSweepMissingConfigLogged = false;
let indexerStateUnavailableLogged = false;
let curveCursor = 0;
let poolCursor = 0;
let sweepCursor = 0;

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

function parseTokenUnits(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed) * 1000000000n;
  const [whole, fraction = ''] = trimmed.split('.');
  const normalizedFraction = `${fraction.slice(0, 9)}000000000`.slice(0, 9);
  return BigInt(whole || '0') * 1000000000n + BigInt(normalizedFraction);
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

function txTime(tx: { now?: number }): string {
  return new Date(Number(tx.now || Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

function parseMintedAmount(body: Cell | null | undefined, expectedReceiver?: Address): bigint {
  if (!body) return 0n;
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_MINT) return 0n;
    slice.loadUintBig(64);
    const receiver = slice.loadAddress();
    if (expectedReceiver && !receiver.equals(expectedReceiver)) return 0n;
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
    maybe.response?.status === 500 ||
    maybe.code === 'ECONNRESET' ||
    maybe.code === 'ETIMEDOUT' ||
    maybe.code === 'ECONNABORTED' ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('EOF') ||
    message.includes('ECONNRESET') ||
    message.includes('socket hang up') ||
    message.toLowerCase().includes('timeout'),
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
      return await withTimeout(label, fn());
    } catch (error) {
      if (!isRetriableRpcError(error) || attempt === RPC_RETRY_ATTEMPTS) throw error;
      const delay = RPC_RETRY_BASE_MS * attempt;
      logRetriable(label, attempt, delay, error);
      await sleep(delay);
    }
  }

  throw new Error(`RPC retry exhausted: ${label}`);
}

function withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`RPC timeout after ${Math.round(RPC_TIMEOUT_MS / 1000)}s on ${label}`);
      (error as Error & { code?: string }).code = 'ETIMEDOUT';
      reject(error);
    }, RPC_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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

function txLtValue(tx: { lt: string | number | bigint }): bigint {
  return BigInt(tx.lt.toString());
}

function txHashHex(tx: { hash(): Buffer }): string {
  return tx.hash().toString('hex');
}

function indexerStateKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

async function loadIndexerState(key: string): Promise<IndexerStateValue> {
  const memoryValue = inMemoryIndexerState.get(key);
  if (memoryValue) return memoryValue;

  const { data, error } = await supabase
    .from('indexer_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    if (!indexerStateUnavailableLogged) {
      console.warn(`Indexer state table unavailable; using process memory only (${error.message})`);
      indexerStateUnavailableLogged = true;
    }
    return {};
  }

  const value = (data?.value && typeof data.value === 'object' ? data.value : {}) as IndexerStateValue;
  inMemoryIndexerState.set(key, value);
  return value;
}

async function saveIndexerState(key: string, value: IndexerStateValue): Promise<void> {
  inMemoryIndexerState.set(key, value);
  const { error } = await supabase
    .from('indexer_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error && !indexerStateUnavailableLogged) {
    console.warn(`Indexer state table unavailable; using process memory only (${error.message})`);
    indexerStateUnavailableLogged = true;
  }
}

async function savePoolIndexerState(poolAddress: string, state: DexPoolState): Promise<void> {
  await saveIndexerState(indexerStateKey('dedust_pool', poolAddress), {
    lastReserve0: state.lastReserve0.toString(),
    lastReserve1: state.lastReserve1.toString(),
    lastPoolLt: state.lastPoolLt?.toString() || null,
    parserVersion: DEDUST_EVENT_PARSER_VERSION,
    tokenReserveIndex: state.tokenReserveIndex,
    nativeVaultAddress: state.nativeVaultAddress || null,
    jettonVaultAddress: state.jettonVaultAddress || null,
  });
}

async function hydratePoolIndexerState(poolAddress: string, state: DexPoolState): Promise<void> {
  const persisted = await loadIndexerState(indexerStateKey('dedust_pool', poolAddress));
  const parserVersionMatches = Number(persisted.parserVersion || 0) === DEDUST_EVENT_PARSER_VERSION;
  state.lastReserve0 = parseNano(persisted.lastReserve0) || state.lastReserve0;
  state.lastReserve1 = parseNano(persisted.lastReserve1) || state.lastReserve1;
  state.lastPoolLt = parserVersionMatches ? parseNano(persisted.lastPoolLt) || state.lastPoolLt : undefined;
  state.tokenReserveIndex = persisted.tokenReserveIndex === 0 || persisted.tokenReserveIndex === 1
    ? persisted.tokenReserveIndex
    : state.tokenReserveIndex;
  state.nativeVaultAddress = typeof persisted.nativeVaultAddress === 'string' && persisted.nativeVaultAddress
    ? persisted.nativeVaultAddress
    : state.nativeVaultAddress;
  state.jettonVaultAddress = typeof persisted.jettonVaultAddress === 'string' && persisted.jettonVaultAddress
    ? persisted.jettonVaultAddress
    : state.jettonVaultAddress;
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

async function getAutoSweepWallet(): Promise<{ wallet: any; secretKey: Buffer | Uint8Array; address: Address } | null> {
  if (!AUTO_SWEEP_FEES_ENABLED || !PLATFORM_WALLET_MNEMONIC) return null;

  if (!autoSweepWallet) {
    autoSweepWallet = (async () => {
      const key = await mnemonicToWalletKey(PLATFORM_WALLET_MNEMONIC.trim().split(/\s+/));
      const wallet = WalletContractV5R1.create({
        publicKey: key.publicKey,
        walletId: { networkGlobalId: AUTO_SWEEP_WALLET_GLOBAL_ID },
      });
      if (PLATFORM_WALLET && !wallet.address.equals(PLATFORM_WALLET)) {
        console.error('Auto sweep disabled: platform mnemonic does not match PLATFORM_WALLET/NEXT_PUBLIC_PLATFORM_WALLET');
        return null;
      }
      return { wallet: client.open(wallet), secretKey: key.secretKey, address: wallet.address };
    })();
  }

  return autoSweepWallet;
}

async function waitSeqno(wallet: { getSeqno(): Promise<number> }, seqno: number): Promise<void> {
  while ((await retry('getSeqno(auto-sweep)', () => wallet.getSeqno())) === seqno) {
    await sleep(3000);
  }
}

async function sendAutoSweepMessage(args: {
  wallet: any;
  secretKey: Buffer | Uint8Array;
  to: Address;
  value: bigint;
  body: Cell;
}): Promise<void> {
  const seqno = Number(await retry('getSeqno(auto-sweep)', () => args.wallet.getSeqno()));
  await retry('sendTransfer(auto-sweep)', () =>
    args.wallet.sendTransfer({
      seqno,
      secretKey: args.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      messages: [
        internal({
          to: args.to,
          value: args.value,
          bounce: true,
          body: args.body,
        }),
      ],
    }),
  );
  await waitSeqno(args.wallet, seqno);
}

async function getJettonWalletAddress(jettonMaster: Address, owner: Address): Promise<Address> {
  const result = await retry('get_wallet_address(auto-sweep)', () =>
    client.runMethod(jettonMaster, 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
    ]),
  );
  return result.stack.readAddress();
}

async function getJettonWalletBalance(wallet: Address): Promise<bigint> {
  const state = await retry('getContractState(auto-sweep jetton wallet)', () => client.getContractState(wallet));
  if (state.state !== 'active') return 0n;
  const result = await retry('get_wallet_data(auto-sweep)', () => client.runMethod(wallet, 'get_wallet_data'));
  return result.stack.readBigNumber();
}

function dedustJettonSwapPayload(args: { pool: Address; minOut: bigint; recipient: Address }): Cell {
  return beginCell()
    .storeUint(OP_DEDUST_JETTON_SWAP, 32)
    .storeAddress(args.pool)
    .storeUint(0, 1)
    .storeCoins(args.minOut)
    .storeMaybeRef(null)
    .storeRef(
      beginCell()
        .storeUint(0, 32)
        .storeAddress(args.recipient)
        .storeMaybeRef(null)
        .storeMaybeRef(null)
        .endCell(),
    )
    .endCell();
}

function scheduleFeeAutoSweep(args: {
  tokenAddress: string;
  jettonAddress: string;
  poolAddress: string;
  reason: string;
}) {
  if (!AUTO_SWEEP_FEES_ENABLED) return;
  if (!PLATFORM_WALLET_MNEMONIC) {
    if (!autoSweepMissingConfigLogged) {
      console.warn('Auto sweep enabled but platform wallet mnemonic is not configured; skipping fee sweep.');
      autoSweepMissingConfigLogged = true;
    }
    return;
  }

  autoSweepQueue = autoSweepQueue
    .then(() => sweepFeeTokensToTon(args))
    .catch((error) => {
      console.error('Auto fee sweep error:', error instanceof Error ? error.message : error);
    });
}

async function sweepFeeTokensToTon(args: {
  tokenAddress: string;
  jettonAddress: string;
  poolAddress: string;
  reason: string;
}) {
  const now = Date.now();
  const lastSweep = autoSweepCooldown.get(args.jettonAddress) || 0;
  if (now - lastSweep < AUTO_SWEEP_COOLDOWN_MS || autoSweepInFlight.has(args.jettonAddress)) return;
  autoSweepInFlight.add(args.jettonAddress);

  try {
    if (AUTO_SWEEP_TX_VALUE > AUTO_SWEEP_MAX_SPEND) {
      console.error('Auto sweep disabled: AUTO_SWEEP_TX_VALUE_TON exceeds AUTO_SWEEP_MAX_SPEND_TON');
      return;
    }

    const sweepWallet = await getAutoSweepWallet();
    if (!sweepWallet || !DEDUST_FACTORY) return;

    const jettonMaster = Address.parse(args.jettonAddress);
    const platformJettonWallet = await getJettonWalletAddress(jettonMaster, sweepWallet.address);
    const feeBalance = await getJettonWalletBalance(platformJettonWallet);
    if (feeBalance < AUTO_SWEEP_MIN_FEE_TOKENS) return;

    const lastAttempt = autoSweepLastAttempt.get(args.jettonAddress);
    if (
      lastAttempt &&
      lastAttempt.amount === feeBalance &&
      now - lastAttempt.at < AUTO_SWEEP_BALANCE_RETRY_MS
    ) {
      return;
    }
    autoSweepLastAttempt.set(args.jettonAddress, { amount: feeBalance, at: now });
    autoSweepCooldown.set(args.jettonAddress, now);

    const tonBalance = await retry('getBalance(auto-sweep platform)', () => client.getBalance(sweepWallet.address));
    if (tonBalance <= AUTO_SWEEP_TX_VALUE + AUTO_SWEEP_MIN_PLATFORM_TON) {
      console.warn('Auto sweep skipped: platform wallet TON balance is below configured reserve.');
      return;
    }

    const factory = client.open(Factory.createFromAddress(DEDUST_FACTORY));
    const assets: [Asset, Asset] = [Asset.native(), Asset.jetton(jettonMaster)];
    const [jettonVault, expectedPool] = await Promise.all([
      retry('get DeDust jetton vault(auto-sweep)', () =>
        factory.getVaultAddress(Asset.jetton(jettonMaster)),
      ),
      retry('get DeDust pool(auto-sweep)', () =>
        factory.getPoolAddress({ poolType: PoolType.VOLATILE, assets }),
      ),
    ]);
    const pool = Address.parse(args.poolAddress);
    if (!pool.equals(expectedPool)) {
      console.warn(`Auto sweep skipped: stored pool does not match DeDust pool for ${args.tokenAddress.slice(0, 12)}...`);
      return;
    }

    await sendAutoSweepMessage({
      wallet: sweepWallet.wallet,
      secretKey: sweepWallet.secretKey,
      to: platformJettonWallet,
      value: AUTO_SWEEP_TX_VALUE,
      body: jettonTransferBody({
        queryId: BigInt(Date.now()),
        amount: feeBalance,
        destination: jettonVault,
        responseDestination: sweepWallet.address,
        forwardTonAmount: AUTO_SWEEP_FORWARD_TON,
        forwardPayload: dedustJettonSwapPayload({
          pool,
          minOut: AUTO_SWEEP_MIN_TON_OUT,
          recipient: sweepWallet.address,
        }),
        forwardPayloadByRef: true,
      }),
    });

    console.log(`Auto-swept ${Number(feeBalance) / 1e9} fee tokens to TON for ${args.tokenAddress.slice(0, 12)}... (${args.reason})`);
  } finally {
    autoSweepInFlight.delete(args.jettonAddress);
  }
}

function markInvalidCurve(address: string, reason: string) {
  if (invalidCurveAddresses.has(address)) return;
  invalidCurveAddresses.add(address);
  bondingCurves.delete(address);
  console.warn(`Skipping non-readable curve ${address.slice(0, 12)}...: ${reason}`);
}

function markInvalidPool(address: string, reason: string) {
  if (invalidPoolAddresses.has(address)) return;
  invalidPoolAddresses.add(address);
  dexPools.delete(address);
  console.warn(`Skipping non-readable DeDust pool ${address.slice(0, 12)}...: ${reason}`);
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

  const pools = Array.from(dexPools.keys());
  const poolIndex = findAddressIndex(pools, account);
  if (poolIndex >= 0) {
    poolCursor = poolIndex;
    await pollDedustPools();
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

async function ensureDexPoolState(poolAddress: string, state: DexPoolState, data: DexPoolData) {
  if (state.tokenReserveIndex !== null) return;

  const tokenAsset = Asset.jetton(Address.parse(state.jettonAddress));
  if (data.assets[0].equals(tokenAsset)) {
    state.tokenReserveIndex = 0;
    return;
  }
  if (data.assets[1].equals(tokenAsset)) {
    state.tokenReserveIndex = 1;
    return;
  }

  state.tokenReserveIndex = 0;
  console.warn(`Could not match custom token asset for DeDust pool ${poolAddress}; falling back to reserve0 as custom token`);
}

function poolMarketData(state: DexPoolState, data: DexPoolData) {
  const tokenReserve = state.tokenReserveIndex === 1 ? data.reserve1 : data.reserve0;
  const tonReserve = state.tokenReserveIndex === 1 ? data.reserve0 : data.reserve1;
  const marketCapTon = tokenReserve > 0n ? (tonReserve * TOTAL_SUPPLY) / tokenReserve : 0n;
  const priceTon = tokenReserve > 0n ? (tonReserve * 1000000000n * 1000000000n) / tokenReserve : 0n;
  return { tokenReserve, tonReserve, marketCapTon, priceTon };
}

async function ensureDedustVaultState(state: DexPoolState): Promise<{ nativeVault: Address; jettonVault: Address } | null> {
  if (!DEDUST_FACTORY) return null;
  if (state.nativeVaultAddress && state.jettonVaultAddress) {
    return {
      nativeVault: Address.parse(state.nativeVaultAddress),
      jettonVault: Address.parse(state.jettonVaultAddress),
    };
  }

  const factory = client.open(Factory.createFromAddress(DEDUST_FACTORY));
  const jetton = Address.parse(state.jettonAddress);
  const [nativeVault, jettonVault] = await Promise.all([
    retry('get DeDust native vault(attribution)', () => factory.getVaultAddress(Asset.native())),
    retry('get DeDust jetton vault(attribution)', () => factory.getVaultAddress(Asset.jetton(jetton))),
  ]);
  state.nativeVaultAddress = nativeVault.toString();
  state.jettonVaultAddress = jettonVault.toString();
  return { nativeVault, jettonVault };
}

async function resolveDedustVaultSender(args: {
  poolAddress: Address;
  vaultAddress: Address;
  tradeType: 'buy' | 'sell';
  poolTxTime: number;
}): Promise<Address | null> {
  const txs = await retry('getTransactions(dedust vault attribution)', () =>
    client.getTransactions(args.vaultAddress, { limit: 20, archival: false }),
  );

  for (const tx of txs) {
    if (Math.abs(Number(tx.now || 0) - args.poolTxTime) > 300) continue;
    const outToPool = Array.from(tx.outMessages.values()).some((message) => (
      message.info.type === 'internal' &&
      message.info.dest.equals(args.poolAddress) &&
      readBodyOp(message.body) === OP_DEDUST_POOL_SWAP
    ));
    if (!outToPool) continue;

    const inMsg = tx.inMessage;
    if (!inMsg?.body || inMsg.info.type !== 'internal') continue;

    if (args.tradeType === 'buy') {
      const pool = parseDedustNativeSwapPool(inMsg.body);
      if (pool?.equals(args.poolAddress)) return inMsg.info.src;
    } else {
      const sender = parseDedustJettonVaultSender(inMsg.body, args.poolAddress);
      if (sender) return sender;
    }
  }

  return null;
}

async function resolveDedustSwapAttribution(args: {
  poolAddress: string;
  state: DexPoolState;
  tradeType: 'buy' | 'sell';
}): Promise<DedustSwapAttribution | null> {
  const vaults = await ensureDedustVaultState(args.state);
  if (!vaults) return null;

  const poolAddress = Address.parse(args.poolAddress);
  const expectedVault = args.tradeType === 'buy' ? vaults.nativeVault : vaults.jettonVault;
  const txs = await retry('getTransactions(dedust pool attribution)', () =>
    client.getTransactions(poolAddress, { limit: 20, archival: false }),
  );

  for (const tx of txs) {
    const txLt = BigInt(tx.lt.toString());
    if (args.state.lastPoolLt && txLt <= args.state.lastPoolLt) continue;
    const inMsg = tx.inMessage;
    if (!inMsg?.body || inMsg.info.type !== 'internal') continue;
    if (!inMsg.info.src.equals(expectedVault)) continue;

    const parsed = parseDedustPoolSwapBody(inMsg.body);
    if (!parsed) continue;

    const vaultSender = await resolveDedustVaultSender({
      poolAddress,
      vaultAddress: expectedVault,
      tradeType: args.tradeType,
      poolTxTime: Number(tx.now || 0),
    });
    const trader = vaultSender || parsed.sender;
    args.state.lastPoolLt = txLt;

    return {
      traderAddress: trader.toString(),
      txHash: `dedust:${args.poolAddress}:${tx.hash().toString('hex')}`,
      txLt: tx.lt.toString(),
      blockTime: txTime(tx),
      amountIn: parsed.amountIn,
    };
  }

  return null;
}

async function recordDexPoolMove(args: {
  poolAddress: string;
  tokenAddress: string;
  type: 'buy' | 'sell';
  tokenAmount: bigint;
  tonAmount: bigint;
  marketCapTon: bigint;
  priceTon: bigint;
  at: string;
  sequence: string;
  traderAddress?: string;
  txHash?: string;
  txLt?: string;
}) {
  const txHash = args.txHash || `dedust:${args.poolAddress}:${args.sequence}`;
  const traderAddress = args.traderAddress || args.poolAddress;
  const feeTokenAmount = args.type === 'sell' ? grossFromSellTaxNet(args.tokenAmount) - args.tokenAmount : 0n;
  const trade = await upsertTrade({
    token_address: args.tokenAddress,
    trader_address: traderAddress,
    user_address: traderAddress,
    type: args.type,
    source: 'dedust',
    ton_amount: args.tonAmount.toString(),
    token_amount: args.tokenAmount.toString(),
    fee_ton: '0',
    fee_token_amount: feeTokenAmount.toString(),
    platform_revenue_token_amount: feeTokenAmount.toString(),
    token_price_ton: args.priceTon.toString(),
    token_price_usd: (Number(args.priceTon) / 1e9 * TON_USD_PRICE).toString(),
    virtual_ton_after: '0',
    virtual_token_after: '0',
    market_cap_ton_after: args.marketCapTon.toString(),
    price_ton_after: args.priceTon.toString(),
    block_time: args.at,
    tx_lt: args.txLt || '0',
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

async function registerDedustPool(args: {
  poolAddress: string;
  tokenAddress: string;
  jettonAddress: string;
  nativeVaultAddress?: string;
  jettonVaultAddress?: string;
}): Promise<DexPoolState> {
  const existing = dexPools.get(args.poolAddress);
  const state: DexPoolState = {
    tokenAddress: args.tokenAddress,
    jettonAddress: args.jettonAddress,
    lastReserve0: existing?.lastReserve0 || 0n,
    lastReserve1: existing?.lastReserve1 || 0n,
    lastPoolLt: existing?.lastPoolLt,
    tokenReserveIndex: existing?.tokenReserveIndex ?? null,
    nativeVaultAddress: args.nativeVaultAddress || existing?.nativeVaultAddress,
    jettonVaultAddress: args.jettonVaultAddress || existing?.jettonVaultAddress,
  };
  await hydratePoolIndexerState(args.poolAddress, state);
  dexPools.set(args.poolAddress, state);
  return state;
}

async function deriveDedustPool(tokenAddress: string, jettonAddress: string): Promise<string | null> {
  if (!DEDUST_FACTORY) return null;
  try {
    const factory = client.open(Factory.createFromAddress(DEDUST_FACTORY));
    const jetton = Address.parse(jettonAddress);
    const assets: [Asset, Asset] = [Asset.native(), Asset.jetton(jetton)];
    const [poolAddress, nativeVault, jettonVault] = await Promise.all([
      factory.getPoolAddress({ poolType: PoolType.VOLATILE, assets }),
      factory.getVaultAddress(Asset.native()),
      factory.getVaultAddress(Asset.jetton(jetton)),
    ]);
    const pool = poolAddress.toString();
    await registerDedustPool({
      poolAddress: pool,
      tokenAddress,
      jettonAddress,
      nativeVaultAddress: nativeVault.toString(),
      jettonVaultAddress: jettonVault.toString(),
    });
    return pool;
  } catch (error) {
    console.error('DeDust pool derive error:', error instanceof Error ? error.message : error);
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
      ? await deriveDedustPool(bcAddress, jettonAddress)
      : row?.ston_pool_address || null;
    if (migrated && stonPoolAddress && jettonAddress && !dexPools.has(stonPoolAddress)) {
      await registerDedustPool({ poolAddress: stonPoolAddress, tokenAddress: bcAddress, jettonAddress });
    }

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

    if (migrated && stonPoolAddress) {
      const poolState = dexPools.get(stonPoolAddress);
      if (poolState) {
        await pollDedustPool(stonPoolAddress, poolState).catch((error) => {
          console.error(`Immediate DeDust sync error (${stonPoolAddress.slice(0, 12)}...):`, error instanceof Error ? error.message : error);
        });
      }
    }

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

async function dedustTradeAlreadyIndexed(tokenAddress: string, txLt: string, type: 'buy' | 'sell'): Promise<boolean> {
  const { count, error } = await supabase
    .from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('token_address', tokenAddress)
    .eq('source', 'dedust')
    .eq('tx_lt', txLt)
    .eq('type', type);
  if (error) return false;
  return (count || 0) > 0;
}

async function handleTokenDeployed(body: Cell): Promise<boolean> {
  const slice = body.beginParse();
  if (slice.remainingBits < 32) return false;
  if (slice.loadUint(32) !== OP_TOKEN_DEPLOYED) return false;
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
    await updateReserves(bcAddrStr).catch((error) => {
      console.error(`Reserve refresh failed for existing token ${bcAddrStr.slice(0, 12)}...:`, error instanceof Error ? error.message : error);
    });
    return true;
  }

  const inserted = await upsertToken({
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
  if (!inserted) throw new Error(`Token upsert failed for ${bcAddrStr}`);

  bondingCurves.set(bcAddrStr, { address: bcAddrStr });
  await updateReserves(bcAddrStr).catch((error) => {
    console.error(`Initial reserve refresh failed for ${bcAddrStr.slice(0, 12)}...:`, error instanceof Error ? error.message : error);
  });
  return true;
}

async function pollFactory() {
  try {
    const stateKey = indexerStateKey('factory', FACTORY_ADDRESS);
    const persisted = await loadIndexerState(stateKey);
    const lastFactoryLt = parseNano(persisted.lastLt);
    const txs = await retry('getTransactions(factory)', () =>
      client.getTransactions(Address.parse(FACTORY_ADDRESS), { limit: 50, archival: false }),
    );
    const orderedTxs = [...txs].sort((a, b) => {
      const aLt = txLtValue(a);
      const bLt = txLtValue(b);
      return aLt < bLt ? -1 : aLt > bLt ? 1 : 0;
    });

    for (const tx of orderedTxs) {
      const txLt = txLtValue(tx);
      if (lastFactoryLt && txLt <= lastFactoryLt) continue;
      const txHash = txHashHex(tx);
      if (seenTxs.has(txHash)) continue;

      let tokenEventFailed = false;
      let tokenEventHandled = false;
      for (const outMsg of tx.outMessages.values()) {
        if (outMsg.body) {
          try {
            tokenEventHandled = (await handleTokenDeployed(outMsg.body)) || tokenEventHandled;
          } catch (error) {
            tokenEventFailed = true;
            console.error('TokenDeployed handling error:', error instanceof Error ? error.message : error);
          }
        }
      }
      if (tokenEventFailed) {
        throw new Error(`Factory token event handling failed at lt ${txLt.toString()}; cursor not advanced`);
      }
      if (tokenEventHandled) {
        console.log(`Factory token event indexed at lt ${txLt.toString()}`);
      }
      await saveIndexerState(stateKey, { lastLt: txLt.toString(), lastHash: txHash });
      seenTxs.add(txHash);
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
            const userAddress = inMsg.info.type === 'internal' ? inMsg.info.src : null;
            const userAddr = userAddress ? userAddress.toString() : 'unknown';
            const mintedAmount = Array.from(tx.outMessages.values()).reduce(
              (sum, outMsg) => sum + parseMintedAmount(outMsg.body, userAddress || undefined),
              0n,
            );
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
            const forwardPayload = parseForwardPayload(slice, [OP_SELL_TOKENS]);
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

function dedustEventTradeType(event: NonNullable<ReturnType<typeof parseDedustSwapEvent>>, jetton: Address): 'buy' | 'sell' | null {
  if (dedustAssetIsNative(event.assetIn) && dedustAssetIsJetton(event.assetOut, jetton)) return 'buy';
  if (dedustAssetIsJetton(event.assetIn, jetton) && dedustAssetIsNative(event.assetOut)) return 'sell';
  return null;
}

async function processDedustPoolTransactions(poolAddress: string, state: DexPoolState, data: DexPoolData): Promise<boolean> {
  const pool = Address.parse(poolAddress);
  const jetton = Address.parse(state.jettonAddress);
  const txs = await retry('getTransactions(dedust pool)', () =>
    client.getTransactions(pool, { limit: 40, archival: false }),
  );
  const orderedTxs = [...txs].sort((a, b) => {
    const aLt = txLtValue(a);
    const bLt = txLtValue(b);
    return aLt < bLt ? -1 : aLt > bLt ? 1 : 0;
  });
  let recorded = false;

  for (const tx of orderedTxs) {
    const currentLt = txLtValue(tx);
    if (state.lastPoolLt && currentLt <= state.lastPoolLt) continue;

    let eventIndex = 0;
    for (const outMsg of tx.outMessages.values()) {
      const event = parseDedustSwapEvent(outMsg.body);
      if (!event) continue;
      const tradeType = dedustEventTradeType(event, jetton);
      if (!tradeType) continue;

      const eventData: DexPoolData = { reserve0: event.reserve0, reserve1: event.reserve1, assets: data.assets };
      const { marketCapTon, priceTon } = poolMarketData(state, eventData);
      const tokenAmount = tradeType === 'buy' ? event.amountOut : event.amountIn;
      const tonAmount = tradeType === 'buy' ? event.amountIn : event.amountOut;
      const at = txTime(tx);
      const txLt = currentLt.toString();
      if (await dedustTradeAlreadyIndexed(state.tokenAddress, txLt, tradeType)) {
        eventIndex += 1;
        continue;
      }
      const txHash = `dedust:${poolAddress}:${txHashHex(tx)}:${eventIndex}`;

      const trade = await recordDexPoolMove({
        poolAddress,
        tokenAddress: state.tokenAddress,
        type: tradeType,
        tokenAmount,
        tonAmount,
        marketCapTon,
        priceTon,
        at,
        sequence: `${txLt}:${eventIndex}`,
        traderAddress: event.sender.toString(),
        txHash,
        txLt,
      });
      if (trade) {
        recorded = true;
        await upsertCandles({
          tokenAddress: state.tokenAddress,
          type: tradeType,
          tonAmount,
          marketCapTon,
          priceTon,
          at,
        });
        if (tradeType === 'sell') {
          scheduleFeeAutoSweep({
            tokenAddress: state.tokenAddress,
            jettonAddress: state.jettonAddress,
            poolAddress,
            reason: 'dedust-sell',
          });
        }
      }
      eventIndex += 1;
    }

    state.lastPoolLt = currentLt;
  }

  return recorded;
}

async function processDedustReserveFallback(args: {
  poolAddress: string;
  state: DexPoolState;
  data: DexPoolData;
  previousReserve0: bigint;
  previousReserve1: bigint;
}) {
  const { poolAddress, state, data, previousReserve0, previousReserve1 } = args;
  if (previousReserve0 === 0n || previousReserve1 === 0n) return;
  if (data.reserve0 === previousReserve0 && data.reserve1 === previousReserve1) return;

  const previousTokenReserve = state.tokenReserveIndex === 1 ? previousReserve1 : previousReserve0;
  const previousTonReserve = state.tokenReserveIndex === 1 ? previousReserve0 : previousReserve1;
  const currentTokenReserve = state.tokenReserveIndex === 1 ? data.reserve1 : data.reserve0;
  const currentTonReserve = state.tokenReserveIndex === 1 ? data.reserve0 : data.reserve1;
  const tokenDelta = currentTokenReserve > previousTokenReserve ? currentTokenReserve - previousTokenReserve : previousTokenReserve - currentTokenReserve;
  const tonDelta = currentTonReserve > previousTonReserve ? currentTonReserve - previousTonReserve : previousTonReserve - currentTonReserve;
  if (tokenDelta <= 0n || tonDelta <= 0n) return;

  const tradeType = currentTokenReserve > previousTokenReserve ? 'sell' : 'buy';
  const attribution = await resolveDedustSwapAttribution({ poolAddress, state, tradeType });
  const { marketCapTon, priceTon } = poolMarketData(state, data);
  const at = attribution?.blockTime || new Date().toISOString();
  const dedustTokenAmount = attribution?.amountIn && tradeType === 'sell' ? attribution.amountIn : tokenDelta;
  const dedustTonAmount = attribution?.amountIn && tradeType === 'buy' ? attribution.amountIn : tonDelta;
  if (attribution?.txLt && await dedustTradeAlreadyIndexed(state.tokenAddress, attribution.txLt, tradeType)) return;
  await recordDexPoolMove({
    poolAddress,
    tokenAddress: state.tokenAddress,
    type: tradeType,
    tokenAmount: dedustTokenAmount,
    tonAmount: dedustTonAmount,
    marketCapTon,
    priceTon,
    at,
    sequence: attribution?.txLt || `${Date.now()}:${data.reserve0}:${data.reserve1}`,
    traderAddress: attribution?.traderAddress,
    txHash: attribution?.txHash,
    txLt: attribution?.txLt,
  });
  await upsertCandles({
    tokenAddress: state.tokenAddress,
    type: tradeType,
    tonAmount: dedustTonAmount,
    marketCapTon,
    priceTon,
    at,
  });
}

async function pollDedustPool(poolAddress: string, state: DexPoolState) {
  const pool = client.open(Pool.createFromAddress(Address.parse(poolAddress)));
  const [reserves, assets] = await Promise.all([
    pool.getReserves(),
    pool.getAssets(),
  ]);
  const data: DexPoolData = { reserve0: reserves[0], reserve1: reserves[1], assets };
  await ensureDexPoolState(poolAddress, state, data);
  if (data.reserve0 <= 0n || data.reserve1 <= 0n) return;

  const previousReserve0 = state.lastReserve0;
  const previousReserve1 = state.lastReserve1;
  const { marketCapTon, priceTon } = poolMarketData(state, data);

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

  const recordedFromEvents = await processDedustPoolTransactions(poolAddress, state, data);
  if (!recordedFromEvents) {
    await processDedustReserveFallback({ poolAddress, state, data, previousReserve0, previousReserve1 });
  }

  state.lastReserve0 = data.reserve0;
  state.lastReserve1 = data.reserve1;
  await savePoolIndexerState(poolAddress, state);
}

async function pollDedustPools() {
  const poolEntries = Array.from(dexPools.entries());
  const selected = selectBatch(poolEntries, poolCursor, POOLS_PER_TICK);
  poolCursor = selected.nextCursor;

  for (const [poolAddress, state] of selected.batch) {
    try {
      await pollDedustPool(poolAddress, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('exit_code: -13') || message.includes('Unable to execute get method')) {
        markInvalidPool(poolAddress, message);
      } else {
        console.error(`DeDust pool poll error (${poolAddress.slice(0, 12)}...):`, message);
      }
    }
  }
}

async function pollFeeAutoSweeps() {
  if (!AUTO_SWEEP_FEES_ENABLED) return;
  const poolEntries = Array.from(dexPools.entries());
  const selected = selectBatch(poolEntries, sweepCursor, Math.max(1, POOLS_PER_TICK));
  sweepCursor = selected.nextCursor;

  for (const [poolAddress, state] of selected.batch) {
    scheduleFeeAutoSweep({
      tokenAddress: state.tokenAddress,
      jettonAddress: state.jettonAddress,
      poolAddress,
      reason: 'periodic-scan',
    });
  }
}

async function bootstrap() {
  console.log('Loading existing tokens from database...');
  const { data, error } = await supabase
    .from('tokens')
    .select('address, jetton_address, master_address, migrated, is_migrated, migration_state, ston_pool_address, created_at')
    .order('created_at', { ascending: false })
    .limit(BOOTSTRAP_TOKEN_LIMIT);
  if (error) {
    console.error('Bootstrap error:', error.message);
    return;
  }

  for (const token of (data || []) as Array<TokenRow & { migrated?: boolean; is_migrated?: boolean }>) {
    if (!token.address) continue;
    if (INDEXER_RUN_ONCE || (Number(token.migration_state || 0) < 2 && !token.migrated && !token.is_migrated)) {
      const reserves = await updateReserves(token.address);
      if (reserves) bondingCurves.set(token.address, { address: token.address });
      await sleep(250);
    }
    let pool = token.ston_pool_address;
    const jetton = token.jetton_address || token.master_address || '';
    if ((Number(token.migration_state || 0) >= 2 || token.migrated || token.is_migrated) && !pool && jetton) {
      pool = await deriveDedustPool(token.address, jetton);
      await sleep(250);
    }
    if (pool && jetton) {
      await registerDedustPool({ poolAddress: pool, tokenAddress: token.address, jettonAddress: jetton });
    }
  }
  console.log(`Watching ${bondingCurves.size} active curves and ${dexPools.size} DeDust pools`);
}

async function main() {
  acquireIndexerLock();
  console.log('Tonked indexer');
  console.log(`Factory: ${FACTORY_ADDRESS}`);
  console.log(`Factory polling: ${FACTORY_POLL_INTERVAL_MS}ms`);
  console.log(`Curve polling: ${CURVE_POLL_INTERVAL_MS}ms, ${CURVES_PER_TICK} curve(s) per tick`);
  console.log(`Pool polling: ${POOL_POLL_INTERVAL_MS}ms, ${POOLS_PER_TICK} pool(s) per tick`);
  console.log(`Auto fee sweep: ${AUTO_SWEEP_FEES_ENABLED ? 'enabled' : 'disabled'}`);
  console.log(`Live webhook: ${LIVE_EVENTS_WEBHOOK_URL || 'disabled'}`);

  if (INDEXER_RUN_ONCE) {
    await pollFactory();
    await bootstrap();
    await pollBondingCurves();
    await pollDedustPools();
    await pollFeeAutoSweeps();
    return;
  }
  startTonapiWebhookReceiver();
  await bootstrap();
  startPoller('factory', FACTORY_POLL_INTERVAL_MS, pollFactory);
  startPoller('curves', CURVE_POLL_INTERVAL_MS, pollBondingCurves);
  startPoller('dedust-pools', POOL_POLL_INTERVAL_MS, pollDedustPools);
  startPoller('fee-auto-sweep', AUTO_SWEEP_SCAN_INTERVAL_MS, pollFeeAutoSweeps);
}

main().catch(console.error);
