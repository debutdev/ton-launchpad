import { Address, beginCell } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

function opOf(body: any): string {
  try {
    if (!body) return '';
    return `0x${body.beginParse().loadUint(32).toString(16)}`;
  } catch {
    return '';
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase env is required');

  const supabase = createClient(supabaseUrl, supabaseKey);
  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY,
  });

  const mnemonic = process.env.WALLET_MNEMONIC?.trim().split(/\s+/);
  if (!mnemonic) throw new Error('WALLET_MNEMONIC is required');
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });

  const { data: token, error } = await supabase
    .from('tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  if (!token) throw new Error('No token rows found');

  console.log('token', JSON.stringify({
    address: token.address,
    master: token.jetton_address || token.master_address,
    name: token.name,
    symbol: token.symbol,
    market_cap_ton: token.market_cap_ton,
    volume_24h_ton: token.volume_24h_ton,
    tx_count: token.tx_count,
    holders: token.holders,
    created_at: token.created_at,
  }, null, 2));

  const curve = Address.parse(token.address);
  const master = Address.parse(token.jetton_address || token.master_address);
  const owner = wallet.address;

  const reserves = await client.runMethod(curve, 'getReserves');
  console.log('reserves', {
    virtualTon: reserves.stack.readBigNumber().toString(),
    virtualToken: reserves.stack.readBigNumber().toString(),
    realTon: reserves.stack.readBigNumber().toString(),
    realToken: reserves.stack.readBigNumber().toString(),
    currentSupply: reserves.stack.readBigNumber().toString(),
    migrationState: reserves.stack.readBigNumber().toString(),
  });

  const walletAddressResult = await client.runMethod(master, 'get_wallet_address', [
    { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
  ]);
  const userJettonWallet = walletAddressResult.stack.readAddress();
  const walletState = await client.getContractState(userJettonWallet);
  console.log('userWallet', owner.toString({ testOnly: true }));
  console.log('jettonWallet', userJettonWallet.toString({ testOnly: true }), walletState.state);
  if (walletState.state === 'active') {
    const walletData = await client.runMethod(userJettonWallet, 'get_wallet_data');
    console.log('jettonBalance', walletData.stack.readBigNumber().toString());
  }

  const txs = await client.getTransactions(curve, { limit: 10, archival: false });
  for (const tx of txs) {
    const outs = [];
    for (const out of tx.outMessages.values()) {
      if (out.info.type !== 'internal') continue;
      outs.push({
        to: out.info.dest.toString({ testOnly: true }),
        value: out.info.value.coins.toString(),
        op: opOf(out.body),
      });
    }
    console.log('curveTx', new Date(tx.now * 1000).toISOString(), tx.hash().toString('hex').slice(0, 12), {
      inOp: opOf(tx.inMessage?.body),
      success: (tx.description as any)?.computePhase?.success,
      exitCode: (tx.description as any)?.computePhase?.exitCode,
      outs,
    });
  }

  const { data: trades } = await supabase
    .from('trades')
    .select('type,ton_amount,token_amount,market_cap_ton_after,tx_hash,created_at,block_time')
    .eq('token_address', token.address)
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('trades', JSON.stringify(trades || [], null, 2));

  const { data: candles } = await supabase
    .from('token_candles')
    .select('timeframe,bucket_start,close_market_cap_ton,total_volume_ton,trade_count')
    .eq('token_address', token.address)
    .order('bucket_start', { ascending: false })
    .limit(8);
  console.log('candles', JSON.stringify(candles || [], null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
