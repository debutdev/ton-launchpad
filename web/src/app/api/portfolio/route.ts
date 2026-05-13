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

const TONAPI_ENDPOINT = process.env.TONAPI_ENDPOINT || 'https://testnet.tonapi.io';
const FALLBACK_TON_USD = 2.454;

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

type ExternalHolding = {
  token: {
    address: string;
    name: string;
    ticker: string;
    imageUrl: string | null;
    priceUsd: number;
    decimals: number;
    isNative: boolean;
  };
  balance: number;
  balanceNano: string;
  valueUsd: number;
};

type TonapiJettonBalance = {
  balance?: string | number;
  jetton?: {
    address?: string;
    name?: string;
    symbol?: string;
    image?: string | null;
    decimals?: string | number;
    price?: {
      prices?: Record<string, string | number | undefined>;
      usd?: string | number;
    };
  };
  jetton_address?: string;
  price?: {
    prices?: Record<string, string | number | undefined>;
    usd?: string | number;
  };
  price_usd?: string | number;
};

function addressVariants(address: Address) {
  return Array.from(new Set([
    address.toRawString(),
    address.toString(),
    address.toString({ testOnly: true }),
    address.toString({ bounceable: false }),
    address.toString({ bounceable: false, testOnly: true }),
  ]));
}

function rawAddressKey(value: string | null | undefined) {
  if (!value) return '';
  try {
    return Address.parse(value).toRawString();
  } catch {
    return value;
  }
}

async function loadWalletBalance(client: TonClient, owner: Address, token: DbTokenRow) {
  const jettonMaster = token.jetton_address || token.master_address;
  if (!jettonMaster) return 0n;

  try {
    const account = encodeURIComponent(owner.toString({ testOnly: true }));
    const master = encodeURIComponent(Address.parse(jettonMaster).toString({ testOnly: true }));
    const response = await fetch(`${TONAPI_ENDPOINT}/v2/accounts/${account}/jettons/${master}`, {
      cache: 'no-store',
      headers: tonapiHeaders(),
    });
    if (response.status === 404) return 0n;
    if (response.ok) {
      const data = await response.json() as { balance?: string | number };
      return BigInt(data.balance || 0);
    }
  } catch {
    // Fall back to get-method reads below.
  }

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

async function fetchTonUsd() {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT', {
      next: { revalidate: 30 },
    });
    if (!response.ok) throw new Error('TON price unavailable');
    const data = await response.json() as { price?: string };
    const price = Number(data.price);
    return Number.isFinite(price) && price > 0 ? price : FALLBACK_TON_USD;
  } catch {
    return FALLBACK_TON_USD;
  }
}

function tonapiHeaders() {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.TONAPI_KEY) headers.authorization = `Bearer ${process.env.TONAPI_KEY}`;
  return headers;
}

async function fetchNativeTonHolding(wallet: Address, tonUsd: number): Promise<ExternalHolding> {
  try {
    const account = wallet.toString({ testOnly: true });
    const response = await fetch(`${TONAPI_ENDPOINT}/v2/accounts/${encodeURIComponent(account)}`, {
      cache: 'no-store',
      headers: tonapiHeaders(),
    });
    if (!response.ok) throw new Error('Unable to load TON balance');
    const data = await response.json() as { balance?: string | number };
    const balanceNano = BigInt(data.balance || 0).toString();
    const balance = Number(balanceNano) / NANOS_PER_UNIT_NUMBER;
    return {
      token: {
        address: 'TON',
        name: 'Toncoin',
        ticker: 'TON',
        imageUrl: null,
        priceUsd: tonUsd,
        decimals: 9,
        isNative: true,
      },
      balance,
      balanceNano,
      valueUsd: balance * tonUsd,
    };
  } catch {
    return {
      token: {
        address: 'TON',
        name: 'Toncoin',
        ticker: 'TON',
        imageUrl: null,
        priceUsd: tonUsd,
        decimals: 9,
        isNative: true,
      },
      balance: 0,
      balanceNano: '0',
      valueUsd: 0,
    };
  }
}

function readTonapiUsdPrice(item: TonapiJettonBalance): number {
  const candidates = [
    item?.price?.prices?.USD,
    item?.price?.prices?.usd,
    item?.price?.usd,
    item?.price_usd,
    item?.jetton?.price?.prices?.USD,
    item?.jetton?.price?.prices?.usd,
    item?.jetton?.price?.usd,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

async function fetchExternalJettonHoldings(wallet: Address): Promise<ExternalHolding[]> {
  try {
    const account = wallet.toString({ testOnly: true });
    const response = await fetch(`${TONAPI_ENDPOINT}/v2/accounts/${encodeURIComponent(account)}/jettons?currencies=usd`, {
      cache: 'no-store',
      headers: tonapiHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json() as { balances?: TonapiJettonBalance[] };
    return (data.balances || []).map((item) => {
      const jetton = item.jetton || {};
      const decimals = Number(jetton.decimals ?? 9) || 9;
      const balanceNano = BigInt(item.balance || 0).toString();
      const balance = Number(balanceNano) / (10 ** decimals);
      const priceUsd = readTonapiUsdPrice(item);
      return {
        token: {
          address: jetton.address || item.jetton_address || '',
          name: jetton.name || 'Jetton',
          ticker: jetton.symbol || 'JETTON',
          imageUrl: jetton.image || null,
          priceUsd,
          decimals,
          isNative: false,
        },
        balance,
        balanceNano,
        valueUsd: balance * priceUsd,
      };
    }).filter((holding) => holding.balance > 0 && holding.token.address);
  } catch {
    return [];
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
  const tonUsd = await fetchTonUsd();
  const [nativeTonHolding, externalJettons] = await Promise.all([
    fetchNativeTonHolding(wallet, tonUsd),
    fetchExternalJettonHoldings(wallet),
  ]);

  const holdings = await Promise.all(tokenRows.slice(0, 40).map(async (token) => {
    const balanceNano = await loadWalletBalance(client, wallet, token);
    const normalized = normalizedByAddress.get(token.address)!;
    return {
      token: normalized,
      balance: Number(balanceNano) / NANOS_PER_UNIT_NUMBER,
      balanceNano: balanceNano.toString(),
      valueTon: Number(balanceNano) / NANOS_PER_UNIT_NUMBER * normalized.priceTon,
      valueUsd: Number(balanceNano) / NANOS_PER_UNIT_NUMBER * normalized.priceTon * tonUsd,
    };
  }));

  const tonkedJettonMasters = new Set(tokenRows.map((token) => rawAddressKey(token.jetton_address || token.master_address)).filter(Boolean));
  const nonZeroTonkedHoldings = holdings
    .filter((holding) => holding.balance > 0)
    .sort((a, b) => b.valueTon - a.valueTon);
  const nonTonkedJettons = externalJettons.filter((holding) => !tonkedJettonMasters.has(rawAddressKey(holding.token.address)));
  const walletHoldings = [
    nativeTonHolding,
    ...nonZeroTonkedHoldings.map((holding) => ({
      token: {
        address: holding.token.jettonAddress || holding.token.address,
        name: holding.token.name,
        ticker: holding.token.ticker,
        imageUrl: holding.token.imageUrl,
        priceUsd: holding.token.priceTon * tonUsd,
        decimals: 9,
        isNative: false,
      },
      balance: holding.balance,
      balanceNano: holding.balanceNano,
      valueUsd: holding.valueUsd,
      launchpadToken: holding.token,
    })),
    ...nonTonkedJettons,
  ].filter((holding) => holding.balance > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd);
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
    tonUsd,
    summary: {
      createdCount: createdTokens.length,
      tradedCount: tradedTokenAddresses.size,
      tradeCount: trades.length,
      buyVolumeTon,
      sellVolumeTon,
      netFlowTon: sellVolumeTon - buyVolumeTon,
      holdingsCount: walletHoldings.length,
      holdingsValueTon: nonZeroTonkedHoldings.reduce((sum, holding) => sum + holding.valueTon, 0) + (nativeTonHolding.valueUsd / tonUsd),
      holdingsValueUsd: walletHoldings.reduce((sum, holding) => sum + holding.valueUsd, 0),
      nativeTonBalance: nativeTonHolding.balance,
      nativeTonValueUsd: nativeTonHolding.valueUsd,
    },
    createdTokens,
    tradedTokens: Array.from(tradedTokenAddresses)
      .map((address) => normalizedByAddress.get(address || ''))
      .filter(Boolean),
    holdings: nonZeroTonkedHoldings,
    walletHoldings,
    recentTrades: trades.slice(0, 20).map((trade) => ({
      ...serializeTrade(trade),
      token: trade.token_address ? normalizedByAddress.get(trade.token_address) || (tokenByAddress.has(trade.token_address) ? normalizeTokenRow(tokenByAddress.get(trade.token_address)!) : null) : null,
    })),
  });
}
