import { Address, Cell, SendMode, beginCell, contractAddress, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { DEX, pTON } from '@ston-fi/sdk';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  buyTokensBody,
  jettonTransferBody,
  sellForwardPayload,
} from '../wrappers/acton/LaunchpadActon';

dotenv.config();

const DEAD_ADDRESS = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
const OP_DEPLOY_TOKEN = 0x20001;
const OP_TOKEN_DEPLOYED = 0x20002;
const START_MARKET_CAP_TON = 2037489812551n;
const LOW_TEST_MIGRATION_CAP = START_MARKET_CAP_TON + toNano('0.5');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type BuildArtifact = {
  code_boc64: string;
};

type TokenAddresses = {
  curve: Address;
  master: Address;
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

function readCode(name: string): Cell {
  const artifactPath = path.resolve(__dirname, '..', 'build', 'acton', `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as BuildArtifact;
  return Cell.fromBase64(artifact.code_boc64);
}

function factoryInitData(args: {
  owner: Address;
  platformWallet: Address;
  migrationMarketCapTon: bigint;
  stonfiRouter: Address;
  ptonWallet: Address;
  lpReceiver: Address;
}): Cell {
  const stonfiConfig = beginCell()
    .storeAddress(args.stonfiRouter)
    .storeAddress(args.ptonWallet)
    .storeAddress(args.lpReceiver)
    .endCell();

  const codeConfig = beginCell()
    .storeRef(readCode('BondingCurve'))
    .storeRef(readCode('FeeJettonMaster'))
    .storeRef(readCode('FeeJettonWallet'))
    .endCell();

  return beginCell()
    .storeAddress(args.owner)
    .storeAddress(args.platformWallet)
    .storeUint(0, 32)
    .storeCoins(args.migrationMarketCapTon)
    .storeRef(stonfiConfig)
    .storeRef(codeConfig)
    .endCell();
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

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      if (error?.isAxiosError || error?.response?.status === 429) {
        console.log(`Rate limited on ${label}; retrying in 3s`);
        await sleep(3000);
        continue;
      }
      throw error;
    }
  }
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
  init?: { code: Cell; data: Cell };
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
          init: args.init,
        }),
      ],
    }),
  );
  await waitSeqno(args.wallet, seqno);
}

async function findTokenDeployed(
  client: TonClient,
  factory: Address,
  queryId: bigint,
): Promise<TokenAddresses> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const txs = await retry('getTransactions(factory)', () =>
      client.getTransactions(factory, { limit: 20 }),
    );
    for (const tx of txs) {
      for (const outMsg of tx.outMessages.values()) {
        const body = outMsg.body ? parseTokenDeployed(outMsg.body, queryId) : null;
        if (body) return body;
      }
    }
    await sleep(3000);
  }
  throw new Error('Timed out waiting for TokenDeployed external log');
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
  const state = await retry('getContractState(jettonWallet)', () =>
    client.getContractState(walletAddress_),
  );
  if (state.state !== 'active') return 0n;

  const result = await retry('get_wallet_data', () =>
    client.runMethod(walletAddress_, 'get_wallet_data'),
  );
  return result.stack.readBigNumber();
}

async function migrationState(client: TonClient, curve: Address): Promise<number> {
  const result = await retry('getMigrationState', () =>
    client.runMethod(curve, 'getMigrationState'),
  );
  return Number(result.stack.readBigNumber());
}

async function main() {
  const execute = hasFlag('--execute') && !hasFlag('--dry-run');
  const endpoint =
    process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
  const migrationCap = BigInt(
    argValue('--migration-cap-nano') ||
      process.env.TESTNET_MIGRATION_MARKET_CAP_NANO ||
      LOW_TEST_MIGRATION_CAP.toString(),
  );

  const plannedSpend = {
    deployFactory: toNano('0.6'),
    launchToken: toNano('0.7'),
    buy: toNano('0.25'),
    sell: toNano('0.3'),
    migrationBuy: toNano('1.2'),
    postMigrationBuy: toNano('0.45'),
    postMigrationSwap: toNano('0.4'),
  };
  const plannedTotal = Object.values(plannedSpend).reduce((sum, value) => sum + value, 0n);

  const maxSpendRaw = argValue('--max-spend-ton') || process.env.TESTNET_MAX_SPEND_TON;
  const minRemaining = toNano(process.env.TESTNET_MIN_REMAINING_TON || '2');

  const router = process.env.STONFI_ROUTER_ADDRESS
    ? Address.parse(process.env.STONFI_ROUTER_ADDRESS)
    : DEAD_ADDRESS;
  const ptonWallet = process.env.STONFI_PTON_WALLET_ADDRESS
    ? Address.parse(process.env.STONFI_PTON_WALLET_ADDRESS)
    : DEAD_ADDRESS;
  const ptonProxy = process.env.STONFI_PTON_PROXY_ADDRESS
    ? Address.parse(process.env.STONFI_PTON_PROXY_ADDRESS)
    : ptonWallet;
  const lpReceiver = process.env.STONFI_LP_RECEIVER_ADDRESS
    ? Address.parse(process.env.STONFI_LP_RECEIVER_ADDRESS)
    : DEAD_ADDRESS;
  const platformWallet = process.env.TESTNET_PLATFORM_WALLET
    ? Address.parse(process.env.TESTNET_PLATFORM_WALLET)
    : null;

  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Planned max outgoing value: ${Number(plannedTotal) / 1e9} TON`);
  if (maxSpendRaw) {
    console.log(`Configured max spend: ${maxSpendRaw} TON`);
    if (plannedTotal > toNano(maxSpendRaw)) {
      console.log('Configured max spend is below the full from-scratch E2E plan; --execute will refuse unless the plan or cap is changed.');
    }
  }
  console.log(`Migration cap: ${Number(migrationCap) / 1e9} TON market cap`);

  if (!execute) {
    console.log('Dry-run only. Add --execute plus TESTNET_MAX_SPEND_TON to send transactions.');
  }

  if (execute) {
    if (!maxSpendRaw) throw new Error('Set TESTNET_MAX_SPEND_TON before --execute');
    const maxSpend = toNano(maxSpendRaw);
    if (plannedTotal > maxSpend) {
      throw new Error(
        `Planned ${Number(plannedTotal) / 1e9} TON exceeds TESTNET_MAX_SPEND_TON=${maxSpendRaw}`,
      );
    }
    if (!platformWallet) {
      throw new Error('Set TESTNET_PLATFORM_WALLET to a separate fee receiver before --execute');
    }
    if (router.equals(DEAD_ADDRESS) || ptonWallet.equals(DEAD_ADDRESS)) {
      throw new Error('Set STONFI_ROUTER_ADDRESS and STONFI_PTON_WALLET_ADDRESS before --execute');
    }
  }

  const mnemonic = process.env.WALLET_MNEMONIC?.trim().split(/\s+/);
  if (!mnemonic || !process.env.TONCENTER_API_KEY) {
    if (execute) throw new Error('WALLET_MNEMONIC and TONCENTER_API_KEY are required');
    console.log('Wallet/API env missing; dry-run stopped before network access.');
    return;
  }
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });
  const feeReceiver = platformWallet || DEAD_ADDRESS;

  const factoryInit = {
    code: readCode('LaunchpadFactory'),
    data: factoryInitData({
      owner: wallet.address,
      platformWallet: feeReceiver,
      migrationMarketCapTon: migrationCap,
      stonfiRouter: router,
      ptonWallet,
      lpReceiver,
    }),
  };
  const factory = process.env.ACTON_TESTNET_FACTORY_ADDRESS
    ? Address.parse(process.env.ACTON_TESTNET_FACTORY_ADDRESS)
    : contractAddress(0, factoryInit);

  console.log(`Wallet: ${wallet.address.toString({ testOnly: true })}`);
  console.log(`Factory: ${factory.toString({ testOnly: true })}`);
  console.log(`Platform fee wallet owner: ${feeReceiver.toString({ testOnly: true })}`);

  if (!execute) {
    if (!platformWallet) {
      console.log('Dry-run warning: set TESTNET_PLATFORM_WALLET before execute to verify fees.');
    }
    if (router.equals(DEAD_ADDRESS) || ptonWallet.equals(DEAD_ADDRESS)) {
      console.log('Dry-run warning: set STONFI_ROUTER_ADDRESS and STONFI_PTON_WALLET_ADDRESS before execute.');
    }
    return;
  }

  const client = new TonClient({ endpoint, apiKey: process.env.TONCENTER_API_KEY });
  const openedWallet = client.open(wallet);
  const balance = await retry('getBalance', () => client.getBalance(wallet.address));
  console.log(`Wallet balance: ${Number(balance) / 1e9} TON`);

  const maxSpend = toNano(maxSpendRaw!);
  if (balance - maxSpend < minRemaining) {
    throw new Error(
      `Refusing: balance minus max spend would leave less than ${Number(minRemaining) / 1e9} TON`,
    );
  }

  const factoryState = await retry('getContractState(factory)', () =>
    client.getContractState(factory),
  );
  if (factoryState.state !== 'active') {
    console.log('Deploying dedicated Acton factory...');
    await sendOne({
      wallet: openedWallet,
      secretKey: key.secretKey,
      to: factory,
      value: plannedSpend.deployFactory,
      init: factoryInit,
      bounce: false,
    });
  }

  const queryId = BigInt(Date.now());
  const metadataUrl = `ipfs://acton-testnet-${queryId.toString(36)}`;
  console.log('Launching token...');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: factory,
    value: plannedSpend.launchToken,
    body: deployTokenBody(queryId, metadataUrl),
    bounce: true,
  });

  const token = await findTokenDeployed(client, factory, queryId);
  console.log(`Curve: ${token.curve.toString({ testOnly: true })}`);
  console.log(`Jetton master: ${token.master.toString({ testOnly: true })}`);

  console.log('Buying before migration...');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: token.curve,
    value: plannedSpend.buy,
    body: buyTokensBody(queryId + 1n),
    bounce: true,
  });

  const userJettonWallet = await walletAddress(client, token.master, wallet.address);
  const platformJettonWallet = await walletAddress(client, token.master, feeReceiver);
  const bought = await jettonBalance(client, userJettonWallet);
  console.log(`Bought balance: ${Number(bought) / 1e9} tokens`);

  console.log('Selling half to verify 2% platform TON fee...');
  const platformTonBeforeSell = await retry('getBalance(platform)', () =>
    client.getBalance(feeReceiver),
  );
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: userJettonWallet,
    value: plannedSpend.sell,
    body: jettonTransferBody({
      queryId: queryId + 2n,
      amount: bought / 2n,
      destination: token.curve,
      responseDestination: wallet.address,
      forwardTonAmount: toNano('0.15'),
      forwardPayload: sellForwardPayload(queryId + 2n),
    }),
    bounce: true,
  });
  await sleep(15000);
  const platformTonAfterSell = await retry('getBalance(platform)', () =>
    client.getBalance(feeReceiver),
  );
  if (platformTonAfterSell <= platformTonBeforeSell) {
    throw new Error('Platform TON balance did not increase after bonding-curve sell');
  }
  console.log(
    `Platform TON fee after sell: ${Number(platformTonAfterSell - platformTonBeforeSell) / 1e9}`,
  );

  console.log('Buying through low migration cap...');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: token.curve,
    value: plannedSpend.migrationBuy,
    body: buyTokensBody(queryId + 3n),
    bounce: true,
  });
  await sleep(20000);
  const state = await migrationState(client, token.curve);
  console.log(`Migration state: ${state} (2 means migrated)`);
  if (state !== 2) throw new Error('Token did not reach migrated state');

  console.log('Buying migrated token through STON.fi...');
  const routerContract = new DEX.v2_1.Router.CPI(router);
  const proxyTon = pTON.v2_1.create(ptonProxy);
  const stonfiBuy = await routerContract.getSwapTonToJettonTxParams(client as any, {
    userWalletAddress: wallet.address,
    proxyTon,
    offerAmount: toNano('0.05'),
    askJettonAddress: token.master,
    minAskAmount: 1n,
    queryId: queryId + 4n,
    deadline: Math.floor(Date.now() / 1000) + 900,
  });
  if (stonfiBuy.value > plannedSpend.postMigrationBuy) {
    throw new Error('STON.fi buy tx value exceeds the configured post-migration buy budget');
  }
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: stonfiBuy.to,
    value: stonfiBuy.value,
    body: stonfiBuy.body ?? undefined,
    bounce: true,
  });
  await sleep(20000);

  console.log('Selling migrated token through STON.fi and verifying swap tax path...');
  const afterMigrationBalance = await jettonBalance(client, userJettonWallet);
  const platformBeforeSwap = await jettonBalance(client, platformJettonWallet);
  const swapAmount = afterMigrationBalance / 4n;
  const swapPayload = await routerContract.createSwapBody({
    askJettonWalletAddress: ptonWallet,
    refundAddress: wallet.address,
    excessesAddress: wallet.address,
    receiverAddress: wallet.address,
    minAskAmount: 0n,
    referralValue: 0,
    deadline: Math.floor(Date.now() / 1000) + 900,
  });
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: userJettonWallet,
    value: plannedSpend.postMigrationSwap,
    body: jettonTransferBody({
      queryId: queryId + 5n,
      amount: swapAmount,
      destination: router,
      responseDestination: wallet.address,
      forwardTonAmount: toNano('0.25'),
      forwardPayload: swapPayload,
      forwardPayloadByRef: true,
    }),
    bounce: true,
  });
  await sleep(15000);
  const platformAfterSwap = await jettonBalance(client, platformJettonWallet);
  console.log(`Platform fee tokens after STON.fi swap: ${Number(platformAfterSwap) / 1e9}`);
  if (platformAfterSwap <= platformBeforeSwap) {
    throw new Error('Platform fee did not increase after STON.fi swap payload');
  }

  console.log('Acton testnet E2E completed within configured spend cap.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
