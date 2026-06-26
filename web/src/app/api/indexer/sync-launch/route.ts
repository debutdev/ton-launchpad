import { NextRequest, NextResponse } from 'next/server';
import { Address, Cell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { createClient } from '@supabase/supabase-js';
import {
  INITIAL_VIRTUAL_TOKENS,
  INITIAL_VIRTUAL_TON,
  REAL_TOKEN_SUPPLY,
  TON_USD_PRICE_DEN,
  TON_USD_PRICE_NUM,
  getMarketCap,
  getPriceInNanotons,
} from '@/lib/bondingCurve';
import { ACTIVE_FACTORY_ADDRESS } from '@/lib/launchpad';
import { DEFAULT_TONCENTER_ENDPOINT, formatTonAddress } from '@/lib/tonNetwork';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OP_TOKEN_DEPLOYED = 0x20002;

type TokenMetadata = {
  metadata_url?: string;
  name?: string;
  symbol?: string;
  description?: string | null;
  image_url?: string | null;
  twitter_url?: string | null;
  telegram_url?: string | null;
  website_url?: string | null;
};

function clean(value: string | undefined) {
  const sanitized = (value || '').replace(/[\r\n\t]/g, '').trim();
  return sanitized.replace(/^(['"])(.*)\1$/, '$2').trim();
}

function ipfsToGateway(url: string) {
  return url.startsWith('ipfs://') ? `https://gateway.pinata.cloud/ipfs/${url.slice('ipfs://'.length)}` : url;
}

function contentUrlFromCell(content: Cell) {
  try {
    const slice = content.beginParse();
    const tag = slice.loadUint(8);
    if (tag !== 1) return '';
    return slice.loadStringTail();
  } catch {
    return '';
  }
}

function parseTokenDeployed(body: Cell) {
  try {
    const slice = body.beginParse();
    if (slice.remainingBits < 32 || slice.loadUint(32) !== OP_TOKEN_DEPLOYED) return null;
    slice.loadUintBig(64);
    return {
      curve: slice.loadAddress(),
      master: slice.loadAddress(),
      creator: slice.loadAddress(),
    };
  } catch {
    return null;
  }
}

function addressEquals(left: Address | null, right: Address) {
  return Boolean(left && left.equals(right));
}

async function fetchTokenMetadata(client: TonClient, jettonMaster: Address): Promise<TokenMetadata> {
  const result = await client.runMethod(jettonMaster, 'get_jetton_data');
  result.stack.readBigNumber();
  result.stack.readBoolean();
  result.stack.readAddress();
  const metadataUrl = contentUrlFromCell(result.stack.readCell());
  if (!metadataUrl) return {};

  try {
    const response = await fetch(ipfsToGateway(metadataUrl), { cache: 'no-store' });
    if (!response.ok) return { metadata_url: metadataUrl };
    const metadata = await response.json() as Record<string, unknown>;
    return {
      metadata_url: metadataUrl,
      name: typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : 'Unknown',
      symbol: typeof metadata.symbol === 'string' && metadata.symbol.trim() ? metadata.symbol.trim().toUpperCase() : 'UNK',
      description: typeof metadata.description === 'string' ? metadata.description : null,
      image_url: typeof metadata.image === 'string' ? metadata.image : null,
      twitter_url: typeof metadata.twitter === 'string' ? metadata.twitter : null,
      telegram_url: typeof metadata.telegram === 'string' ? metadata.telegram : null,
      website_url: typeof metadata.website === 'string' ? metadata.website : null,
    };
  } catch {
    return { metadata_url: metadataUrl };
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    metadataUrl?: string;
    creatorAddress?: string;
    submittedAt?: number;
  };

  const factoryAddress = clean(process.env.NEXT_PUBLIC_FACTORY_ADDRESS);
  const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const endpoint = clean(process.env.TONCENTER_ENDPOINT) || DEFAULT_TONCENTER_ENDPOINT;
  const apiKey = clean(process.env.TONCENTER_API_KEY);
  const metadataUrl = (body.metadataUrl || '').trim();
  const submittedAt = Number(body.submittedAt || 0);

  if (!factoryAddress || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Launch sync is not configured.' }, { status: 503 });
  }

  const creatorAddress = (() => {
    try {
      return body.creatorAddress ? Address.parse(body.creatorAddress) : null;
    } catch {
      return null;
    }
  })();

  const client = new TonClient({ endpoint, apiKey: apiKey || undefined });
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let existingQuery = metadataUrl
    ? supabase
      .from('tokens')
      .select('address')
      .eq('metadata_url', metadataUrl)
      .order('created_at', { ascending: false })
      .limit(1)
    : null;
  if (existingQuery && ACTIVE_FACTORY_ADDRESS) existingQuery = existingQuery.eq('factory_address', ACTIVE_FACTORY_ADDRESS);
  const { data: existingByMetadata } = existingQuery
    ? await existingQuery.maybeSingle()
    : { data: null };

  if (existingByMetadata?.address) {
    return NextResponse.json({ address: existingByMetadata.address, indexed: true, existing: true });
  }

  const factory = Address.parse(factoryAddress);
  const transactions = await client.getTransactions(factory, { limit: 40, archival: false });
  const initialMarketCap = getMarketCap(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
  const initialPrice = getPriceInNanotons(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
  const tonUsdPrice = Number(TON_USD_PRICE_NUM) / Number(TON_USD_PRICE_DEN);

  for (const tx of transactions) {
    const blockTimeMs = typeof tx.now === 'number' ? tx.now * 1000 : 0;
    const recentEnough = !submittedAt || !blockTimeMs || blockTimeMs >= submittedAt - 180_000;

    for (const outMsg of tx.outMessages.values()) {
      if (!outMsg.body) continue;
      const parsed = parseTokenDeployed(outMsg.body);
      if (!parsed) continue;

      const creatorMatches = addressEquals(creatorAddress, parsed.creator);
      if (creatorAddress && !creatorMatches && recentEnough) continue;

      const metadata = await fetchTokenMetadata(client, parsed.master);
      const metadataMatches = metadataUrl && metadata.metadata_url === metadataUrl;
      if (metadataUrl && !metadataMatches) continue;
      if (!metadataUrl && creatorAddress && !creatorMatches) continue;
      if (!metadataMatches && !recentEnough) continue;

      const record = {
        factory_address: ACTIVE_FACTORY_ADDRESS || factoryAddress,
        address: formatTonAddress(parsed.curve),
        jetton_address: formatTonAddress(parsed.master),
        master_address: formatTonAddress(parsed.master),
        creator_address: formatTonAddress(parsed.creator),
        name: 'Unknown',
        symbol: 'UNK',
        ...metadata,
        virtual_ton_reserves: INITIAL_VIRTUAL_TON.toString(),
        virtual_token_reserves: INITIAL_VIRTUAL_TOKENS.toString(),
        real_ton_reserves: '0',
        real_token_reserves: REAL_TOKEN_SUPPLY.toString(),
        token_price_ton: initialPrice.toString(),
        token_price_usd: ((Number(initialPrice) / 1e9) * tonUsdPrice).toString(),
        market_cap_ton: initialMarketCap.toString(),
        market_cap_usd: ((Number(initialMarketCap) / 1e9) * tonUsdPrice).toString(),
        market_cap_usd_snapshot: tonUsdPrice.toString(),
        migration_state: 0,
        is_migrated: false,
        migrated: false,
        lp_status: 'pending',
        tx_count: 0,
      };

      const { data, error } = await supabase
        .from('tokens')
        .upsert(record, { onConflict: 'address' })
        .select('address')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ address: data.address, indexed: true, existing: false });
    }
  }

  return NextResponse.json({ indexed: false }, { status: 202 });
}
