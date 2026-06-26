import { Address, beginCell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { NextResponse } from 'next/server';
import { DEFAULT_TONAPI_ENDPOINT, DEFAULT_TONCENTER_ENDPOINT, formatTonAddress } from '@/lib/tonNetwork';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const TONCENTER_ENDPOINT = process.env.TONCENTER_ENDPOINT || DEFAULT_TONCENTER_ENDPOINT;
const TONAPI_ENDPOINT = process.env.TONAPI_ENDPOINT || DEFAULT_TONAPI_ENDPOINT;

function isRateLimit(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || message.toLowerCase().includes('rate limit');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTonapiBalance(masterAddress: Address, ownerAddress: Address) {
  const owner = encodeURIComponent(formatTonAddress(ownerAddress));
  const master = encodeURIComponent(formatTonAddress(masterAddress));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.TONAPI_KEY) headers.authorization = `Bearer ${process.env.TONAPI_KEY}`;

  const response = await fetch(`${TONAPI_ENDPOINT}/v2/accounts/${owner}/jettons/${master}`, {
    cache: 'no-store',
    headers,
  });

  if (response.status === 404) {
    return { balance: '0', walletAddress: null as string | null };
  }
  if (!response.ok) {
    throw new Error(`TonAPI balance request failed with ${response.status}`);
  }

  const data = await response.json() as {
    balance?: string | number;
    wallet_address?: string | { address?: string };
  };
  const walletAddress = typeof data.wallet_address === 'string'
    ? data.wallet_address
    : data.wallet_address?.address || null;
  return {
    balance: data.balance?.toString() || '0',
    walletAddress,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const master = url.searchParams.get('master') || '';
  const owner = url.searchParams.get('owner') || '';

  if (!master || !owner) return jsonError('Missing master or owner');

  let masterAddress: Address;
  let ownerAddress: Address;
  try {
    masterAddress = Address.parse(master);
    ownerAddress = Address.parse(owner);
  } catch {
    return jsonError('Invalid address');
  }

  try {
    try {
      const tonapiBalance = await fetchTonapiBalance(masterAddress, ownerAddress);
      if (tonapiBalance) {
        if (tonapiBalance.walletAddress) {
          return NextResponse.json(
            {
              balance: tonapiBalance.balance,
              walletAddress: formatTonAddress(Address.parse(tonapiBalance.walletAddress)),
            },
            { headers: { 'cache-control': 'no-store, max-age=0' } },
          );
        }

        const result = await new TonClient({
          endpoint: TONCENTER_ENDPOINT,
          apiKey: process.env.TONCENTER_API_KEY,
        }).runMethod(
          masterAddress,
          'get_wallet_address',
          [{ type: 'slice', cell: beginCell().storeAddress(ownerAddress).endCell() }],
        );
        return NextResponse.json(
          {
            balance: tonapiBalance.balance,
            walletAddress: formatTonAddress(result.stack.readAddress()),
          },
          { headers: { 'cache-control': 'no-store, max-age=0' } },
        );
      }
    } catch (tonapiError) {
      if (!isRateLimit(tonapiError)) console.warn('TonAPI jetton balance fallback:', tonapiError);
    }

    const client = new TonClient({
      endpoint: TONCENTER_ENDPOINT,
      apiKey: process.env.TONCENTER_API_KEY,
    });

    const result = await client.runMethod(
      masterAddress,
      'get_wallet_address',
      [{ type: 'slice', cell: beginCell().storeAddress(ownerAddress).endCell() }],
    );
    const walletAddress = result.stack.readAddress();
    const state = await client.getContractState(walletAddress);
    if (state.state !== 'active') {
      return NextResponse.json(
        {
          balance: '0',
          walletAddress: formatTonAddress(walletAddress),
        },
        { headers: { 'cache-control': 'no-store, max-age=0' } },
      );
    }

    let walletData;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        walletData = await client.runMethod(walletAddress, 'get_wallet_data');
        break;
      } catch (balanceError) {
        if (!isRateLimit(balanceError) || attempt === 2) throw balanceError;
        await sleep(750 * (attempt + 1));
      }
    }

    return NextResponse.json(
      {
        balance: walletData!.stack.readBigNumber().toString(),
        walletAddress: formatTonAddress(walletAddress),
      },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load jetton balance' },
      { status: 502 },
    );
  }
}
