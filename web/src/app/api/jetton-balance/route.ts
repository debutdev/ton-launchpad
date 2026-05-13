import { Address, beginCell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { NextResponse } from 'next/server';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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

  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY,
  });

  try {
    const result = await client.runMethod(
      masterAddress,
      'get_wallet_address',
      [{ type: 'slice', cell: beginCell().storeAddress(ownerAddress).endCell() }],
    );
    const walletAddress = result.stack.readAddress();
    const state = await client.getContractState(walletAddress);
    if (state.state !== 'active') {
      return NextResponse.json({
        balance: '0',
        walletAddress: walletAddress.toString({ testOnly: true }),
      });
    }

    const walletData = await client.runMethod(walletAddress, 'get_wallet_data');
    return NextResponse.json({
      balance: walletData.stack.readBigNumber().toString(),
      walletAddress: walletAddress.toString({ testOnly: true }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load jetton balance' },
      { status: 502 },
    );
  }
}
