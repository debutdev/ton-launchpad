import { Address, Cell, SendMode, beginCell, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { Asset, Factory, Pool, PoolType, ReadinessStatus } from '@dedust/sdk';
import * as dotenv from 'dotenv';
import { buyTokensBody, jettonTransferBody } from '../wrappers/acton/LaunchpadActon';

dotenv.config();

const OP_DEPLOY_TOKEN = 0x20001;
const OP_TOKEN_DEPLOYED = 0x20002;
const OP_CONFIGURE_DEDUST = 0x10005;
const OP_DEDUST_JETTON_SWAP = 0xe3a0d482;
const OP_DEDUST_NATIVE_SWAP = 0xea06185d;
const TEST11_SYMBOL = 'TEST11';
const TEST11_NAME = 'test11';

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

async function waitForMigration(client: TonClient, curve: Address): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await migrationState(client, curve);
    if (state === 2 || state === 3) return state;
    await sleep(3000);
  }
  return migrationState(client, curve);
}

async function uploadMetadata(queryId: bigint): Promise<string> {
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
        name: TEST11_NAME,
        symbol: TEST11_SYMBOL,
        description: 'test11 DeDust migration cycle test token',
        image: '',
        decimals: 9,
      },
      pinataMetadata: { name: `${TEST11_SYMBOL}_${queryId}_metadata` },
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
  const maxSpend = toNano(argValue('--max-spend-ton') || '3.5');
  const minRemaining = toNano(argValue('--min-remaining-ton') || process.env.TESTNET_MIN_REMAINING_TON || '2');
  const plannedCap = toNano('0.7') + toNano('0.05') + toNano('1.8') + toNano('0.3') + toNano('0.4');

  if (plannedCap > maxSpend) {
    throw new Error(`Planned cap ${formatTon(plannedCap)} TON exceeds max spend ${formatTon(maxSpend)} TON`);
  }

  const endpoint = process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
  const client = new TonClient({ endpoint, apiKey: requireEnv('TONCENTER_API_KEY') });
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
  console.log(`Planned outgoing cap: ${formatTon(plannedCap)} TON`);
  if (!execute) {
    console.log('Dry run only. Add --execute to send testnet transactions.');
    return;
  }

  const factoryState = await retry('getContractState(factory)', () => client.getContractState(factory));
  if (factoryState.state !== 'active') throw new Error(`Factory is not active: ${factoryState.state}`);

  const queryId = BigInt(Date.now());
  const metadataUrl = await uploadMetadata(queryId);
  console.log(`Metadata: ${metadataUrl}`);
  console.log(`Launching ${TEST11_NAME}/${TEST11_SYMBOL}...`);
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: factory,
    value: toNano('0.7'),
    body: deployTokenBody(queryId, metadataUrl),
    bounce: true,
  });

  const token = await findTokenDeployed(client, factory, queryId);
  console.log(`Curve: ${token.curve.toString({ testOnly: true })}`);
  console.log(`Jetton master: ${token.master.toString({ testOnly: true })}`);

  const userJettonWallet = await walletAddress(client, token.master, wallet.address);
  const platformJettonWallet = await walletAddress(client, token.master, platform);
  const dedust = await ensureDedustContracts({
    client,
    wallet: openedWallet,
    secretKey: key.secretKey,
    sender,
    jettonMaster: token.master,
  });

  console.log('Configuring DeDust migration on curve...');
  await configureDedust({ wallet: openedWallet, secretKey: key.secretKey, curve: token.curve, dedust });

  console.log('Buying enough to trigger migration...');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: token.curve,
    value: toNano('1.8'),
    body: buyTokensBody(queryId + 1n),
    bounce: true,
  });

  const state = await waitForMigration(client, token.curve);
  console.log(`Migration state: ${state} (2=migrated, 3=failed)`);
  if (state !== 2) throw new Error('Token did not migrate successfully');

  await sleep(20000);
  const poolContract = client.open(Pool.createFromAddress(dedust.pool));
  const readiness = await retry('get DeDust pool readiness', () => poolContract.getReadinessStatus());
  console.log(`DeDust pool readiness: ${readiness}`);
  if (readiness !== ReadinessStatus.READY) {
    throw new Error(`DeDust pool is not ready after migration: ${readiness}`);
  }

  const migratedTokenBalance = await jettonBalance(client, userJettonWallet);
  console.log(`User token balance after migration buy: ${formatTokens(migratedTokenBalance)} ${TEST11_SYMBOL}`);

  console.log('Buying migrated token through DeDust...');
  const beforeDexBuyBalance = await jettonBalance(client, userJettonWallet);
  const buyAmount = toNano('0.02');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: dedust.nativeVault,
    value: buyAmount + toNano('0.25'),
    body: dedustNativeSwapBody({
      queryId: queryId + 2n,
      amount: buyAmount,
      pool: dedust.pool,
      minOut: 1n,
      recipient: wallet.address,
    }),
    bounce: true,
  });
  await sleep(25000);
  const afterDexBuyBalance = await jettonBalance(client, userJettonWallet);
  console.log(`User token balance before DeDust buy: ${formatTokens(beforeDexBuyBalance)}`);
  console.log(`User token balance after DeDust buy: ${formatTokens(afterDexBuyBalance)}`);
  if (afterDexBuyBalance <= beforeDexBuyBalance) throw new Error('Migrated DeDust buy did not increase token balance');

  console.log('Selling migrated token through DeDust...');
  const platformBefore = await jettonBalance(client, platformJettonWallet);
  const swapAmount = afterDexBuyBalance / 10n;
  const expectedFeeTokens = (swapAmount * 2n) / 100n;
  if (swapAmount <= 0n) throw new Error('No tokens available for migrated sell test');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: userJettonWallet,
    value: toNano('0.4'),
    body: jettonTransferBody({
      queryId: queryId + 3n,
      amount: swapAmount,
      destination: dedust.jettonVault,
      responseDestination: wallet.address,
      forwardTonAmount: toNano('0.25'),
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
  console.log(`Platform fee tokens before migrated sell: ${formatTokens(platformBefore)} ${TEST11_SYMBOL}`);
  console.log(`Platform fee tokens after migrated sell: ${formatTokens(platformAfter)} ${TEST11_SYMBOL}`);
  console.log(`Platform fee token delta: ${formatTokens(platformDelta)} ${TEST11_SYMBOL}`);
  console.log(`Expected fee token delta: ${formatTokens(expectedFeeTokens)} ${TEST11_SYMBOL}`);
  if (platformDelta < expectedFeeTokens) {
    throw new Error('Platform fee token delta was below expected 2% sell tax');
  }

  const balanceAfter = await retry('getBalance(wallet)', () => client.getBalance(wallet.address));
  console.log(`Balance after: ${formatTon(balanceAfter)} TON`);
  console.log(`Actual wallet balance delta: ${formatTon(balanceBefore - balanceAfter)} TON`);
  console.log('test11 DeDust migration cycle completed successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
