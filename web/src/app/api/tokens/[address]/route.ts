import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  type DbCandleRow,
  type DbTokenRow,
  type DbTradeRow,
  NANOS_PER_UNIT_NUMBER,
  defaultMigrationMarketCapNano,
  ACTIVE_FACTORY_ADDRESS,
  nanoToNumber,
  normalizeTokenRow,
  parseNano,
} from '@/lib/launchpad';
import { START_MARKET_CAP_TON } from '@/lib/bondingCurve';

type PeriodKey = 'hour' | 'day' | 'week' | 'month' | 'ytd' | 'all';
type ChartPoints = { data: number[]; labels: string[] };

const TOKEN_SELECT = [
  'id',
  'factory_address',
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

const PERIOD_WINDOWS_MS: Partial<Record<PeriodKey, number>> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

function candleValue(candle: DbCandleRow) {
  return nanoToNumber(parseNano(candle.close_market_cap_ton));
}

function isMigratedToken(row: DbTokenRow) {
  return Number(row.migration_state ?? (row.migrated || row.is_migrated ? 2 : 0)) >= 2;
}

function normalizedTradeMarketCapNano(
  row: DbTokenRow,
  trade: DbTradeRow,
  dexAnchorRaw: bigint | null,
) {
  const rawMarketCap = parseNano(trade.market_cap_ton_after);
  if (rawMarketCap <= 0n) return { value: 0n, dexAnchorRaw };
  if (!isMigratedToken(row)) return { value: rawMarketCap, dexAnchorRaw };

  const migrationCap = parseNano(row.migration_market_cap_ton) || defaultMigrationMarketCapNano();
  if (trade.source === 'dedust') {
    const nextAnchor = dexAnchorRaw && dexAnchorRaw > 0n ? dexAnchorRaw : rawMarketCap;
    return {
      value: nextAnchor > 0n ? (migrationCap * rawMarketCap) / nextAnchor : migrationCap,
      dexAnchorRaw: nextAnchor,
    };
  }

  return { value: rawMarketCap > migrationCap ? migrationCap : rawMarketCap, dexAnchorRaw };
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

function compareTxLt(a: DbTradeRow, b: DbTradeRow) {
  try {
    const aLt = BigInt(a.tx_lt || 0);
    const bLt = BigInt(b.tx_lt || 0);
    if (aLt < bLt) return -1;
    if (aLt > bLt) return 1;
  } catch {
    // Fall through to timestamp-based ordering.
  }
  return 0;
}

function tradeTime(trade: DbTradeRow) {
  return trade.block_time || trade.created_at || trade.timestamp || null;
}

function tradeTimeMs(trade: DbTradeRow) {
  const value = tradeTime(trade);
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function sortTradesByChainTime(trades: DbTradeRow[], direction: 'asc' | 'desc' = 'asc') {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort((a, b) => {
      const byTime = tradeTimeMs(a.trade) - tradeTimeMs(b.trade);
      if (byTime !== 0) return direction === 'asc' ? byTime : -byTime;
      const byLt = compareTxLt(a.trade, b.trade);
      if (byLt !== 0) return direction === 'asc' ? byLt : -byLt;
      const byCreatedAt = new Date(a.trade.created_at || 0).getTime() - new Date(b.trade.created_at || 0).getTime();
      if (byCreatedAt !== 0) return direction === 'asc' ? byCreatedAt : -byCreatedAt;
      return direction === 'asc' ? a.index - b.index : b.index - a.index;
    })
    .map(({ trade }) => trade);
}

function cutoffForPeriod(period: PeriodKey) {
  if (period === 'all') return null;
  if (period === 'ytd') return new Date(new Date().getFullYear(), 0, 1).getTime();
  const windowMs = PERIOD_WINDOWS_MS[period];
  return windowMs ? Date.now() - windowMs : null;
}

function filterChartForPeriod(chart: ChartPoints, period: PeriodKey): ChartPoints {
  const cutoff = cutoffForPeriod(period);
  if (!cutoff) return chart;

  const points = chart.labels.map((label, index) => ({
    label,
    value: chart.data[index],
    time: new Date(label).getTime(),
  })).filter((point) => Number.isFinite(point.value));

  const visible = points.filter((point) => Number.isFinite(point.time) && point.time >= cutoff);
  const previous = [...points].reverse().find((point) => Number.isFinite(point.time) && point.time < cutoff);
  const filtered = previous ? [previous, ...visible] : visible;
  const fallback = filtered.length >= 2 ? filtered : points.slice(-2);

  return {
    data: fallback.map((point) => point.value),
    labels: fallback.map((point) => point.label),
  };
}

function tradeFallbackChart(tokenRow: DbTokenRow, tokenMarketCapTon: number, trades: DbTradeRow[], createdAt?: string | null) {
  let dexAnchorRaw: bigint | null = null;
  const points = sortTradesByChainTime(trades, 'asc')
    .map((trade) => {
      const normalized = normalizedTradeMarketCapNano(tokenRow, trade, dexAnchorRaw);
      dexAnchorRaw = normalized.dexAnchorRaw;
      return {
        value: nanoToNumber(normalized.value),
        label: tradeTime(trade),
      };
    })
    .filter((point) => point.value > 0 && point.label);

  if (points.length === 0) return fallbackChart(tokenMarketCapTon, createdAt);

  return addLaunchBaseline({
    data: points.map((point) => point.value),
    labels: points.map((point) => point.label as string),
  }, tokenMarketCapTon, createdAt);
}

async function loadChart(tokenRow: DbTokenRow, tokenMarketCapTon: number, trades: DbTradeRow[], createdAt?: string | null) {
  const result: Partial<Record<PeriodKey, { data: number[]; labels: string[]; label: string }>> = {};
  const tradeChart = tradeFallbackChart(tokenRow, tokenMarketCapTon, trades, createdAt);
  const migrated = isMigratedToken(tokenRow);

  for (const [period, config] of Object.entries(PERIODS) as Array<[PeriodKey, typeof PERIODS[PeriodKey]]>) {
    if (migrated) {
      result[period] = { ...filterChartForPeriod(tradeChart, period), label: config.label };
      continue;
    }

    const { data, error } = await supabase
      .from('token_candles')
      .select('*')
      .eq('token_address', tokenRow.address)
      .eq('timeframe', config.timeframe)
      .order('bucket_start', { ascending: false })
      .limit(config.limit);

    if (error || !data || data.length === 0) {
      result[period] = { ...filterChartForPeriod(tradeChart, period), label: config.label };
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

  let tokenQuery = supabase
    .from('tokens')
    .select(TOKEN_SELECT)
    .eq('address', address);
  if (ACTIVE_FACTORY_ADDRESS) tokenQuery = tokenQuery.eq('factory_address', ACTIVE_FACTORY_ADDRESS);
  const { data: tokenRow, error: tokenError } = await tokenQuery.maybeSingle();

  if (tokenError) return NextResponse.json({ error: tokenError.message }, { status: 500 });
  if (!tokenRow) return NextResponse.json({ error: 'Token not found' }, { status: 404 });

  const [{ data: tradesData, error: tradesError }, { data: trendingTokensData, error: trendingError }] = await Promise.all([
    supabase
      .from('trades')
      .select('id, token_address, trader_address, user_address, type, source, ton_amount, token_amount, fee_ton, fee_token_amount, market_cap_ton_after, price_ton_after, created_at, block_time, tx_hash, tx_lt')
      .eq('token_address', address)
      .order('created_at', { ascending: false })
      .limit(120),
    (() => {
      let query = supabase
      .from('tokens')
      .select(TOKEN_SELECT)
      .order('created_at', { ascending: false })
      .limit(8);
      if (ACTIVE_FACTORY_ADDRESS) query = query.eq('factory_address', ACTIVE_FACTORY_ADDRESS);
      return query;
    })(),
  ]);

  if (tradesError) return NextResponse.json({ error: tradesError.message }, { status: 500 });
  if (trendingError) return NextResponse.json({ error: trendingError.message }, { status: 500 });

  const trades = sortTradesByChainTime((tradesData || []) as DbTradeRow[], 'desc');
  const typedTokenRow = tokenRow as unknown as DbTokenRow;
  const token = normalizeTokenRow(typedTokenRow, trades);
  const chart = await loadChart(typedTokenRow, token.marketCapTon, trades, typedTokenRow.created_at);
  const currentMarketCap = chart.hour.data.at(-1);
  if (isMigratedToken(typedTokenRow) && currentMarketCap && Number.isFinite(currentMarketCap)) {
    token.marketCapTon = currentMarketCap;
    token.priceTon = currentMarketCap / 1_000_000_000;
  }
  const trending = ((trendingTokensData || []) as unknown as DbTokenRow[])
    .filter((item) => item.address !== address)
    .slice(0, 5)
    .map((item) => normalizeTokenRow(item));
  let responseDexAnchorRaw: bigint | null = null;
  const normalizedTradeMarketCaps = new Map<string, number>();
  for (const trade of sortTradesByChainTime(trades, 'asc')) {
    const normalized = normalizedTradeMarketCapNano(typedTokenRow, trade, responseDexAnchorRaw);
    responseDexAnchorRaw = normalized.dexAnchorRaw;
    if (trade.id) normalizedTradeMarketCaps.set(trade.id, nanoToNumber(normalized.value));
  }

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
      marketCapTonAfter: trade.id
        ? normalizedTradeMarketCaps.get(trade.id) ?? nanoToNumber(parseNano(trade.market_cap_ton_after))
        : nanoToNumber(parseNano(trade.market_cap_ton_after)),
      priceTonAfter: nanoToNumber(parseNano(trade.price_ton_after)),
      trader: trade.trader_address || trade.user_address || '',
      timestamp: trade.block_time || trade.created_at || null,
      txHash: trade.tx_hash || null,
    })),
    trending,
  });
}
