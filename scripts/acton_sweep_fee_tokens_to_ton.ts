import { Address, SendMode, Cell, beginCell, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { Asset, Factory, PoolType } from '@dedust/sdk';
import * as dotenv from 'dotenv';
import { jettonTransferBody } from '../wrappers/acton/LaunchpadActon';

dotenv.config();

const DEFAULT_DEDUST_FACTORY_ADDRESS = 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67';
const OP_DEDUST_JETTON_SWAP = 0xe3a0d482;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
          bounce: true,
          body: args.body,
        }),
      ],
    }),
  );
  await waitSeqno(args.wallet, seqno);
}

async function getWalletAddress(client: TonClient, master: Address, owner: Address): Promise<Address> {
  const result = await retry('get_wallet_address', () =>
    client.runMethod(master, 'get_wallet_address', [
      {
        type: 'slice',
        cell: beginCell().storeAddress(owner).endCell(),
      },
    ]),
  );
  return result.stack.readAddress();
}

async function jettonBalance(client: TonClient, wallet: Address): Promise<bigint> {
  const state = await retry('getContractState(jettonWallet)', () => client.getContractState(wallet));
  if (state.state !== 'active') return 0n;
  const result = await retry('get_wallet_data', () => client.runMethod(wallet, 'get_wallet_data'));
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

async function main() {
  const execute = hasFlag('--execute') && !hasFlag('--dry-run');
  const jettonMasterRaw = argValue('--jetton-master') || process.env.SWEEP_JETTON_MASTER;
  if (!jettonMasterRaw) {
    throw new Error('Pass --jetton-master=<address> or set SWEEP_JETTON_MASTER');
  }

  const dedustFactoryRaw = process.env.DEDUST_FACTORY_ADDRESS || process.env.NEXT_PUBLIC_DEDUST_FACTORY_ADDRESS || DEFAULT_DEDUST_FACTORY_ADDRESS;
  const mnemonicRaw = process.env.TESTNET_PLATFORM_WALLET_MNEMONIC || process.env.PLATFORM_WALLET_MNEMONIC;
  if (!dedustFactoryRaw || !mnemonicRaw || !process.env.TONCENTER_API_KEY) {
    throw new Error('Set DEDUST_FACTORY_ADDRESS, TESTNET_PLATFORM_WALLET_MNEMONIC, and TONCENTER_API_KEY');
  }

  const endpoint = process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
  const client = new TonClient({ endpoint, apiKey: process.env.TONCENTER_API_KEY });
  const key = await mnemonicToWalletKey(mnemonicRaw.trim().split(/\s+/));
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });
  const openedWallet = client.open(wallet);
  const expectedPlatform = process.env.TESTNET_PLATFORM_WALLET
    ? Address.parse(process.env.TESTNET_PLATFORM_WALLET)
    : null;
  if (expectedPlatform && !wallet.address.equals(expectedPlatform)) {
    throw new Error('TESTNET_PLATFORM_WALLET_MNEMONIC does not match TESTNET_PLATFORM_WALLET');
  }

  const jettonMaster = Address.parse(jettonMasterRaw);
  const dedustFactory = client.open(Factory.createFromAddress(Address.parse(dedustFactoryRaw)));
  const assets: [Asset, Asset] = [Asset.native(), Asset.jetton(jettonMaster)];
  const [jettonVault, pool] = await Promise.all([
    retry('get DeDust jetton vault', () => dedustFactory.getVaultAddress(Asset.jetton(jettonMaster))),
    retry('get DeDust pool', () => dedustFactory.getPoolAddress({ poolType: PoolType.VOLATILE, assets })),
  ]);
  const platformJettonWallet = await getWalletAddress(client, jettonMaster, wallet.address);
  const tokenBalance = await jettonBalance(client, platformJettonWallet);
  const tonBefore = await retry('getBalance(platform)', () => client.getBalance(wallet.address));
  const amountRaw = argValue('--amount-nano');
  const amount = amountRaw ? BigInt(amountRaw) : tokenBalance;
  const txValue = toNano(argValue('--tx-value-ton') || '0.4');
  const forwardTonAmount = toNano(argValue('--forward-ton') || '0.25');
  const maxSpend = toNano(argValue('--max-spend-ton') || process.env.TESTNET_SWEEP_MAX_SPEND_TON || '0.5');

  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Platform wallet: ${wallet.address.toString({ testOnly: true })}`);
  console.log(`Fee token wallet: ${platformJettonWallet.toString({ testOnly: true })}`);
  console.log(`DeDust jetton vault: ${jettonVault.toString({ testOnly: true })}`);
  console.log(`DeDust pool: ${pool.toString({ testOnly: true })}`);
  console.log(`Fee token balance: ${Number(tokenBalance) / 1e9}`);
  console.log(`Sweep amount: ${Number(amount) / 1e9}`);
  console.log(`Platform TON balance before: ${Number(tonBefore) / 1e9}`);

  if (amount <= 0n) throw new Error('No fee tokens to sweep');
  if (txValue > maxSpend) {
    throw new Error(`tx value exceeds max spend: ${Number(txValue) / 1e9} > ${Number(maxSpend) / 1e9}`);
  }
  if (!execute) {
    console.log('Dry-run only. Add --execute to swap fee tokens to TON.');
    return;
  }
  if (tonBefore <= txValue) {
    throw new Error('Platform wallet needs more TON for sweep gas');
  }

  const swapPayload = dedustJettonSwapPayload({
    pool,
    minOut: BigInt(argValue('--min-ton-out-nano') || '0'),
    recipient: wallet.address,
  });

  await sendOne({
    wallet: openedWallet,
    secretKey: key.secretKey,
    to: platformJettonWallet,
    value: txValue,
    body: jettonTransferBody({
      queryId: BigInt(Date.now()),
      amount,
      destination: jettonVault,
      responseDestination: wallet.address,
      forwardTonAmount,
      forwardPayload: swapPayload,
      forwardPayloadByRef: true,
    }),
  });

  await sleep(20000);
  const tokenBalanceAfter = await jettonBalance(client, platformJettonWallet);
  const tonAfter = await retry('getBalance(platform)', () => client.getBalance(wallet.address));
  console.log(`Fee token balance after: ${Number(tokenBalanceAfter) / 1e9}`);
  console.log(`Platform TON balance after: ${Number(tonAfter) / 1e9}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
