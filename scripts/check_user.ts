import * as dotenv from 'dotenv';
import { TonClient, Address } from '@ton/ton';
dotenv.config();

async function check() {
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TONCENTER_API_KEY!,
    });
    const addr = Address.parse('0QAyLd-uudWe8OMPxkeMh7wFkJgrdrYK4VI1waxmrAexb_R4');
    console.log('Checking User Wallet:', addr.toString());
    const txs = await client.getTransactions(addr, { limit: 50 });
    console.log('Found', txs.length, 'transactions');
    for (const tx of txs) {
        console.log('---');
        console.log('Hash:', tx.hash().toString('hex'));
        console.log('Out Msgs:', tx.outMessages.size);
        for (const outMsg of tx.outMessages.values()) {
            if (outMsg.info.type === 'internal') {
                console.log('  To:', outMsg.info.dest.toString());
                console.log('  Value:', Number(outMsg.info.value.coins) / 1e9, 'TON');
                if (outMsg.body) {
                    try {
                        const op = outMsg.body.beginParse().preloadUint(32);
                        console.log('  Op:', op, ' (0x' + op.toString(16) + ')');
                    } catch {}
                }
            }
        }
    }
}
check();
