import { TonClient } from '@ton/ton';
import { DEX, pTON } from '@ston-fi/sdk';
import { NextRequest, NextResponse } from 'next/server';

type SwapParamsRequest = {
  side?: 'buy' | 'sell';
  jettonMaster?: string;
  userWallet?: string;
  amountNano?: string;
  minOutNano?: string;
};

const sanitize = (value: string | undefined) => (value || '').replace(/[\r\n\t]/g, '').trim();

function getEnvAddress(...names: string[]) {
  for (const name of names) {
    const value = sanitize(process.env[name]);
    if (value) return value;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SwapParamsRequest;
    const side = body.side;
    const jettonMaster = body.jettonMaster || null;
    const userWallet = body.userWallet || null;
    const amount = body.amountNano ? BigInt(body.amountNano) : 0n;
    const minOut = body.minOutNano ? BigInt(body.minOutNano) : 0n;

    if ((side !== 'buy' && side !== 'sell') || !jettonMaster || !userWallet || amount <= 0n) {
      return NextResponse.json({ error: 'Invalid swap request' }, { status: 400 });
    }

    const routerAddress = getEnvAddress('STONFI_ROUTER_ADDRESS', 'NEXT_PUBLIC_STONFI_ROUTER_ADDRESS');
    const ptonProxyAddress = getEnvAddress('STONFI_PTON_PROXY_ADDRESS', 'NEXT_PUBLIC_STONFI_PTON_PROXY_ADDRESS');
    if (!routerAddress || !ptonProxyAddress) {
      return NextResponse.json({ error: 'STON.fi router configuration is missing' }, { status: 500 });
    }

    const endpoint = sanitize(process.env.TONCENTER_ENDPOINT) || 'https://testnet.toncenter.com/api/v2/jsonRPC';
    const apiKey = sanitize(process.env.TONCENTER_API_KEY);
    const client = new TonClient({ endpoint, apiKey: apiKey || undefined });
    const router = new DEX.v2_1.Router.CPI(routerAddress);
    const proxyTon = pTON.v2_1.create(ptonProxyAddress);
    const buyProvider = client as unknown as Parameters<typeof router.getSwapTonToJettonTxParams>[0];
    const sellProvider = client as unknown as Parameters<typeof router.getSwapJettonToTonTxParams>[0];
    const common = {
      userWalletAddress: userWallet,
      receiverAddress: userWallet,
      refundAddress: userWallet,
      excessesAddress: userWallet,
      minAskAmount: minOut,
      queryId: BigInt(Date.now()),
      deadline: Math.floor(Date.now() / 1000) + 900,
    };

    const tx = side === 'buy'
      ? await router.getSwapTonToJettonTxParams(buyProvider, {
          ...common,
          proxyTon,
          offerAmount: amount,
          askJettonAddress: jettonMaster,
        })
      : await router.getSwapJettonToTonTxParams(sellProvider, {
          ...common,
          proxyTon,
          offerJettonAddress: jettonMaster,
          offerAmount: amount,
        });

    return NextResponse.json({
      address: tx.to.toString({ testOnly: true }),
      amount: tx.value.toString(),
      payload: tx.body?.toBoc().toString('base64') ?? '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build STON.fi swap';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
