import { Address } from '@ton/core';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const mnemonic = process.env.WALLET_MNEMONIC?.trim().split(/\s+/);
  if (!mnemonic) throw new Error('WALLET_MNEMONIC is required');
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    publicKey: key.publicKey,
    walletId: { networkGlobalId: -239 },
  });
  const client = new TonClient({
    endpoint: process.env.TONCENTER_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_API_KEY,
  });

  const expectedFactory = process.env.NEXT_PUBLIC_FACTORY_ADDRESS
    ? Address.parse(process.env.NEXT_PUBLIC_FACTORY_ADDRESS)
    : null;

  console.log('wallet', wallet.address.toString({ testOnly: true }));
  console.log('expectedFactory', expectedFactory?.toString({ testOnly: true }) || '');
  const txs = await client.getTransactions(wallet.address, { limit: 20, archival: false });
  for (const tx of txs) {
    const outs = [];
    for (const out of tx.outMessages.values()) {
      if (out.info.type !== 'internal') continue;
      let op = '';
      try {
        if (out.body) op = `0x${out.body.beginParse().loadUint(32).toString(16)}`;
      } catch {}
      outs.push({
        to: out.info.dest.toString({ testOnly: true }),
        value: out.info.value.coins.toString(),
        op,
        isExpectedFactory: expectedFactory ? out.info.dest.equals(expectedFactory) : false,
      });
    }
    console.log(
      new Date(tx.now * 1000).toISOString(),
      tx.hash().toString('hex').slice(0, 12),
      JSON.stringify(outs),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
