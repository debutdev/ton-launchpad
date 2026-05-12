import { Address, Cell, SendMode, beginCell, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { DEX, pTON } from '@ston-fi/sdk';
import * as dotenv from 'dotenv';
import {
  buyTokensBody,
  jettonTransferBody,
  sellForwardPayload,
} from '../wrappers/acton/LaunchpadActon';

dotenv.config();

const CURVE = Address.parse(process.env.ACTON_RESUME_CURVE_ADDRESS || 'kQCf-Ph0BH7j4MQW3D3bphzPJbfkx9pAIHiu4o1x9Ldlpq_h');
const MASTER = Address.parse(process.env.ACTON_RESUME_JETTON_MASTER || 'kQBH_Cn9SqaxlkYiIVweda3YfSLTeqEc9g-Q-PoQj4ke6QlL');
const START_BALANCE = BigInt(process.env.ACTON_E2E_START_BALANCE_NANO || '12239693510');

const OP_CONFIGURE_STONFI = 0x10005;
const OP_MIGRATE_TO_STONFI = 0x10003;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  body: Cell;
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

function configureBody(args: {
  queryId: bigint;
  router: Address;
  ptonWallet: Address;
  routerTokenWallet: Address;
  lpReceiver: Address;
}): Cell {
  const routerConfig = beginCell()
    .storeAddress(args.router)
    .storeAddress(args.ptonWallet)
    .endCell();
  const receiverConfig = beginCell()
    .storeAddress(args.routerTokenWallet)
    .storeAddress(args.lpReceiver)
    .endCell();
  const config = beginCell().storeRef(routerConfig).storeRef(receiverConfig).endCell();

  return beginCell()
    .storeUint(OP_CONFIGURE_STONFI, 32)
    .storeUint(args.queryId, 64)
    .storeRef(config)
    .endCell();
}

function migrateBody(queryId: bigint): Cell {
  return beginCell()
    .storeUint(OP_MIGRATE_TO_STONFI, 32)
    .storeUint(queryId, 64)
    .endCell();
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

async function migrationState(client: TonClient): Promise<number> {
  const result = await retry('getMigrationState', () =>
    client.runMethod(CURVE, 'getMigrationState'),
  );
  return Number(result.stack.readBigNumber());
}

async function main() {
  const maxSpend = toNano(process.env.TESTNET_MAX_SPEND_TON || '4');
  const plannedResumeSpend = toNano('1.05');

  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY,
  });

  const key = await mnemonicToWalletKey(process.env.WALLET_MNEMONIC!.trim().split(/\s+/));
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });
  const openedWallet = client.open(wallet);
  const currentBalance = await retry('getBalance', () => client.getBalance(wallet.address));
  const spentSoFar = START_BALANCE - currentBalance;

  console.log(`Wallet: ${wallet.address.toString({ testOnly: true })}`);
  console.log(`Current balance: ${Number(currentBalance) / 1e9} TON`);
  console.log(`Spent so far from this E2E: ${Number(spentSoFar) / 1e9} TON`);
  console.log(`Planned resume spend: ${Number(plannedResumeSpend) / 1e9} TON`);
  if (spentSoFar + plannedResumeSpend > maxSpend) {
    throw new Error('Resume plan would exceed TESTNET_MAX_SPEND_TON');
  }

  const router = Address.parse(process.env.STONFI_ROUTER_ADDRESS!);
  const ptonWallet = Address.parse(process.env.STONFI_PTON_WALLET_ADDRESS!);
  const ptonProxy = Address.parse(process.env.STONFI_PTON_PROXY_ADDRESS!);
  const platform = Address.parse(process.env.TESTNET_PLATFORM_WALLET!);
  const userJettonWallet = await walletAddress(client, MASTER, wallet.address);
  const platformJettonWallet = await walletAddress(client, MASTER, platform);
  const routerTokenWallet = await walletAddress(client, MASTER, router);

  const queryId = BigInt(Date.now());
  console.log('Updating current curve STON.fi config...');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: CURVE,
    value: toNano('0.1'),
    body: configureBody({
      queryId,
      router,
      ptonWallet,
      routerTokenWallet,
      lpReceiver: platform,
    }),
    bounce: true,
  });

  console.log('Triggering migration...');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: CURVE,
    value: toNano('0.2'),
    body: migrateBody(queryId + 1n),
    bounce: true,
  });
  await sleep(25000);
  const state = await migrationState(client);
  console.log(`Migration state: ${state}`);
  if (state !== 2) throw new Error('Migration did not complete');

  const routerContract = new DEX.v2_1.Router.CPI(router);
  const proxyTon = pTON.v2_1.create(ptonProxy);

  console.log('Buying migrated token through STON.fi...');
  const stonfiBuy = await routerContract.getSwapTonToJettonTxParams(client as any, {
    userWalletAddress: wallet.address,
    proxyTon,
    offerAmount: toNano('0.02'),
    askJettonAddress: MASTER,
    minAskAmount: 1n,
    queryId: queryId + 2n,
    deadline: Math.floor(Date.now() / 1000) + 900,
  });
  if (stonfiBuy.value > toNano('0.35')) throw new Error('STON.fi buy exceeds resume budget');
  if (!stonfiBuy.body) throw new Error('STON.fi buy did not return a body');
  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: stonfiBuy.to,
    value: stonfiBuy.value,
    body: stonfiBuy.body,
    bounce: true,
  });
  await sleep(20000);

  console.log('Selling migrated token through STON.fi...');
  const balanceAfterBuy = await jettonBalance(client, userJettonWallet);
  const platformBefore = await jettonBalance(client, platformJettonWallet);
  const swapAmount = balanceAfterBuy / 4n;
  if (swapAmount <= 0n) throw new Error('No tokens available for migrated sell test');
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
    value: toNano('0.3'),
    body: jettonTransferBody({
      queryId: queryId + 3n,
      amount: swapAmount,
      destination: router,
      responseDestination: wallet.address,
      forwardTonAmount: toNano('0.24'),
      forwardPayload: swapPayload,
      forwardPayloadByRef: true,
    }),
    bounce: true,
  });
  await sleep(20000);
  const platformAfter = await jettonBalance(client, platformJettonWallet);
  console.log(`Platform tokens before migrated sell: ${Number(platformBefore) / 1e9}`);
  console.log(`Platform tokens after migrated sell: ${Number(platformAfter) / 1e9}`);
  if (platformAfter <= platformBefore) throw new Error('Platform fee did not increase');

  console.log('Resume E2E complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
