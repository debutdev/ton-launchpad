import { Address, beginCell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name]?.replace(/^"|"$/g, '').trim();
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

function argValue(name: string): string | undefined {
  const prefixed = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function formatNano(value: string | number | bigint | null | undefined): number {
  return Number(BigInt(value || 0)) / 1e9;
}

async function main() {
  const curve = Address.parse(requireEnv('BOB_TEST_CURVE'));
  const master = Address.parse(requireEnv('BOB_TEST_MASTER'));
  const platform = Address.parse(requireEnv('TESTNET_PLATFORM_WALLET'));
  const wallet = argValue('--wallet');

  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: requireEnv('TONCENTER_API_KEY'),
  });

  const curveAddress = curve.toString();
  const masterAddress = master.toString();
  const platformJettonWallet = (
    await client.runMethod(master, 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(platform).endCell() },
    ])
  ).stack.readAddress();

  let platformFeeTokenBalance = 0n;
  const platformState = await client.getContractState(platformJettonWallet);
  if (platformState.state === 'active') {
    platformFeeTokenBalance = (await client.runMethod(platformJettonWallet, 'get_wallet_data')).stack.readBigNumber();
  }

  const migrationState = Number((await client.runMethod(curve, 'getMigrationState')).stack.readBigNumber());
  const { data: token, error: tokenError } = await supabase
    .from('tokens')
    .select('*')
    .eq('address', curveAddress)
    .maybeSingle();
  if (tokenError) throw tokenError;

  const { data: trades, error: tradeError } = await supabase
    .from('trades')
    .select('*')
    .eq('token_address', curveAddress)
    .order('created_at', { ascending: false })
    .limit(100);
  if (tradeError) throw tradeError;

  const { count: candleCount, error: candleError } = await supabase
    .from('token_candles')
    .select('token_address', { count: 'exact', head: true })
    .eq('token_address', curveAddress);
  if (candleError) throw candleError;

  const grouped: Record<string, { count: number; ton: number; tokens: number; feeTon: number; feeTokens: number }> = {};
  for (const trade of trades || []) {
    const key = `${trade.source || 'unknown'}:${trade.type || 'unknown'}`;
    grouped[key] ||= { count: 0, ton: 0, tokens: 0, feeTon: 0, feeTokens: 0 };
    grouped[key].count += 1;
    grouped[key].ton += formatNano(trade.ton_amount);
    grouped[key].tokens += formatNano(trade.token_amount);
    grouped[key].feeTon += formatNano(trade.fee_ton);
    grouped[key].feeTokens += formatNano(trade.fee_token_amount);
  }

  console.log(
    JSON.stringify(
      {
        curve: curve.toString({ testOnly: true }),
        master: master.toString({ testOnly: true }),
        wallet,
        onchainMigrationState: migrationState,
        token: token
          ? {
              name: token.name,
              symbol: token.symbol,
              dbMigrationState: token.migration_state,
              pool: token.ston_pool_address || token.dedust_pool_address,
              marketCapTon: token.market_cap_ton,
              totalVolumeTon: token.total_volume_ton,
              holders: token.holders,
            }
          : null,
        indexedTradeCount: trades?.length || 0,
        grouped,
        candleCount,
        platformFeeWallet: platformJettonWallet.toString({ testOnly: true }),
        platformFeeTokenBalance: formatNano(platformFeeTokenBalance),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
