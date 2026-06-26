import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function clean(value: string | undefined) {
  return (value || '').replace(/[\r\n\t]/g, '').trim();
}

export async function GET() {
  const factoryAddress = clean(process.env.NEXT_PUBLIC_FACTORY_ADDRESS);
  const migrationMarketCapNano = clean(
    process.env.NEXT_PUBLIC_MIGRATION_MARKET_CAP_NANO ||
    process.env.NEXT_PUBLIC_TESTNET_MIGRATION_MARKET_CAP_NANO ||
    '100000000000',
  );

  if (!factoryAddress) {
    return NextResponse.json({ error: 'Factory address is not configured' }, { status: 500 });
  }

  return NextResponse.json(
    {
      factoryAddress,
      migrationMarketCapNano,
      network: process.env.NEXT_PUBLIC_TON_NETWORK || 'mainnet',
      version: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  );
}
