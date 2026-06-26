import { Address, Cell, beginCell, toNano } from '@ton/core';
import { TonClient } from '@ton/ton';
import { Asset, Factory, PoolType } from '@dedust/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_TONCENTER_ENDPOINT, formatTonAddress } from '@/lib/tonNetwork';

type SwapParamsRequest = {
  side?: 'buy' | 'sell';
  jettonMaster?: string;
  userWallet?: string;
  amountNano?: string;
  minOutNano?: string;
};

const OP_DEDUST_JETTON_SWAP = 0xe3a0d482;
const OP_DEDUST_NATIVE_SWAP = 0xea06185d;
const OP_JETTON_TRANSFER = 0x0f8a7ea5;

const sanitize = (value: string | undefined) => (value || '').replace(/[\r\n\t]/g, '').trim();

function getEnvAddress(...names: string[]) {
  for (const name of names) {
    const value = sanitize(process.env[name]);
    if (value) return Address.parse(value);
  }
  return null;
}

function swapParams(recipient: Address) {
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
}) {
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

function dedustJettonSwapPayload(args: { pool: Address; minOut: bigint; recipient: Address }) {
  return beginCell()
    .storeUint(OP_DEDUST_JETTON_SWAP, 32)
    .storeAddress(args.pool)
    .storeUint(0, 1)
    .storeCoins(args.minOut)
    .storeMaybeRef(null)
    .storeRef(swapParams(args.recipient))
    .endCell();
}

function refForwardPayload(payload: Cell) {
  return beginCell()
    .storeBit(1)
    .storeRef(payload)
    .endCell();
}

function jettonTransferBody(args: {
  queryId: bigint;
  amount: bigint;
  destination: Address;
  responseDestination: Address;
  forwardTonAmount: bigint;
  forwardPayload: Cell;
}) {
  const encodedForwardPayload = refForwardPayload(args.forwardPayload);
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

async function getWalletAddress(client: TonClient, jettonMaster: Address, owner: Address): Promise<Address> {
  const result = await client.runMethod(jettonMaster, 'get_wallet_address', [
    { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
  ]);
  return result.stack.readAddress();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SwapParamsRequest;
    const side = body.side;
    const amount = body.amountNano ? BigInt(body.amountNano) : 0n;
    const minOut = body.minOutNano ? BigInt(body.minOutNano) : 0n;
    if ((side !== 'buy' && side !== 'sell') || !body.jettonMaster || !body.userWallet || amount <= 0n) {
      return NextResponse.json({ error: 'Invalid swap request' }, { status: 400 });
    }

    const dedustFactoryAddress = getEnvAddress('DEDUST_FACTORY_ADDRESS', 'NEXT_PUBLIC_DEDUST_FACTORY_ADDRESS');
    if (!dedustFactoryAddress) {
      return NextResponse.json({ error: 'DeDust configuration is missing' }, { status: 500 });
    }

    const endpoint = sanitize(process.env.TONCENTER_ENDPOINT) || DEFAULT_TONCENTER_ENDPOINT;
    const apiKey = sanitize(process.env.TONCENTER_API_KEY);
    const client = new TonClient({ endpoint, apiKey: apiKey || undefined });
    const userWallet = Address.parse(body.userWallet);
    const jettonMaster = Address.parse(body.jettonMaster);
    const dedustFactory = client.open(Factory.createFromAddress(dedustFactoryAddress));
    const assets: [Asset, Asset] = [Asset.native(), Asset.jetton(jettonMaster)];
    const [nativeVault, jettonVault, pool] = await Promise.all([
      dedustFactory.getVaultAddress(Asset.native()),
      dedustFactory.getVaultAddress(Asset.jetton(jettonMaster)),
      dedustFactory.getPoolAddress({ poolType: PoolType.VOLATILE, assets }),
    ]);
    const queryId = BigInt(Date.now());

    if (side === 'buy') {
      const payload = dedustNativeSwapBody({
        queryId,
        amount,
        pool,
        minOut,
        recipient: userWallet,
      });
      return NextResponse.json({
        address: formatTonAddress(nativeVault),
        amount: (amount + toNano('0.25')).toString(),
        payload: payload.toBoc().toString('base64'),
      });
    }

    const userJettonWallet = await getWalletAddress(client, jettonMaster, userWallet);
    const swapPayload = dedustJettonSwapPayload({ pool, minOut, recipient: userWallet });
    const transferBody = jettonTransferBody({
      queryId,
      amount,
      destination: jettonVault,
      responseDestination: userWallet,
      forwardTonAmount: toNano('0.25'),
      forwardPayload: swapPayload,
    });

    return NextResponse.json({
      address: formatTonAddress(userJettonWallet),
      amount: toNano('0.4').toString(),
      payload: transferBody.toBoc().toString('base64'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build DeDust swap';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
