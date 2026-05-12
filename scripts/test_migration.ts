import { Address, beginCell, internal, SendMode, toNano } from '@ton/core';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { Asset, Factory, Pool, PoolType, ReadinessStatus } from '@dedust/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;
const DEDUST_FACTORY_ADDRESS = process.env.DEDUST_FACTORY_ADDRESS;

const OP_DEPLOY_TOKEN = 0x20001;
const OP_TOKEN_DEPLOYED = 0x20002;
const OP_BUY_TOKENS = 0x10001;
const OP_CONFIGURE_DEDUST_MIGRATION = 0x10005;
const MIGRATION_THRESHOLD = toNano('0.2');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type WalletKey = Awaited<ReturnType<typeof mnemonicToWalletKey>>;
type OpenedWallet = ReturnType<TonClient['open']>;

async function retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 429 || e?.message?.includes('429')) {
        console.log(`  Rate limited on ${label}, retrying in 3s...`);
        await sleep(3000);
      } else {
        throw e;
      }
    }
  }
}

async function waitForSeqno(walletContract: OpenedWallet, previousSeqno: number) {
  while (await getWalletSeqno(walletContract) === previousSeqno) {
    await sleep(3000);
  }
}

async function getWalletSeqno(walletContract: OpenedWallet): Promise<number> {
  return Number(await retry(() => (walletContract as any).getSeqno(), 'getSeqno'));
}

async function waitForActive(client: TonClient, address: Address, label: string, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const state = await retry(() => client.getContractState(address), label);
    if (state.state === 'active') return state;
    await sleep(3000);
  }

  return retry(() => client.getContractState(address), label);
}

async function findTokenFromFactoryTxs(client: TonClient, queryId: bigint) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const txs = await retry(
      () => client.getTransactions(Address.parse(FACTORY_ADDRESS), { limit: 20 }),
      'get factory txs',
    );

    for (const tx of txs) {
      for (const outMsg of tx.outMessages.values()) {
        if (!outMsg.body) continue;
        try {
          const slice = outMsg.body.beginParse();
          const op = slice.loadUint(32);
          if (op !== OP_TOKEN_DEPLOYED) continue;
          const eventQueryId = slice.loadUintBig(64);
          if (eventQueryId !== queryId) continue;
          return {
            address: slice.loadAddress().toString(),
            jetton_address: slice.loadAddress().toString(),
          };
        } catch {
          // Ignore non-event messages.
        }
      }
    }

    await sleep(3000);
  }

  return null;
}

async function sendExternal(
  walletContract: OpenedWallet,
  key: WalletKey,
  messages: ReturnType<typeof internal>[],
  label: string,
) {
  const seqno = await getWalletSeqno(walletContract);
  await retry(
    () => (walletContract as any).sendTransfer({
      seqno,
      secretKey: key.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      messages,
    }),
    label,
  );
  await waitForSeqno(walletContract, seqno);
}

async function ensureDedustContracts(
  client: TonClient,
  walletContract: OpenedWallet,
  key: WalletKey,
  jettonRoot: Address,
) {
  if (!DEDUST_FACTORY_ADDRESS) {
    throw new Error('Set DEDUST_FACTORY_ADDRESS to the DeDust factory address for the target network.');
  }

  const dedustFactory = client.open(Factory.createFromAddress(Address.parse(DEDUST_FACTORY_ADDRESS)));
  const assets: [Asset, Asset] = [Asset.native(), Asset.jetton(jettonRoot)];
  const nativeVault = process.env.DEDUST_NATIVE_VAULT
    ? Address.parse(process.env.DEDUST_NATIVE_VAULT)
    : await retry(() => dedustFactory.getVaultAddress(Asset.native()), 'get DeDust native vault address');
  const jettonVault = process.env.DEDUST_JETTON_VAULT
    ? Address.parse(process.env.DEDUST_JETTON_VAULT)
    : await retry(() => dedustFactory.getVaultAddress(Asset.jetton(jettonRoot)), 'get DeDust jetton vault address');
  const pool = process.env.DEDUST_POOL
    ? Address.parse(process.env.DEDUST_POOL)
    : await retry(
      () => dedustFactory.getPoolAddress({ poolType: PoolType.VOLATILE, assets }),
      'get DeDust pool address',
    );

  const sender = (walletContract as any).sender(key.secretKey);

  let nativeVaultState = await retry(() => client.getContractState(nativeVault), 'get native vault state');
  if (nativeVaultState.state !== 'active') {
    const seqno = await getWalletSeqno(walletContract);
    await retry(
      () => dedustFactory.sendCreateVault(sender, { queryId: BigInt(Date.now()), asset: Asset.native() }),
      'create native vault',
    );
    await waitForSeqno(walletContract, seqno);
    nativeVaultState = await waitForActive(client, nativeVault, 'wait native vault');
  }

  let jettonVaultState = await retry(() => client.getContractState(jettonVault), 'get jetton vault state');
  if (jettonVaultState.state !== 'active') {
    const seqno = await getWalletSeqno(walletContract);
    await retry(
      () => dedustFactory.sendCreateVault(sender, { queryId: BigInt(Date.now() + 1), asset: Asset.jetton(jettonRoot) }),
      'create jetton vault',
    );
    await waitForSeqno(walletContract, seqno);
    jettonVaultState = await waitForActive(client, jettonVault, 'wait jetton vault');
  }

  let poolState = await retry(() => client.getContractState(pool), 'get pool state');
  if (poolState.state !== 'active') {
    const seqno = await getWalletSeqno(walletContract);
    await retry(
      () => dedustFactory.sendCreateVolatilePool(sender, { queryId: BigInt(Date.now() + 2), assets }),
      'create volatile pool',
    );
    await waitForSeqno(walletContract, seqno);
    poolState = await waitForActive(client, pool, 'wait pool');
  }

  return {
    nativeVault,
    jettonVault,
    pool,
    nativeVaultState: nativeVaultState.state,
    jettonVaultState: jettonVaultState.state,
    poolState: poolState.state,
  };
}

async function configureDedustMigration(
  walletContract: OpenedWallet,
  key: WalletKey,
  curveAddress: Address,
  nativeVault: Address,
  jettonVault: Address,
  pool: Address,
) {
  const body = beginCell()
    .storeUint(OP_CONFIGURE_DEDUST_MIGRATION, 32)
    .storeUint(BigInt(Date.now()), 64)
    .storeAddress(nativeVault)
    .storeAddress(jettonVault)
    .storeAddress(pool)
    .endCell();

  await sendExternal(
    walletContract,
    key,
    [
      internal({
        to: curveAddress,
        value: toNano('0.05'),
        bounce: true,
        body,
      }),
    ],
    'configure DeDust migration',
  );
}

async function deployAndTriggerMigration(
  client: TonClient,
  walletContract: OpenedWallet,
  key: WalletKey,
) {
  const deployQueryId = BigInt(Date.now());
  const uniqueId = deployQueryId.toString(36);
  const metadataUrl = `ipfs://migration-test-${uniqueId}`;
  const contentCell = beginCell().storeUint(0x01, 8).storeStringTail(metadataUrl).endCell();
  const deployBody = beginCell()
    .storeUint(OP_DEPLOY_TOKEN, 32)
    .storeUint(deployQueryId, 64)
    .storeRef(contentCell)
    .endCell();

  await sendExternal(
    walletContract,
    key,
    [
      internal({
        to: Address.parse(FACTORY_ADDRESS),
        value: toNano('0.55'),
        bounce: true,
        body: deployBody,
      }),
    ],
    'deploy token',
  );

  console.log('Deploy confirmed. Reading exact TokenDeployed event...');
  const token = await findTokenFromFactoryTxs(client, deployQueryId);
  if (!token) {
    throw new Error('Could not find TokenDeployed event for this deploy.');
  }

  console.log('BondingCurve:', token.address);
  console.log('JettonMaster:', token.jetton_address);

  const dedust = await ensureDedustContracts(
    client,
    walletContract,
    key,
    Address.parse(token.jetton_address),
  );

  console.log('DeDust native vault:', dedust.nativeVault.toString(), dedust.nativeVaultState);
  console.log('DeDust jetton vault:', dedust.jettonVault.toString(), dedust.jettonVaultState);
  console.log('DeDust pool:', dedust.pool.toString(), dedust.poolState);

  await configureDedustMigration(
    walletContract,
    key,
    Address.parse(token.address),
    dedust.nativeVault,
    dedust.jettonVault,
    dedust.pool,
  );

  const buyBody = beginCell()
    .storeUint(OP_BUY_TOKENS, 32)
    .storeUint(BigInt(Date.now()), 64)
    .storeCoins(0)
    .endCell();

  await sendExternal(
    walletContract,
    key,
    [
      internal({
        to: Address.parse(token.address),
        value: toNano('1.02'), // 0.22 TON buy + 0.8 TON migration gas reserve
        bounce: true,
        body: buyBody,
      }),
    ],
    'buy tokens and trigger migration',
  );

  await sleep(45000);
  return { token, dedust };
}

async function main() {
  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY!,
  });

  const key = await mnemonicToWalletKey(process.env.WALLET_MNEMONIC!.split(' '));
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });
  const walletContract = client.open(wallet);

  const balance = await retry(() => client.getBalance(wallet.address), 'getBalance');
  console.log('Wallet:', wallet.address.toString());
  console.log('Balance:', Number(balance) / 1e9, 'TON');
  console.log('Launchpad factory:', FACTORY_ADDRESS);
  console.log('DeDust factory:', DEDUST_FACTORY_ADDRESS || 'not configured');

  let token: { address: string; jetton_address: string };
  let dedust:
    | Awaited<ReturnType<typeof ensureDedustContracts>>
    | undefined;

  const existingTokenAddress = process.env.MIGRATION_TOKEN_ADDRESS;
  const existingJettonAddress = process.env.MIGRATION_JETTON_ADDRESS;

  if (existingTokenAddress && existingJettonAddress) {
    token = {
      address: existingTokenAddress,
      jetton_address: existingJettonAddress,
    };
    dedust = await ensureDedustContracts(
      client,
      walletContract,
      key,
      Address.parse(token.jetton_address),
    );
    await configureDedustMigration(
      walletContract,
      key,
      Address.parse(token.address),
      dedust.nativeVault,
      dedust.jettonVault,
      dedust.pool,
    );
  } else {
    if (balance < toNano('1.75')) {
      throw new Error('Need about 1.75 TON to deploy a token and trigger a real DeDust migration.');
    }

    const result = await deployAndTriggerMigration(client, walletContract, key);
    token = result.token;
    dedust = result.dedust;
  }

  console.log('BondingCurve:', token.address);
  console.log('JettonMaster:', token.jetton_address);

  const curveAddress = Address.parse(token.address);
  const jettonAddress = Address.parse(token.jetton_address);

  const reserves = await retry(() => client.runMethod(curveAddress, 'getReserves'), 'getReserves');
  const virtualTon = reserves.stack.readBigNumber();
  const virtualTokens = reserves.stack.readBigNumber();
  const realTon = reserves.stack.readBigNumber();
  const realTokens = reserves.stack.readBigNumber();
  const migrated = reserves.stack.readBoolean();

  const jettonData = await retry(() => client.runMethod(jettonAddress, 'get_jetton_data'), 'get_jetton_data');
  const totalSupply = jettonData.stack.readBigNumber();
  const mintable = jettonData.stack.readBoolean();

  const ownWalletResult = await retry(() => client.runMethod(jettonAddress, 'get_wallet_address', [
    { type: 'slice', cell: beginCell().storeAddress(curveAddress).endCell() },
  ]), 'get own jetton wallet');
  const ownTokenWallet = ownWalletResult.stack.readAddress();
  let ownTokenWalletBalance = 0n;
  const ownTokenWalletState = await retry(() => client.getContractState(ownTokenWallet), 'get own jetton wallet state');
  if (ownTokenWalletState.state === 'active') {
    const ownWalletData = await retry(() => client.runMethod(ownTokenWallet, 'get_wallet_data'), 'get own jetton wallet data');
    ownTokenWalletBalance = ownWalletData.stack.readBigNumber();
  }

  const txs = await retry(() => client.getTransactions(curveAddress, { limit: 30 }), 'getTransactions');
  const dedustNativeMessageSeen = txs.some((tx: any) => Array.from(tx.outMessages.values()).some((outMsg: any) => (
    outMsg.info.type === 'internal' && dedust && outMsg.info.dest.equals(dedust.nativeVault)
  )));

  let poolReadiness = 'unknown';
  if (dedust) {
    try {
      const poolContract = client.open(Pool.createFromAddress(dedust.pool));
      poolReadiness = await retry(() => poolContract.getReadinessStatus(), 'get DeDust pool readiness');
    } catch (e: any) {
      console.log('  DeDust pool readiness warning:', e.message);
    }
  }

  console.log('\nMigration check:');
  console.log('  virtualTon:', Number(virtualTon) / 1e9);
  console.log('  virtualTokens:', Number(virtualTokens) / 1e9);
  console.log('  realTon:', Number(realTon) / 1e9);
  console.log('  realTokens:', Number(realTokens) / 1e9);
  console.log('  migrated:', migrated);
  console.log('  jetton totalSupply:', Number(totalSupply) / 1e9);
  console.log('  jetton mintable:', mintable);
  console.log('  own token wallet:', ownTokenWallet.toString());
  console.log('  own token wallet state:', ownTokenWalletState.state);
  console.log('  own token wallet balance:', Number(ownTokenWalletBalance) / 1e9);
  console.log('  DeDust native leg sent:', dedustNativeMessageSeen);
  console.log('  DeDust pool:', dedust?.pool.toString() || 'unknown');
  console.log('  DeDust pool readiness:', poolReadiness);

  if (realTon < MIGRATION_THRESHOLD) {
    throw new Error('Real TON reserves did not cross the migration threshold.');
  }
  if (!migrated) {
    throw new Error('BondingCurve did not mark itself migrated.');
  }
  if (mintable) {
    throw new Error('JettonMaster minting was not closed after migration.');
  }
  if (!dedustNativeMessageSeen) {
    throw new Error('BondingCurve did not send the TON leg to the DeDust native vault.');
  }
  if (ownTokenWalletBalance !== 0n) {
    throw new Error('BondingCurve still holds migration tokens after attempting DeDust LP deposit.');
  }
  if (poolReadiness !== ReadinessStatus.READY) {
    throw new Error(`DeDust pool is not ready after migration. Readiness: ${poolReadiness}`);
  }

  console.log('\nDeDust migration test passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
