import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ACTIVE_FACTORY_ADDRESS } from '@/lib/launchpad';

type TradeRow = {
  type: 'buy' | 'sell' | string | null;
  ton_amount: string | null;
};

const NANOS_PER_TON = 1_000_000_000n;
const TRADE_PAGE_SIZE = 1000;
const FALLBACK_TON_USD = 2.454;

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
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT', {
      cache: 'no-store',
    });

    if (!response.ok) {
      return FALLBACK_TON_USD;
    }

    const data = await response.json() as { price?: string };
    const price = Number(data.price);
    return Number.isFinite(price) && price > 0 ? price : FALLBACK_TON_USD;
  } catch {
    return FALLBACK_TON_USD;
  }
}

export async function GET() {
  let tokenQuery = supabase.from('tokens').select('address', { count: 'exact' }).limit(10000);
  if (ACTIVE_FACTORY_ADDRESS) tokenQuery = tokenQuery.eq('factory_address', ACTIVE_FACTORY_ADDRESS);

  const [{ data: tokenRows, count, error: tokenError }, tonUsdPrice] = await Promise.all([
    tokenQuery,
    getTonUsdPrice(),
  ]);

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }

  let buyVolumeNano = 0n;
  let sellVolumeNano = 0n;
  let offset = 0;
  const tokenAddresses = (tokenRows || []).map((token) => token.address).filter(Boolean);

  if (tokenAddresses.length === 0) {
    return NextResponse.json({
      tonUsdPrice,
      tokensLaunched: count ?? 0,
      buyVolumeTon: '0',
      sellVolumeTon: '0',
      totalVolumeTon: '0',
      totalVolumeUsd: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  while (true) {
    const { data, error } = await supabase
      .from('trades')
      .select('type, ton_amount')
      .in('token_address', tokenAddresses)
      .range(offset, offset + TRADE_PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const trades = (data || []) as TradeRow[];

    for (const trade of trades) {
      const amount = parseNanoTon(trade.ton_amount);
      const tradeType = String(trade.type || '').toLowerCase();
      if (tradeType === 'buy') buyVolumeNano += amount;
      if (tradeType === 'sell') sellVolumeNano += amount;
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
