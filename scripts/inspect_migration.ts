import { Address } from '@ton/core';
import { TonClient } from '@ton/ton';
import * as dotenv from 'dotenv';

dotenv.config();

const tokenAddress = process.env.MIGRATION_TOKEN_ADDRESS;
const jettonAddress = process.env.MIGRATION_JETTON_ADDRESS;

if (!tokenAddress || !jettonAddress) {
  throw new Error('Set MIGRATION_TOKEN_ADDRESS and MIGRATION_JETTON_ADDRESS.');
}
const checkedTokenAddress = tokenAddress;
const checkedJettonAddress = jettonAddress;

function opOf(body: any): string {
  if (!body) return 'empty';
  try {
    const op = body.beginParse().preloadUint(32);
    return `0x${op.toString(16)}`;
  } catch {
    try {
      return `comment:${body.beginParse().loadStringTail()}`;
    } catch {
      return 'unreadable';
    }
  }
}

async function printTxs(client: TonClient, label: string, address: Address) {
  const txs = await client.getTransactions(address, { limit: 12 });
  console.log(`\n${label}: ${address.toString()}`);
  for (const tx of txs) {
    const compute = tx.description.type === 'generic' ? tx.description.computePhase : undefined;
    const action = tx.description.type === 'generic' ? tx.description.actionPhase : undefined;
    const exit = compute?.type === 'vm' ? compute.exitCode : 'n/a';
    const actionCode = action ? action.resultCode : 'n/a';
    console.log(`- ${tx.hash().toString('hex').slice(0, 16)} exit=${exit} action=${actionCode} out=${tx.outMessages.size}`);
    if (tx.inMessage?.info.type === 'internal') {
      console.log(`  in from ${tx.inMessage.info.src.toString()} value=${Number(tx.inMessage.info.value.coins) / 1e9} op=${opOf(tx.inMessage.body)}`);
    }
    for (const out of tx.outMessages.values()) {
      if (out.info.type !== 'internal') continue;
      console.log(`  out to ${out.info.dest.toString()} value=${Number(out.info.value.coins) / 1e9} op=${opOf(out.body)}`);
    }
  }
}

async function main() {
  const client = new TonClient({
    endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY!,
  });

  await printTxs(client, 'BondingCurve', Address.parse(checkedTokenAddress));
  await printTxs(client, 'JettonMaster', Address.parse(checkedJettonAddress));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
