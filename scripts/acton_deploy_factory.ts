import { Address, Cell, SendMode, beginCell, contractAddress, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

type BuildArtifact = {
  code_boc64: string;
};

const DEAD_ADDRESS = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
const START_MARKET_CAP_TON = 2037489812551n;
const DEFAULT_TEST_MIGRATION_CAP = START_MARKET_CAP_TON + toNano('4');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function requireAddress(name: string): Address {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return Address.parse(value);
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

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 429 || error?.isAxiosError) {
        const waitMs = Math.min(3000 * attempt, 12000);
        console.log(`RPC retry ${attempt} on ${label}; waiting ${waitMs / 1000}s`);
        await sleep(waitMs);
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

async function sendDeploy(args: {
  wallet: any;
  secretKey: Buffer | Uint8Array;
  to: Address;
  value: bigint;
  init: { code: Cell; data: Cell };
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
          bounce: false,
          init: args.init,
        }),
      ],
    }),
  );
  await waitSeqno(args.wallet, seqno);
}

async function main() {
  const endpoint =
    process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
  const migrationCap = BigInt(
    argValue('--migration-cap-nano') ||
      process.env.TESTNET_MIGRATION_MARKET_CAP_NANO ||
      DEFAULT_TEST_MIGRATION_CAP.toString(),
  );
  const deployValue = toNano(argValue('--deploy-ton') || '0.6');
  const maxSpend = toNano(argValue('--max-spend-ton') || '1');
  const minRemaining = toNano(argValue('--min-remaining-ton') || process.env.TESTNET_MIN_REMAINING_TON || '2');

  if (deployValue > maxSpend) {
    throw new Error(`Refusing: deploy value exceeds max spend cap`);
  }

  const mnemonic = process.env.WALLET_MNEMONIC?.trim().split(/\s+/);
  if (!mnemonic || !process.env.TONCENTER_API_KEY) {
    throw new Error('WALLET_MNEMONIC and TONCENTER_API_KEY are required');
  }

  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });
  const platformWallet = requireAddress('TESTNET_PLATFORM_WALLET');
  const stonfiRouter = requireAddress('STONFI_ROUTER_ADDRESS');
  const ptonWallet = requireAddress('STONFI_PTON_WALLET_ADDRESS');
  const lpReceiver = process.env.STONFI_LP_RECEIVER_ADDRESS
    ? Address.parse(process.env.STONFI_LP_RECEIVER_ADDRESS)
    : DEAD_ADDRESS;

  const factoryInit = {
    code: readCode('LaunchpadFactory'),
    data: factoryInitData({
      owner: wallet.address,
      platformWallet,
      migrationMarketCapTon: migrationCap,
      stonfiRouter,
      ptonWallet,
      lpReceiver,
    }),
  };
  const factory = contractAddress(0, factoryInit);

  console.log(`Wallet: ${wallet.address.toString({ testOnly: true })}`);
  console.log(`Factory: ${factory.toString({ testOnly: true })}`);
  console.log(`Factory raw: ${factory.toRawString()}`);
  console.log(`Platform fee wallet owner: ${platformWallet.toString({ testOnly: true })}`);
  console.log(`Migration cap: ${Number(migrationCap) / 1e9} TON market cap`);
  console.log(`Deploy value: ${Number(deployValue) / 1e9} TON`);

  const client = new TonClient({ endpoint, apiKey: process.env.TONCENTER_API_KEY });
  const openedWallet = client.open(wallet);
  const balance = await retry('getBalance', () => client.getBalance(wallet.address));
  console.log(`Wallet balance: ${Number(balance) / 1e9} TON`);

  if (balance - maxSpend < minRemaining) {
    throw new Error(
      `Refusing: balance minus max spend would leave less than ${Number(minRemaining) / 1e9} TON`,
    );
  }

  const state = await retry('getContractState(factory)', () => client.getContractState(factory));
  if (state.state !== 'active') {
    console.log('Deploying fresh Acton factory...');
    await sendDeploy({
      wallet: openedWallet,
      secretKey: key.secretKey,
      to: factory,
      value: deployValue,
      init: factoryInit,
    });
  } else {
    console.log('Factory is already active; no deploy spend needed.');
  }

  const activeState = await retry('getContractState(factory)', () => client.getContractState(factory));
  if (activeState.state !== 'active') {
    throw new Error(`Factory deploy did not become active; state=${activeState.state}`);
  }

  const tokenCount = await retry('getTokenCount', () => client.runMethod(factory, 'getTokenCount'));
  console.log(`Factory active. Token count: ${tokenCount.stack.readBigNumber().toString()}`);
  console.log(`NEXT_PUBLIC_FACTORY_ADDRESS=${factory.toString({ testOnly: true })}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
