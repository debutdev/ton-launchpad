import * as dotenv from 'dotenv';
import { TonClient, Address } from '@ton/ton';
dotenv.config();

async function check() {
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TONCENTER_API_KEY!,
    });
    const addr = Address.parse('EQDr2R6iI306z_3LPLV3SsZQTq9EYUFwP_-NknUpnbIOudXo');
    console.log('Checking Factory:', addr.toString());
    const txs = await client.getTransactions(addr, { limit: 5 });
    console.log('Found', txs.length, 'transactions');
    for (const tx of txs) {
        console.log('TX LT:', tx.lt.toString(), 'Hash:', tx.hash().toString('hex'));
        console.log('In Msg Op:', tx.inMessage?.body.beginParse().preloadUint(32).toString(16));
        console.log('Out Msgs:', tx.outMessages.size);
    }
}
check();
