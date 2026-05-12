import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const sanitize = (value: string | undefined) => (value || '').replace(/[\r\n\t]/g, '').trim();

const supabaseUrl = sanitize(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = sanitize(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

type TradeRow = {
  type: 'buy' | 'sell' | string | null;
  ton_amount: string | null;
};

const NANOS_PER_TON = 1_000_000_000n;
const TRADE_PAGE_SIZE = 1000;

function parseNanoTon(value: string | null): bigint {
  if (!value) return 0n;

  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function formatTon(nanotons: bigint): string {
  const sign = nanotons < 0n ? '-' : '';
  const absolute = nanotons < 0n ? -nanotons : nanotons;
  const whole = absolute / NANOS_PER_TON;
  const fraction = absolute % NANOS_PER_TON;
  const fractionText = fraction.toString().padStart(9, '0').replace(/0+$/, '');

  return `${sign}${whole}${fractionText ? `.${fractionText}` : ''}`;
}

async function getTonUsdPrice() {
  const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Binance price request failed: ${response.status}`);
  }

  const data = await response.json() as { price?: string };
  const price = Number(data.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Binance returned an invalid TON price');
  }

  return price;
}

export async function GET() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: 'Supabase environment variables are not configured' },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const [{ count, error: tokenError }, tonUsdPrice] = await Promise.all([
    supabase.from('tokens').select('id', { count: 'exact', head: true }),
    getTonUsdPrice(),
  ]);

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }

  let buyVolumeNano = 0n;
  let sellVolumeNano = 0n;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('trades')
      .select('type, ton_amount')
      .range(offset, offset + TRADE_PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const trades = (data || []) as TradeRow[];

    for (const trade of trades) {
      const amount = parseNanoTon(trade.ton_amount);
      if (trade.type === 'buy') buyVolumeNano += amount;
      if (trade.type === 'sell') sellVolumeNano += amount;
    }

    if (trades.length < TRADE_PAGE_SIZE) break;
    offset += TRADE_PAGE_SIZE;
  }

  const totalVolumeNano = buyVolumeNano + sellVolumeNano;

  return NextResponse.json({
    tonUsdPrice,
    tokensLaunched: count ?? 0,
    buyVolumeTon: formatTon(buyVolumeNano),
    sellVolumeTon: formatTon(sellVolumeNano),
    totalVolumeTon: formatTon(totalVolumeNano),
    totalVolumeUsd: Number(formatTon(totalVolumeNano)) * tonUsdPrice,
    updatedAt: new Date().toISOString(),
  });
}
