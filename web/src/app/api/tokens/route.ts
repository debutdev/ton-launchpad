import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { type DbTokenRow, type DbTradeRow, nanoToNumber, normalizeTokenRow, parseNano } from '@/lib/launchpad';

type SortKey = 'marketCap' | 'price' | 'name' | 'time';
type SortDirection = 'asc' | 'desc';

const PAGE_SIZE = 16;
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

function normalizeSort(value: string | null): SortKey {
  if (value === 'marketCap' || value === 'price' || value === 'name' || value === 'time') return value;
  return 'time';
}

function normalizeDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

function shortSortValue(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function tokenSearchScore(
  token: ReturnType<typeof normalizeTokenRow>,
  query: string,
) {
  if (!query) return 0;

  const address = shortSortValue(token.address);
  const name = shortSortValue(token.name);
  const ticker = shortSortValue(token.ticker);
  const creator = shortSortValue(token.creatorAddress);

  if (address === query || ticker === query || name === query) return 100;
  if (ticker.startsWith(query)) return 80;
  if (name.startsWith(query)) return 60;
  if (address.startsWith(query)) return 50;
  if (ticker.includes(query)) return 40;
  if (name.includes(query)) return 30;
  if (address.includes(query)) return 20;
  if (creator.includes(query)) return 10;
  return -1;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const sort = normalizeSort(url.searchParams.get('sort'));
  const direction = normalizeDirection(url.searchParams.get('direction'));
  const query = shortSortValue(url.searchParams.get('q'));

  const { data: tokenRows, error: tokenError } = await supabase
    .from('tokens')
    .select(TOKEN_SELECT)
    .order('created_at', { ascending: false });

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }

  const tokens = ((tokenRows || []) as unknown as DbTokenRow[])
    .map((token) => normalizeTokenRow(token))
    .map((token) => ({ token, searchScore: tokenSearchScore(token, query) }))
    .filter((entry) => !query || entry.searchScore >= 0);

  tokens.sort((a, b) => {
    if (query && a.searchScore !== b.searchScore) return b.searchScore - a.searchScore;

    const left = a.token;
    const right = b.token;
    let result = 0;
    if (sort === 'marketCap') result = left.marketCapTon - right.marketCapTon;
    if (sort === 'price') result = left.priceTon - right.priceTon;
    if (sort === 'name') result = shortSortValue(left.name).localeCompare(shortSortValue(right.name));
    if (sort === 'time') result = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    return direction === 'asc' ? result : -result;
  });

  const total = tokens.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = tokens.slice(start, start + PAGE_SIZE).map((entry) => entry.token);
  const tokenAddresses = pageItems.map((token) => token.address);
  const tradeStats = new Map<string, { volumeNano: bigint; holders: Set<string> }>();

  if (tokenAddresses.length > 0) {
    const { data: trades, error: tradeError } = await supabase
      .from('trades')
      .select('token_address, ton_amount, trader_address, user_address')
      .in('token_address', tokenAddresses);

    if (tradeError) {
      return NextResponse.json({ error: tradeError.message }, { status: 500 });
    }

    for (const trade of (trades || []) as DbTradeRow[]) {
      if (!trade.token_address) continue;
      const current = tradeStats.get(trade.token_address) ?? { volumeNano: 0n, holders: new Set<string>() };
      current.volumeNano += parseNano(trade.ton_amount);
      const holder = trade.trader_address || trade.user_address;
      if (holder) current.holders.add(holder);
      tradeStats.set(trade.token_address, current);
    }
  }

  const items = pageItems.map((token) => {
    const stats = tradeStats.get(token.address);
    return {
      ...token,
      holders: stats?.holders.size ?? token.holders,
      volumeTon: stats ? nanoToNumber(stats.volumeNano) : token.volumeTon,
    };
  });

  return NextResponse.json({
    items,
    page,
    pageSize: PAGE_SIZE,
    total,
    hasNext: start + PAGE_SIZE < total,
    hasPrevious: page > 1,
  });
}
