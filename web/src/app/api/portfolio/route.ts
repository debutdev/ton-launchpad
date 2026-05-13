import { Address, beginCell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  type DbTokenRow,
  type DbTradeRow,
  NANOS_PER_UNIT_NUMBER,
  nanoToNumber,
  normalizeTokenRow,
  parseNano,
} from '@/lib/launchpad';

const TOKEN_SELECT = [
  'id',
  'address',
  'creator_address',
  'name',
  'symbol',
  'description',
  'image_url',
  'metadata_url',
  'twitter_url',
  'telegram_url',
  'website_url',
  'jetton_address',
  'master_address',
  'virtual_ton_reserves',
  'virtual_token_reserves',
  'real_ton_reserves',
  'real_token_reserves',
  'market_cap_ton',
  'migration_state',
  'is_migrated',
  'migrated',
  'ston_pool_address',
  'lp_status',
  'tx_count',
  'volume_24h_ton',
  'created_at',
].join(', ');

function addressVariants(address: Address) {
  return Array.from(new Set([
    address.toRawString(),
    address.toString(),
    address.toString({ testOnly: true }),
    address.toString({ bounceable: false }),
    address.toString({ bounceable: false, testOnly: true }),
  ]));
}

async function loadWalletBalance(client: TonClient, owner: Address, token: DbTokenRow) {
  const jettonMaster = token.jetton_address || token.master_address;
  if (!jettonMaster) return 0n;

  try {
    const walletAddressResult = await client.runMethod(
      Address.parse(jettonMaster),
      'get_wallet_address',
      [{ type: 'slice', cell: beginCell().storeAddress(owner).endCell() }],
    );
    const walletAddress = walletAddressResult.stack.readAddress();
    const walletData = await client.runMethod(walletAddress, 'get_wallet_data');
    return walletData.stack.readBigNumber();
  } catch {
    return 0n;
  }
}

function serializeTrade(trade: DbTradeRow) {
  return {
    id: trade.id || trade.tx_hash || `${trade.token_address}-${trade.created_at}`,
    tokenAddress: trade.token_address || '',
    type: trade.type === 'sell' ? 'sell' : 'buy',
    source: trade.source || 'bonding_curve',
    tonAmount: nanoToNumber(parseNano(trade.ton_amount)),
    tokenAmount: Number(parseNano(trade.token_amount)) / NANOS_PER_UNIT_NUMBER,
    feeTon: nanoToNumber(parseNano(trade.fee_ton)),
    trader: trade.trader_address || trade.user_address || '',
    timestamp: trade.block_time || trade.created_at || null,
    txHash: trade.tx_hash || null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawWallet = url.searchParams.get('wallet') || '';

  let wallet: Address;
  try {
    wallet = Address.parse(rawWallet);
  } catch {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const variants = addressVariants(wallet);
  const [{ data: createdRows, error: createdError }, { data: traderRows, error: traderError }, { data: userRows, error: userError }] = await Promise.all([
    supabase.from('tokens').select(TOKEN_SELECT).in('creator_address', variants).order('created_at', { ascending: false }).limit(50),
    supabase.from('trades').select('*').in('trader_address', variants).order('created_at', { ascending: false }).limit(100),
    supabase.from('trades').select('*').in('user_address', variants).order('created_at', { ascending: false }).limit(100),
  ]);

  if (createdError) return NextResponse.json({ error: createdError.message }, { status: 500 });
  if (traderError) return NextResponse.json({ error: traderError.message }, { status: 500 });
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });

  const tradeMap = new Map<string, DbTradeRow>();
  for (const trade of [...((traderRows || []) as DbTradeRow[]), ...((userRows || []) as DbTradeRow[])]) {
    const key = trade.id || trade.tx_hash || `${trade.token_address}-${trade.created_at}`;
    tradeMap.set(key, trade);
  }

  const trades = Array.from(tradeMap.values())
    .sort((a, b) => new Date(b.block_time || b.created_at || 0).getTime() - new Date(a.block_time || a.created_at || 0).getTime());
  const relatedAddresses = Array.from(new Set([
    ...((createdRows || []) as DbTokenRow[]).map((token) => token.address),
    ...trades.map((trade) => trade.token_address || ''),
  ].filter(Boolean)));

  const { data: relatedRows, error: relatedError } = relatedAddresses.length > 0
    ? await supabase.from('tokens').select(TOKEN_SELECT).in('address', relatedAddresses)
    : { data: [], error: null };

  if (relatedError) return NextResponse.json({ error: relatedError.message }, { status: 500 });

  const tokenRows = (relatedRows || []) as DbTokenRow[];
  const tokenByAddress = new Map(tokenRows.map((token) => [token.address, token]));
  const normalizedByAddress = new Map(tokenRows.map((token) => [token.address, normalizeTokenRow(token)]));
  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || process.env.NEXT_PUBLIC_TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY || undefined,
  });

  const holdings = await Promise.all(tokenRows.slice(0, 40).map(async (token) => {
    const balanceNano = await loadWalletBalance(client, wallet, token);
    const normalized = normalizedByAddress.get(token.address)!;
    return {
      token: normalized,
      balance: Number(balanceNano) / NANOS_PER_UNIT_NUMBER,
      balanceNano: balanceNano.toString(),
      valueTon: Number(balanceNano) / NANOS_PER_UNIT_NUMBER * normalized.priceTon,
    };
  }));

  const nonZeroHoldings = holdings
    .filter((holding) => holding.balance > 0)
    .sort((a, b) => b.valueTon - a.valueTon);
  const buyVolumeTon = trades
    .filter((trade) => trade.type !== 'sell')
    .reduce((sum, trade) => sum + nanoToNumber(parseNano(trade.ton_amount)), 0);
  const sellVolumeTon = trades
    .filter((trade) => trade.type === 'sell')
    .reduce((sum, trade) => sum + nanoToNumber(parseNano(trade.ton_amount)), 0);
  const tradedTokenAddresses = new Set(trades.map((trade) => trade.token_address).filter(Boolean));
  const createdTokens = ((createdRows || []) as DbTokenRow[]).map((token) => normalizedByAddress.get(token.address) || normalizeTokenRow(token));

  return NextResponse.json({
    wallet: wallet.toString({ testOnly: true }),
    summary: {
      createdCount: createdTokens.length,
      tradedCount: tradedTokenAddresses.size,
      tradeCount: trades.length,
      buyVolumeTon,
      sellVolumeTon,
      netFlowTon: sellVolumeTon - buyVolumeTon,
      holdingsCount: nonZeroHoldings.length,
      holdingsValueTon: nonZeroHoldings.reduce((sum, holding) => sum + holding.valueTon, 0),
    },
    createdTokens,
    tradedTokens: Array.from(tradedTokenAddresses)
      .map((address) => normalizedByAddress.get(address || ''))
      .filter(Boolean),
    holdings: nonZeroHoldings,
    recentTrades: trades.slice(0, 20).map((trade) => ({
      ...serializeTrade(trade),
      token: trade.token_address ? normalizedByAddress.get(trade.token_address) || (tokenByAddress.has(trade.token_address) ? normalizeTokenRow(tokenByAddress.get(trade.token_address)!) : null) : null,
    })),
  });
}
