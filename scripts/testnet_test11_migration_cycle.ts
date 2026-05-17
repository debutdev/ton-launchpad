import { Address, Cell, SendMode, beginCell, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { Asset, Factory, Pool, PoolType, ReadinessStatus } from '@dedust/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { buyTokensBody, jettonTransferBody, sellForwardPayload } from '../wrappers/acton/LaunchpadActon';
import { getBuyQuote as getLocalBuyQuote, getMarketCap } from '../lib/bondingCurve';

dotenv.config();

const OP_DEPLOY_TOKEN = 0x20001;
const OP_TOKEN_DEPLOYED = 0x20002;
const OP_CONFIGURE_DEDUST = 0x10005;
const OP_DEDUST_JETTON_SWAP = 0xe3a0d482;
const OP_DEDUST_NATIVE_SWAP = 0xea06185d;
const TEST11_SYMBOL = 'TEST11';
const TEST11_NAME = 'test11';
const NORMAL_BUY_GAS = toNano('0.1');
const MIGRATION_BUY_GAS = toNano('1.2');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TokenAddresses = {
  curve: Address;
  master: Address;
};

type DedustAddresses = {
  nativeVault: Address;
  jettonVault: Address;
  pool: Address;
};

type IndexedToken = {
  address: string;
  jetton_address: string | null;
  migration_state: number | string | null;
  ston_pool_address: string | null;
};

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function argValue(name: string): string | undefined {
  const prefixed = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.replace(/^"|"$/g, '').trim();
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 20): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (error?.isAxiosError || error?.response?.status === 429 || error?.message?.includes('Request failed')) {
        const waitMs = Math.min(3000 * attempt, 12000);
        console.log(`Retry ${attempt}/${attempts} on ${label}; waiting ${waitMs / 1000}s`);
        await sleep(waitMs);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function getSupabase(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

async function waitForIndexedToken(supabase: SupabaseClient, curve: Address, master: Address): Promise<IndexedToken> {
  const curveAddress = curve.toString();
  const masterAddress = master.toString();
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const { data, error } = await supabase
      .from('tokens')
      .select('address, jetton_address, migration_state, ston_pool_address')
      .or(`address.eq.${curveAddress},jetton_address.eq.${masterAddress},master_address.eq.${masterAddress}`)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Supabase token query failed: ${error.message}`);
    if (data?.address) return data as IndexedToken;
    await sleep(3000);
  }
  throw new Error('Timed out waiting for indexer to insert launched token');
}

async function waitForIndexedMigration(supabase: SupabaseClient, curve: Address, pool: Address): Promise<IndexedToken> {
  const curveAddress = curve.toString();
  const poolAddress = pool.toString();
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    const { data, error } = await supabase
      .from('tokens')
      .select('address, jetton_address, migration_state, ston_pool_address')
      .eq('address', curveAddress)
      .maybeSingle();
    if (error) throw new Error(`Supabase migration query failed: ${error.message}`);
    const token = data as IndexedToken | null;
    if (token && Number(token.migration_state || 0) >= 2 && token.ston_pool_address === poolAddress) return token;
    await sleep(3000);
  }
  throw new Error('Timed out waiting for indexer to register migrated DeDust pool');
}

async function waitForIndexedPoolCursor(supabase: SupabaseClient, pool: Address): Promise<void> {
  const key = `dedust_pool:${pool.toString()}`;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const { data, error } = await supabase
      .from('indexer_state')
      .select('key, value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(`Supabase indexer_state query failed: ${error.message}`);
    if (data?.value) return;
    await sleep(3000);
  }
  throw new Error('Timed out waiting for indexer to persist DeDust pool cursor');
}

async function waitForIndexedDedustTrade(
  supabase: SupabaseClient,
  curve: Address,
  type: 'buy' | 'sell',
  wallet: Address,
  sinceIso: string,
): Promise<void> {
  const curveAddress = curve.toString();
  const walletAddress = wallet.toString();
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const { data, error } = await supabase
      .from('trades')
      .select('tx_hash, trader_address, user_address, ton_amount, token_amount, block_time')
      .eq('token_address', curveAddress)
      .eq('source', 'dedust')
      .eq('type', type)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw new Error(`Supabase DeDust trade query failed: ${error.message}`);
    const attributed = (data || []).find((trade: any) => trade.trader_address === walletAddress || trade.user_address === walletAddress);
    if (attributed) return;
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for indexed attributed DeDust ${type}`);
}

async function waitForIndexedTrade(
  supabase: SupabaseClient,
  curve: Address,
  source: 'bonding_curve' | 'dedust',
  type: 'buy' | 'sell',
  wallet: Address,
  sinceIso: string,
): Promise<any> {
  const curveAddress = curve.toString();
  const walletAddress = wallet.toString();
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const { data, error } = await supabase
      .from('trades')
      .select('tx_hash, trader_address, user_address, ton_amount, token_amount, fee_ton, fee_token_amount, block_time, created_at')
      .eq('token_address', curveAddress)
      .eq('source', source)
      .eq('type', type)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw new Error(`Supabase ${source} trade query failed: ${error.message}`);
    const attributed = (data || []).find((trade: any) => trade.trader_address === walletAddress || trade.user_address === walletAddress);
    if (attributed) return attributed;
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for indexed attributed ${source} ${type}`);
}

async function waitForCandles(supabase: SupabaseClient, curve: Address): Promise<void> {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const { count, error } = await supabase
      .from('token_candles')
      .select('token_address', { count: 'exact', head: true })
      .eq('token_address', curve.toString());
    if (error) throw new Error(`Supabase candle query failed: ${error.message}`);
    if ((count || 0) > 0) return;
    await sleep(3000);
  }
  throw new Error('Timed out waiting for indexed candles');
}

async function waitSeqno(wallet: { getSeqno(): Promise<number> }, seqno: number): Promise<void> {
  while ((await retry('getSeqno', () => wallet.getSeqno())) === seqno) {
    await sleep(3000);
  }
}

async function sendOne(args: {
  wallet: any;
  secretKey: Buffer | Uint8Array;
  to: Address;
  value: bigint;
  body?: Cell;
  bounce: boolean;
}): Promise<void> {
  const seqno = Number(await retry('getSeqno', () => args.wallet.getSeqno()));
  await retry('sendTransfer', () =>
    args.wallet.sendTransfer({
      seqno,
      secretKey: args.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      messages: [
        internal({
          to: args.to,
          value: args.value,
          bounce: args.bounce,
          body: args.body,
        }),
      ],
    }),
  );
  await waitSeqno(args.wallet, seqno);
}

function deployTokenBody(queryId: bigint, metadataUrl: string): Cell {
  const content = beginCell().storeUint(1, 8).storeStringTail(metadataUrl).endCell();
  return beginCell()
    .storeUint(OP_DEPLOY_TOKEN, 32)
    .storeUint(queryId, 64)
    .storeRef(content)
    .storeCoins(0)
    .endCell();
}

function parseTokenDeployed(body: Cell, expectedQueryId: bigint): TokenAddresses | null {
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_TOKEN_DEPLOYED) return null;
    if (slice.loadUintBig(64) !== expectedQueryId) return null;
    return {
      curve: slice.loadAddress(),
      master: slice.loadAddress(),
    };
  } catch {
    return null;
  }
}

async function findTokenDeployed(client: TonClient, factory: Address, queryId: bigint): Promise<TokenAddresses> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const txs = await retry('getTransactions(factory)', () => client.getTransactions(factory, { limit: 30 }));
    for (const tx of txs) {
      for (const outMsg of tx.outMessages.values()) {
        const parsed = outMsg.body ? parseTokenDeployed(outMsg.body, queryId) : null;
        if (parsed) return parsed;
      }
    }
    await sleep(3000);
  }
  throw new Error('Timed out waiting for TokenDeployed event');
}

async function walletAddress(client: TonClient, master: Address, owner: Address): Promise<Address> {
  const result = await retry('get_wallet_address', () =>
    client.runMethod(master, 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
    ]),
  );
  return result.stack.readAddress();
}

async function jettonBalance(client: TonClient, walletAddress_: Address): Promise<bigint> {
  const state = await retry('getContractState(jettonWallet)', () => client.getContractState(walletAddress_));
  if (state.state !== 'active') return 0n;
  const result = await retry('get_wallet_data', () => client.runMethod(walletAddress_, 'get_wallet_data'));
  return result.stack.readBigNumber();
}

async function migrationState(client: TonClient, curve: Address): Promise<number> {
  const result = await retry('getMigrationState', () => client.runMethod(curve, 'getMigrationState'));
  return Number(result.stack.readBigNumber());
}

async function getReserves(client: TonClient, curve: Address) {
  const result = await retry('getReserves', () => client.runMethod(curve, 'getReserves'));
  const stack = result.stack;
  return {
    virtualTonReserves: stack.readBigNumber(),
    virtualTokenReserves: stack.readBigNumber(),
    realTonReserves: stack.readBigNumber(),
    realTokenReserves: stack.readBigNumber(),
    currentSupply: stack.readBigNumber(),
    migrationState: Number(stack.readBigNumber()),
  };
}

async function getCurveBuyQuote(client: TonClient, curve: Address, tonIn: bigint) {
  const result = await retry('getBuyQuote', () =>
    client.runMethod(curve, 'getBuyQuote', [{ type: 'int', value: tonIn }]),
  );
  return {
    amountOut: result.stack.readBigNumber(),
    fee: result.stack.readBigNumber(),
  };
}

async function getCurveSellQuote(client: TonClient, curve: Address, tokensIn: bigint) {
  const result = await retry('getSellQuote', () =>
    client.runMethod(curve, 'getSellQuote', [{ type: 'int', value: tokensIn }]),
  );
  return {
    amountOut: result.stack.readBigNumber(),
    fee: result.stack.readBigNumber(),
  };
}

async function getCurveMarketData(client: TonClient, curve: Address) {
  const result = await retry('getMarketData', () => client.runMethod(curve, 'getMarketData'));
  return {
    price: result.stack.readBigNumber(),
    marketCapTon: result.stack.readBigNumber(),
    migrationMarketCapTon: result.stack.readBigNumber(),
    progressBps: result.stack.readBigNumber(),
  };
}

function findMigrationBuyAmount(reserves: Awaited<ReturnType<typeof getReserves>>, threshold: bigint): bigint {
  const current = getMarketCap(reserves.virtualTonReserves, reserves.virtualTokenReserves);
  if (current >= threshold) return toNano('0.001');

  let low = 1n;
  let high = toNano('0.01');
  while (true) {
    const quote = getLocalBuyQuote(high, reserves.virtualTonReserves, reserves.virtualTokenReserves);
    const postMarketCap = getMarketCap(quote.newVirtualTonReserves, quote.newVirtualTokenReserves);
    if (postMarketCap >= threshold) break;
    high *= 2n;
    if (high > toNano('2')) {
      throw new Error(`Migration buy would need more than 2 TON economic input; refusing`);
    }
  }

  while (low < high) {
    const mid = (low + high) / 2n;
    const quote = getLocalBuyQuote(mid, reserves.virtualTonReserves, reserves.virtualTokenReserves);
    const postMarketCap = getMarketCap(quote.newVirtualTonReserves, quote.newVirtualTokenReserves);
    if (postMarketCap >= threshold) high = mid;
    else low = mid + 1n;
  }

  return high + toNano('0.002');
}

async function waitForMigration(client: TonClient, curve: Address): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await migrationState(client, curve);
    if (state === 2 || state === 3) return state;
    await sleep(3000);
  }
  return migrationState(client, curve);
}

async function uploadMetadata(queryId: bigint, name: string, symbol: string): Promise<string> {
  const apiKey = process.env.PINATA_API_KEY?.replace(/^"|"$/g, '');
  const apiSecret = process.env.PINATA_API_SECRET?.replace(/^"|"$/g, '');
  if (!apiKey || !apiSecret) {
    return `https://tonked-test-metadata.local/${queryId}.json`;
  }

  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      pinata_api_key: apiKey,
      pinata_secret_api_key: apiSecret,
    },
    body: JSON.stringify({
      pinataContent: {
        name,
        symbol,
        description: `${name} DeDust full-cycle test token`,
        image: '',
        decimals: 9,
      },
      pinataMetadata: { name: `${symbol}_${queryId}_metadata` },
    }),
  });

  if (!response.ok) {
    throw new Error(`Pinata metadata upload failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) throw new Error('Pinata did not return an IPFS hash');
  return `ipfs://${data.IpfsHash}`;
}

function formatTokens(value: bigint): string {
  return (Number(value) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatTon(value: bigint): string {
  return (Number(value) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 9 });
}

async function waitForActive(client: TonClient, address: Address, label: string, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const state = await retry(label, () => client.getContractState(address));
    if (state.state === 'active') return state;
    await sleep(3000);
  }
  return retry(label, () => client.getContractState(address));
}

async function ensureDedustContracts(args: {
  client: TonClient;
  wallet: any;
  secretKey: Buffer | Uint8Array;
  sender: any;
  jettonMaster: Address;
}): Promise<DedustAddresses> {
  const factory = args.client.open(Factory.createFromAddress(Address.parse(requireEnv('DEDUST_FACTORY_ADDRESS'))));
  const assets: [Asset, Asset] = [Asset.native(), Asset.jetton(args.jettonMaster)];
  const nativeVault = process.env.DEDUST_NATIVE_VAULT
    ? Address.parse(process.env.DEDUST_NATIVE_VAULT)
    : await retry('get DeDust native vault', () => factory.getVaultAddress(Asset.native()));
  const jettonVault = process.env.DEDUST_JETTON_VAULT
    ? Address.parse(process.env.DEDUST_JETTON_VAULT)
    : await retry('get DeDust jetton vault', () => factory.getVaultAddress(Asset.jetton(args.jettonMaster)));
  const pool = process.env.DEDUST_POOL
    ? Address.parse(process.env.DEDUST_POOL)
    : await retry('get DeDust pool', () => factory.getPoolAddress({ poolType: PoolType.VOLATILE, assets }));

  let nativeState = await retry('get native vault state', () => args.client.getContractState(nativeVault));
  if (nativeState.state !== 'active') {
    const seqno = Number(await retry('getSeqno', () => args.wallet.getSeqno()));
    await retry('create native vault', () =>
      factory.sendCreateVault(args.sender, { queryId: BigInt(Date.now()), asset: Asset.native() }),
    );
    await waitSeqno(args.wallet, seqno);
    nativeState = await waitForActive(args.client, nativeVault, 'wait native vault');
  }

  let jettonState = await retry('get jetton vault state', () => args.client.getContractState(jettonVault));
  if (jettonState.state !== 'active') {
    const seqno = Number(await retry('getSeqno', () => args.wallet.getSeqno()));
    await retry('create jetton vault', () =>
      factory.sendCreateVault(args.sender, { queryId: BigInt(Date.now() + 1), asset: Asset.jetton(args.jettonMaster) }),
    );
    await waitSeqno(args.wallet, seqno);
    jettonState = await waitForActive(args.client, jettonVault, 'wait jetton vault');
  }

  let poolState = await retry('get pool state', () => args.client.getContractState(pool));
  if (poolState.state !== 'active') {
    const seqno = Number(await retry('getSeqno', () => args.wallet.getSeqno()));
    await retry('create volatile pool', () =>
      factory.sendCreateVolatilePool(args.sender, { queryId: BigInt(Date.now() + 2), assets }),
    );
    await waitSeqno(args.wallet, seqno);
    poolState = await waitForActive(args.client, pool, 'wait pool');
  }

  console.log(`DeDust native vault: ${nativeVault.toString({ testOnly: true })} (${nativeState.state})`);
  console.log(`DeDust jetton vault: ${jettonVault.toString({ testOnly: true })} (${jettonState.state})`);
  console.log(`DeDust pool: ${pool.toString({ testOnly: true })} (${poolState.state})`);
  return { nativeVault, jettonVault, pool };
}

async function configureDedust(args: {
  wallet: any;
  secretKey: Buffer | Uint8Array;
  curve: Address;
  dedust: DedustAddresses;
}) {
  const body = beginCell()
    .storeUint(OP_CONFIGURE_DEDUST, 32)
    .storeUint(BigInt(Date.now()), 64)
    .storeAddress(args.dedust.nativeVault)
    .storeAddress(args.dedust.jettonVault)
    .storeAddress(args.dedust.pool)
    .endCell();
  await sendOne({
    wallet: args.wallet,
    secretKey: args.secretKey,
    to: args.curve,
    value: toNano('0.05'),
    body,
    bounce: true,
  });
}

function swapParams(recipient: Address): Cell {
  return beginCell()
    .storeUint(Math.floor(Date.now() / 1000) + 900, 32)
    .storeAddress(recipient)
    .storeAddress(null)
    .storeMaybeRef(null)
    .storeMaybeRef(null)
    .endCell();
}

function dedustNativeSwapBody(args: {
  queryId: bigint;
  amount: bigint;
  pool: Address;
  minOut: bigint;
  recipient: Address;
}): Cell {
  return beginCell()
    .storeUint(OP_DEDUST_NATIVE_SWAP, 32)
    .storeUint(args.queryId, 64)
    .storeCoins(args.amount)
    .storeAddress(args.pool)
    .storeUint(0, 1)
    .storeCoins(args.minOut)
    .storeMaybeRef(null)
    .storeRef(swapParams(args.recipient))
    .endCell();
}

function dedustJettonSwapPayload(args: { pool: Address; minOut: bigint; recipient: Address }): Cell {
  return beginCell()
    .storeUint(OP_DEDUST_JETTON_SWAP, 32)
    .storeAddress(args.pool)
    .storeUint(0, 1)
    .storeCoins(args.minOut)
    .storeMaybeRef(null)
    .storeRef(swapParams(args.recipient))
    .endCell();
}

async function main() {
  const execute = hasFlag('--execute') && !hasFlag('--dry-run');
  const tokenName = argValue('--name') || TEST11_NAME;
  const tokenSymbol = (argValue('--symbol') || TEST11_SYMBOL).toUpperCase();
  const resumeCurve = argValue('--curve');
  const resumeMaster = argValue('--master');
  const waitForIndexerDuringRun = !hasFlag('--skip-index-waits');
  const skipCurveTrades = hasFlag('--skip-curve-trades');
  const skipDedustConfig = hasFlag('--skip-dedust-config');
  const maxSpend = toNano(argValue('--max-spend-ton') || '4');
  const minRemaining = toNano(argValue('--min-remaining-ton') || process.env.TESTNET_MIN_REMAINING_TON || '2');
  const curveBuyAmount = toNano(argValue('--curve-buy-ton') || '0.05');
  const dexBuyAmount = toNano(argValue('--dex-buy-ton') || '0.01');
  let plannedCap = 0n;
  if (!resumeCurve || !resumeMaster) plannedCap += toNano('0.7');
  if (!skipCurveTrades) {
    plannedCap += curveBuyAmount + NORMAL_BUY_GAS;
    plannedCap += toNano('0.3');
    plannedCap += curveBuyAmount + NORMAL_BUY_GAS;
  }
  if (!skipDedustConfig) plannedCap += toNano('0.05');
  plannedCap += toNano('1.9');
  plannedCap += toNano('0.35');
  plannedCap += dexBuyAmount + toNano('0.2');
  plannedCap += toNano('0.35');

  if (plannedCap > maxSpend) {
    throw new Error(`Planned cap ${formatTon(plannedCap)} TON exceeds max spend ${formatTon(maxSpend)} TON`);
  }

  const endpoint = process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
  const client = new TonClient({ endpoint, apiKey: requireEnv('TONCENTER_API_KEY') });
  const supabase = getSupabase();
  const mnemonic = requireEnv('WALLET_MNEMONIC').split(/\s+/);
  const factory = Address.parse(process.env.ACTON_TESTNET_FACTORY_ADDRESS || process.env.NEXT_PUBLIC_FACTORY_ADDRESS || '');
  const platform = Address.parse(requireEnv('TESTNET_PLATFORM_WALLET'));
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });
  const openedWallet = client.open(wallet);
  const sender = openedWallet.sender(key.secretKey);
  const balanceBefore = await retry('getBalance(wallet)', () => client.getBalance(wallet.address));
  if (balanceBefore - maxSpend < minRemaining) {
    throw new Error(
      `Refusing: balance ${formatTon(balanceBefore)} TON minus cap ${formatTon(maxSpend)} TON would leave less than ${formatTon(minRemaining)} TON`,
    );
  }

  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Wallet: ${wallet.address.toString({ testOnly: true })}`);
  console.log(`Balance before: ${formatTon(balanceBefore)} TON`);
  console.log(`Factory: ${factory.toString({ testOnly: true })}`);
  console.log(`Token under test: ${tokenName}/${tokenSymbol}`);
  console.log(`Planned outgoing cap: ${formatTon(plannedCap)} TON`);
  if (!execute) {
    console.log('Dry run only. Add --execute to send testnet transactions.');
    return;
  }

  const factoryState = await retry('getContractState(factory)', () => client.getContractState(factory));
  if (factoryState.state !== 'active') throw new Error(`Factory is not active: ${factoryState.state}`);

  const queryId = BigInt(Date.now());
  let token: TokenAddresses;
  if (resumeCurve && resumeMaster) {
    token = {
      curve: Address.parse(resumeCurve),
      master: Address.parse(resumeMaster),
    };
    console.log('Resuming existing launched token.');
  } else {
    const metadataUrl = await uploadMetadata(queryId, tokenName, tokenSymbol);
    console.log(`Metadata: ${metadataUrl}`);
    console.log(`Launching ${tokenName}/${tokenSymbol}...`);
    await sendOne({
      wallet: openedWallet,
      secretKey: key.secretKey,
      to: factory,
      value: toNano('0.7'),
      body: deployTokenBody(queryId, metadataUrl),
      bounce: true,
    });

    token = await findTokenDeployed(client, factory, queryId);
  }
  console.log(`Curve: ${token.curve.toString({ testOnly: true })}`);
  console.log(`Jetton master: ${token.master.toString({ testOnly: true })}`);
  console.log('Waiting for indexer to insert token...');
  await waitForIndexedToken(supabase, token.curve, token.master);

  const userJettonWallet = await walletAddress(client, token.master, wallet.address);
  const platformJettonWallet = await walletAddress(client, token.master, platform);

  if (!skipCurveTrades) {
    console.log('Bonding-curve buy #1...');
    const curveBuy1StartedAt = new Date(Date.now() - 5000).toISOString();
    const beforeCurveBuy1 = await jettonBalance(client, userJettonWallet);
    const curveBuy1Quote = await getCurveBuyQuote(client, token.curve, curveBuyAmount);
    await sendOne({
      wallet: openedWallet,
      secretKey: key.secretKey,
      to: token.curve,
      value: curveBuyAmount + NORMAL_BUY_GAS,
      body: buyTokensBody(queryId + 1n),
      bounce: true,
    });
    await sleep(20000);
    const afterCurveBuy1 = await jettonBalance(client, userJettonWallet);
    const curveBuy1Delta = afterCurveBuy1 - beforeCurveBuy1;
    console.log(`Curve buy #1 received: ${formatTokens(curveBuy1Delta)} ${tokenSymbol}`);
    console.log(`Curve buy #1 quoted: ${formatTokens(curveBuy1Quote.amountOut)} ${tokenSymbol}`);
    if (curveBuy1Delta < curveBuy1Quote.amountOut) {
      throw new Error('Bonding-curve buy #1 minted fewer tokens than quoted');
    }
    if (waitForIndexerDuringRun) {
      await waitForIndexedTrade(supabase, token.curve, 'bonding_curve', 'buy', wallet.address, curveBuy1StartedAt);
    }

    console.log('Bonding-curve sell...');
    const curveSellStartedAt = new Date(Date.now() - 5000).toISOString();
    const curveSellAmount = afterCurveBuy1 / 4n;
    if (curveSellAmount <= 0n) throw new Error('No tokens available for bonding-curve sell test');
    const curveSellQuote = await getCurveSellQuote(client, token.curve, curveSellAmount);
    const platformTonBeforeCurveSell = await retry('getBalance(platform)', () => client.getBalance(platform));
    await sendOne({
      wallet: openedWallet,
      secretKey: key.secretKey,
      to: userJettonWallet,
      value: toNano('0.3'),
      body: jettonTransferBody({
        queryId: queryId + 2n,
        amount: curveSellAmount,
        destination: token.curve,
        responseDestination: wallet.address,
        forwardTonAmount: toNano('0.15'),
        forwardPayload: sellForwardPayload(queryId + 2n, 0n),
      }),
      bounce: true,
    });
    await sleep(25000);
    const afterCurveSell = await jettonBalance(client, userJettonWallet);
    const platformTonAfterCurveSell = await retry('getBalance(platform)', () => client.getBalance(platform));
    const curvePlatformFeeDelta = platformTonAfterCurveSell - platformTonBeforeCurveSell;
    console.log(`Curve sell amount: ${formatTokens(curveSellAmount)} ${tokenSymbol}`);
    console.log(`Curve sell TON out quoted: ${formatTon(curveSellQuote.amountOut)} TON`);
    console.log(`Curve sell platform TON fee quoted: ${formatTon(curveSellQuote.fee)} TON`);
    console.log(`Curve sell platform TON fee delta: ${formatTon(curvePlatformFeeDelta)} TON`);
    if (afterCurveSell > afterCurveBuy1 - curveSellAmount) {
      throw new Error('Bonding-curve sell did not debit user tokens as expected');
    }
    if (curvePlatformFeeDelta < curveSellQuote.fee) {
      throw new Error('Bonding-curve platform TON fee was below quoted 2% fee');
    }
    if (waitForIndexerDuringRun) {
      await waitForIndexedTrade(supabase, token.curve, 'bonding_curve', 'sell', wallet.address, curveSellStartedAt);
    }

    console.log('Bonding-curve buy #2...');
    const curveBuy2StartedAt = new Date(Date.now() - 5000).toISOString();
    const beforeCurveBuy2 = await jettonBalance(client, userJettonWallet);
    const curveBuy2Quote = await getCurveBuyQuote(client, token.curve, curveBuyAmount);
    await sendOne({
      wallet: openedWallet,
      secretKey: key.secretKey,
      to: token.curve,
      value: curveBuyAmount + NORMAL_BUY_GAS,
      body: buyTokensBody(queryId + 3n),
      bounce: true,
    });
    await sleep(20000);
    const afterCurveBuy2 = await jettonBalance(client, userJettonWallet);
    const curveBuy2Delta = afterCurveBuy2 - beforeCurveBuy2;
    console.log(`Curve buy #2 received: ${formatTokens(curveBuy2Delta)} ${tokenSymbol}`);
    console.log(`Curve buy #2 quoted: ${formatTokens(curveBuy2Quote.amountOut)} ${tokenSymbol}`);
    if (curveBuy2Delta < curveBuy2Quote.amountOut) {
      throw new Error('Bonding-curve buy #2 minted fewer tokens than quoted');
    }
    if (waitForIndexerDuringRun) {
      await waitForIndexedTrade(supabase, token.curve, 'bonding_curve', 'buy', wallet.address, curveBuy2StartedAt);
    }
  }

  const dedust = await ensureDedustContracts({
    client,
    wallet: openedWallet,
    secretKey: key.secretKey,
    sender,
    jettonMaster: token.master,
  });

  if (!skipDedustConfig) {
    console.log('Configuring DeDust migration on curve...');
    await configureDedust({ wallet: openedWallet, secretKey: key.secretKey, curve: token.curve, dedust });
  }

  console.log('Buying enough to trigger migration...');
  const marketDataBeforeMigration = await getCurveMarketData(client, token.curve);
  const reservesBeforeMigration = await getReserves(client, token.curve);
  const migrationBuyAmount = findMigrationBuyAmount(reservesBeforeMigration, marketDataBeforeMigration.migrationMarketCapTon);
  const migrationAttachValue = migrationBuyAmount + MIGRATION_BUY_GAS;
  if (migrationAttachValue > toNano('1.9')) {
    throw new Error(`Migration attach value ${formatTon(migrationAttachValue)} TON exceeds the 1.9 TON test cap`);
  }
  console.log(`Migration economic buy amount: ${formatTon(migrationBuyAmount)} TON`);
  console.log(`Migration attached value: ${formatTon(migrationAttachValue)} TON`);
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: token.curve,
    value: migrationAttachValue,
    body: buyTokensBody(queryId + 4n),
    bounce: true,
  });

  const state = await waitForMigration(client, token.curve);
  console.log(`Migration state: ${state} (2=migrated, 3=failed)`);
  if (state !== 2) throw new Error('Token did not migrate successfully');

  const poolContract = client.open(Pool.createFromAddress(dedust.pool));
  const readiness = await retry('get DeDust pool readiness', () => poolContract.getReadinessStatus());
  console.log(`DeDust pool readiness: ${readiness}`);
  if (readiness !== ReadinessStatus.READY) {
    throw new Error(`DeDust pool is not ready after migration: ${readiness}`);
  }
  console.log('Waiting for indexer to register migrated pool...');
  if (waitForIndexerDuringRun) {
    await waitForIndexedMigration(supabase, token.curve, dedust.pool);
    await waitForIndexedPoolCursor(supabase, dedust.pool);
  }

  const migratedTokenBalance = await jettonBalance(client, userJettonWallet);
  console.log(`User token balance after migration buy: ${formatTokens(migratedTokenBalance)} ${tokenSymbol}`);

  async function sellMigrated(label: string, swapAmount: bigint, queryOffset: bigint): Promise<void> {
    console.log(`${label}: selling migrated token through DeDust...`);
    const dexSellStartedAt = new Date(Date.now() - 5000).toISOString();
    const platformBefore = await jettonBalance(client, platformJettonWallet);
    const userBefore = await jettonBalance(client, userJettonWallet);
    const expectedFeeTokens = (swapAmount * 2n) / 100n;
    if (swapAmount <= 0n) throw new Error(`No tokens available for ${label}`);
    if (userBefore < swapAmount) throw new Error(`${label} amount exceeds user balance`);
    await sendOne({
      wallet: openedWallet,
      secretKey: key.secretKey,
      to: userJettonWallet,
      value: toNano('0.35'),
      body: jettonTransferBody({
        queryId: queryId + queryOffset,
        amount: swapAmount,
        destination: dedust.jettonVault,
        responseDestination: wallet.address,
        forwardTonAmount: toNano('0.2'),
        forwardPayload: dedustJettonSwapPayload({
          pool: dedust.pool,
          minOut: 0n,
          recipient: wallet.address,
        }),
        forwardPayloadByRef: true,
      }),
      bounce: true,
    });
    await sleep(25000);
    const platformAfter = await jettonBalance(client, platformJettonWallet);
    const platformDelta = platformAfter - platformBefore;
    const userAfter = await jettonBalance(client, userJettonWallet);
    console.log(`${label} amount: ${formatTokens(swapAmount)} ${tokenSymbol}`);
    console.log(`${label} user token delta: ${formatTokens(userBefore - userAfter)} ${tokenSymbol}`);
    console.log(`${label} platform fee token delta: ${formatTokens(platformDelta)} ${tokenSymbol}`);
    console.log(`${label} expected 2% token fee: ${formatTokens(expectedFeeTokens)} ${tokenSymbol}`);
    if (platformDelta < expectedFeeTokens) {
      throw new Error(`${label} platform fee token delta was below expected 2% sell tax`);
    }
    if (waitForIndexerDuringRun) {
      await waitForIndexedTrade(supabase, token.curve, 'dedust', 'sell', wallet.address, dexSellStartedAt);
    }
  }

  await sellMigrated('Migrated sell #1', migratedTokenBalance / 20n, 5n);

  console.log('Buying migrated token through DeDust...');
  const dexBuyStartedAt = new Date(Date.now() - 5000).toISOString();
  const beforeDexBuyBalance = await jettonBalance(client, userJettonWallet);
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: dedust.nativeVault,
    value: dexBuyAmount + toNano('0.2'),
    body: dedustNativeSwapBody({
      queryId: queryId + 6n,
      amount: dexBuyAmount,
      pool: dedust.pool,
      minOut: 1n,
      recipient: wallet.address,
    }),
    bounce: true,
  });
  await sleep(25000);
  const afterDexBuyBalance = await jettonBalance(client, userJettonWallet);
  console.log(`User token balance before DeDust buy: ${formatTokens(beforeDexBuyBalance)} ${tokenSymbol}`);
  console.log(`User token balance after DeDust buy: ${formatTokens(afterDexBuyBalance)} ${tokenSymbol}`);
  if (afterDexBuyBalance <= beforeDexBuyBalance) throw new Error('Migrated DeDust buy did not increase token balance');
  if (waitForIndexerDuringRun) {
    await waitForIndexedTrade(supabase, token.curve, 'dedust', 'buy', wallet.address, dexBuyStartedAt);
  }

  await sellMigrated('Migrated sell #2', afterDexBuyBalance / 20n, 7n);

  const platformAfterAll = await jettonBalance(client, platformJettonWallet);
  console.log(`Platform fee token balance after migrated sells: ${formatTokens(platformAfterAll)} ${tokenSymbol}`);

  if (waitForIndexerDuringRun) {
    await waitForCandles(supabase, token.curve);
  }

  const balanceAfter = await retry('getBalance(wallet)', () => client.getBalance(wallet.address));
  console.log(`Balance after: ${formatTon(balanceAfter)} TON`);
  console.log(`Actual wallet balance delta: ${formatTon(balanceBefore - balanceAfter)} TON`);
  console.log(`${tokenName} DeDust full migration cycle completed successfully.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
