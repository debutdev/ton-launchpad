import { Address, Cell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

function parseTokenDeployed(body: Cell) {
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== 0x20002) return null;
    return {
      queryId: slice.loadUintBig(64).toString(),
      curve: slice.loadAddress().toString({ testOnly: true }),
      master: slice.loadAddress().toString({ testOnly: true }),
      creator: slice.loadAddress().toString({ testOnly: true }),
    };
  } catch {
    return null;
  }
}

async function main() {
  const factory = Address.parse(process.env.NEXT_PUBLIC_FACTORY_ADDRESS!);
  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY,
  });

  console.log('factory', factory.toString({ testOnly: true }));
  const state = await client.getContractState(factory);
  console.log('state', state.state, 'balance', state.balance?.toString() || '0');
  const count = await client.runMethod(factory, 'getTokenCount');
  console.log('tokenCount', count.stack.readBigNumber().toString());

  const txs = await client.getTransactions(factory, { limit: 12, archival: false });
  for (const tx of txs) {
    const description = tx.description as any;
    const computePhase = description.type === 'generic' ? description.computePhase : null;
    const exit = computePhase?.type === 'vm' ? computePhase.exitCode : 'n/a';
    const success = computePhase?.type === 'vm' ? computePhase.success : 'n/a';
    let inOp = '';
    try {
      if (tx.inMessage?.body) inOp = `0x${tx.inMessage.body.beginParse().loadUint(32).toString(16)}`;
    } catch {}

    const events = [];
    for (const out of tx.outMessages.values()) {
      if (!out.body) continue;
      const parsed = parseTokenDeployed(out.body);
      if (parsed) events.push(parsed);
    }
    console.log(
      new Date(tx.now * 1000).toISOString(),
      'exit',
      exit,
      'success',
      success,
      'out',
      tx.outMessagesCount,
      'inOp',
      inOp,
      events.length ? JSON.stringify(events) : '',
    );
  }

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from('tokens')
      .select('address,name,symbol,metadata_url,creator_address,created_at')
      .order('created_at', { ascending: false })
      .limit(8);
    if (error) console.log('dbError', error.message);
    else console.log('latestDb', JSON.stringify(data, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
