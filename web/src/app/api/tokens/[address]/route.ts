import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  type DbCandleRow,
  type DbTokenRow,
  type DbTradeRow,
  NANOS_PER_UNIT_NUMBER,
  nanoToNumber,
  normalizeTokenRow,
  parseNano,
} from '@/lib/launchpad';
import { START_MARKET_CAP_TON } from '@/lib/bondingCurve';

type PeriodKey = 'hour' | 'day' | 'week' | 'month' | 'ytd' | 'all';

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

const PERIODS: Record<PeriodKey, { timeframe: '1m' | '5m' | '1h' | '1d'; limit: number; label: string }> = {
  hour: { timeframe: '1m', limit: 60, label: '1H' },
  day: { timeframe: '5m', limit: 288, label: '1D' },
  week: { timeframe: '1h', limit: 168, label: '1W' },
  month: { timeframe: '1h', limit: 720, label: '1M' },
  ytd: { timeframe: '1d', limit: 366, label: 'YTD' },
  all: { timeframe: '1d', limit: 1000, label: 'ALL' },
};

function candleValue(candle: DbCandleRow) {
  return nanoToNumber(parseNano(candle.close_market_cap_ton));
}

function addLaunchBaseline(
  chart: { data: number[]; labels: string[] },
  tokenMarketCapTon: number,
  createdAt: string | null | undefined,
) {
  const baselineValue = nanoToNumber(START_MARKET_CAP_TON);
  const firstLabel = chart.labels[0] || new Date().toISOString();
  const createdTime = createdAt ? new Date(createdAt).getTime() : NaN;
  const firstTime = new Date(firstLabel).getTime();
  const baselineTime = Number.isFinite(createdTime)
    ? createdTime
    : Number.isFinite(firstTime)
    ? Math.max(0, firstTime - 60_000)
    : Date.now() - 60_000;
  const baselineLabel = new Date(baselineTime).toISOString();

  if (chart.data.length === 0) {
    return {
      data: [baselineValue, tokenMarketCapTon],
      labels: [baselineLabel, new Date().toISOString()],
    };
  }

  if (chart.data.length === 1) {
    const onlyValue = chart.data[0];
    if (Math.abs(onlyValue - baselineValue) < 0.000000001) {
      return {
        data: [onlyValue, tokenMarketCapTon],
        labels: [chart.labels[0] || baselineLabel, new Date().toISOString()],
      };
    }
    return {
      data: [baselineValue, onlyValue],
      labels: [baselineLabel, chart.labels[0] || new Date().toISOString()],
    };
  }

  const firstValue = chart.data[0];
  if (Math.abs(firstValue - baselineValue) < 0.000000001) return chart;
  return {
    data: [baselineValue, ...chart.data],
    labels: [baselineLabel, ...chart.labels],
  };
}

function fallbackChart(tokenMarketCapTon: number, createdAt?: string | null) {
  const now = Date.now();
  const previous = now - 60_000;
  return addLaunchBaseline({
    data: [tokenMarketCapTon, tokenMarketCapTon],
    labels: [new Date(previous).toISOString(), new Date(now).toISOString()],
  }, tokenMarketCapTon, createdAt);
}

function tradeFallbackChart(tokenMarketCapTon: number, trades: DbTradeRow[], createdAt?: string | null) {
  const points = [...trades]
    .reverse()
    .map((trade) => ({
      value: nanoToNumber(parseNano(trade.market_cap_ton_after)),
      label: trade.block_time || trade.created_at || trade.timestamp || null,
    }))
    .filter((point) => point.value > 0 && point.label);

  if (points.length === 0) return fallbackChart(tokenMarketCapTon, createdAt);

  return addLaunchBaseline({
    data: points.map((point) => point.value),
    labels: points.map((point) => point.label as string),
  }, tokenMarketCapTon, createdAt);
}

async function loadChart(tokenAddress: string, tokenMarketCapTon: number, trades: DbTradeRow[], createdAt?: string | null) {
  const result: Partial<Record<PeriodKey, { data: number[]; labels: string[]; label: string }>> = {};

  for (const [period, config] of Object.entries(PERIODS) as Array<[PeriodKey, typeof PERIODS[PeriodKey]]>) {
    const { data, error } = await supabase
      .from('token_candles')
      .select('*')
      .eq('token_address', tokenAddress)
      .eq('timeframe', config.timeframe)
      .order('bucket_start', { ascending: false })
      .limit(config.limit);

    if (error || !data || data.length === 0) {
      result[period] = { ...tradeFallbackChart(tokenMarketCapTon, trades, createdAt), label: config.label };
      continue;
    }

    const candles = [...(data as DbCandleRow[])].reverse();
    result[period] = {
      ...addLaunchBaseline({
      data: candles.map(candleValue),
      labels: candles.map((candle) => candle.bucket_start),
      }, tokenMarketCapTon, createdAt),
      label: config.label,
    };
  }

  return result as Record<PeriodKey, { data: number[]; labels: string[]; label: string }>;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await context.params;
  const address = decodeURIComponent(rawAddress);

  const { data: tokenRow, error: tokenError } = await supabase
    .from('tokens')
    .select(TOKEN_SELECT)
    .eq('address', address)
    .maybeSingle();

  if (tokenError) return NextResponse.json({ error: tokenError.message }, { status: 500 });
  if (!tokenRow) return NextResponse.json({ error: 'Token not found' }, { status: 404 });

  const [{ data: tradesData, error: tradesError }, { data: trendingTokensData, error: trendingError }] = await Promise.all([
    supabase
      .from('trades')
      .select('id, token_address, trader_address, user_address, type, source, ton_amount, token_amount, fee_ton, fee_token_amount, market_cap_ton_after, price_ton_after, created_at, block_time, tx_hash')
      .eq('token_address', address)
      .order('created_at', { ascending: false })
      .limit(120),
    supabase
      .from('tokens')
      .select(TOKEN_SELECT)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  if (tradesError) return NextResponse.json({ error: tradesError.message }, { status: 500 });
  if (trendingError) return NextResponse.json({ error: trendingError.message }, { status: 500 });

  const trades = (tradesData || []) as DbTradeRow[];
  const typedTokenRow = tokenRow as unknown as DbTokenRow;
  const token = normalizeTokenRow(typedTokenRow, trades);
  const chart = await loadChart(address, token.marketCapTon, trades, typedTokenRow.created_at);
  const trending = ((trendingTokensData || []) as unknown as DbTokenRow[])
    .filter((item) => item.address !== address)
    .slice(0, 5)
    .map((item) => normalizeTokenRow(item));

  return NextResponse.json({
    token,
    chart,
    trades: trades.map((trade) => ({
      id: trade.id || trade.tx_hash || `${trade.token_address}-${trade.created_at}`,
      type: String(trade.type || '').toLowerCase() === 'sell' ? 'sell' : 'buy',
      source: trade.source || 'bonding_curve',
      tonAmount: nanoToNumber(parseNano(trade.ton_amount)),
      tokenAmount: Number(parseNano(trade.token_amount)) / NANOS_PER_UNIT_NUMBER,
      feeTon: nanoToNumber(parseNano(trade.fee_ton)),
      feeTokenAmount: Number(parseNano(trade.fee_token_amount)) / NANOS_PER_UNIT_NUMBER,
      marketCapTonAfter: nanoToNumber(parseNano(trade.market_cap_ton_after)),
      priceTonAfter: nanoToNumber(parseNano(trade.price_ton_after)),
      trader: trade.trader_address || trade.user_address || '',
      timestamp: trade.block_time || trade.created_at || null,
      txHash: trade.tx_hash || null,
    })),
    trending,
  });
}
