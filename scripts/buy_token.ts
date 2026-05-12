import { toNano, beginCell, Address } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { SendMode } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const OP_BUY_TOKENS = 0x10001;
const NANOS_PER_TON = 1000000000n;
const MIGRATION_THRESHOLD = NANOS_PER_TON / 5n;
const BUY_GAS_RESERVE = NANOS_PER_TON / 10n;
const MIGRATION_GAS_RESERVE = (NANOS_PER_TON * 8n) / 10n;

function formatNano(value: bigint): string {
    const whole = value / NANOS_PER_TON;
    const frac = (value % NANOS_PER_TON).toString().padStart(9, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole.toString();
}

async function main() {
    const bcAddress = process.argv[2];
    const tonAmount = process.argv[3] || '0.5';

    if (!bcAddress) {
        console.error('Usage: npx tsx scripts/buy_token.ts <bonding_curve_address> [ton_amount]');
        process.exit(1);
    }

    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TONCENTER_API_KEY!,
    });

    const mnemonic = process.env.WALLET_MNEMONIC!.split(' ');
    const key = await mnemonicToWalletKey(mnemonic);
    const wallet = WalletContractV5R1.create({
        publicKey: key.publicKey,
        walletId: { networkGlobalId: -239 },
    });
    const contract = client.open(wallet);

    console.log('Wallet:', wallet.address.toString());
    const balance = await client.getBalance(wallet.address);
    console.log('Balance:', Number(balance) / 1e9, 'TON');

    // Build BuyTokens message
    const body = beginCell()
        .storeUint(OP_BUY_TOKENS, 32)   // opcode
        .storeUint(Date.now(), 64)       // queryId
        .storeCoins(0)                   // minTokensOut (0 = no slippage)
        .endCell();

    const economicAmount = toNano(tonAmount);
    let realTonReserves = 0n;
    try {
        const reserves = await client.runMethod(Address.parse(bcAddress), 'getReserves');
        reserves.stack.readBigNumber();
        reserves.stack.readBigNumber();
        realTonReserves = reserves.stack.readBigNumber();
    } catch (e: any) {
        console.log('Could not read reserves before buy, using normal gas reserve:', e.message);
    }

    const gasReserve = realTonReserves + economicAmount >= MIGRATION_THRESHOLD
        ? MIGRATION_GAS_RESERVE
        : BUY_GAS_RESERVE;
    const sendAmount = economicAmount + gasReserve;
    console.log(`\nBuying tokens on ${bcAddress}`);
    console.log(`Sending: ${formatNano(sendAmount)} TON (${tonAmount} TON + ${formatNano(gasReserve)} gas)`);

    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        seqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: Address.parse(bcAddress),
                value: sendAmount,
                bounce: true,
                body: body,
            })
        ],
    });

    console.log('TX sent. Waiting...');
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const newSeqno = await contract.getSeqno();
        if (newSeqno > seqno) {
            console.log(`\n✅ Confirmed! (seqno ${seqno} → ${newSeqno})`);
            break;
        }
        process.stdout.write('.');
    }

    // Check reserves
    await new Promise(r => setTimeout(r, 5000));
    try {
        const result = await client.runMethod(Address.parse(bcAddress), 'getReserves');
        const s = result.stack;
        console.log('\nReserves after buy:');
        console.log('  vTon:', Number(s.readBigNumber()) / 1e9, 'TON');
        console.log('  vTokens:', Number(s.readBigNumber()) / 1e9);
        console.log('  rTon:', Number(s.readBigNumber()) / 1e9, 'TON');
        console.log('  rTokens:', Number(s.readBigNumber()) / 1e9);
        console.log('  migrated:', s.readBoolean());
    } catch (e: any) {
        console.log('Could not read reserves:', e.message);
    }
}

main().catch(console.error);
