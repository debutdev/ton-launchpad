/**
 * Tonked.io — Sell All Tokens (direct on-chain check, no Supabase dependency)
 * Scans known JettonMaster addresses from Supabase AND from on-chain,
 * checks user's JettonWallet balance, and sells everything.
 */
import { beginCell, toNano, Address, SendMode } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const OP_SELL_TOKENS = 0x10002;
const OP_JETTON_TRANSFER = 0xf8a7ea5;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function retryOnRateLimit<T>(fn: () => Promise<T>, label: string): Promise<T> {
    for (let i = 0; i < 10; i++) {
        try { return await fn(); }
        catch (e: any) {
            if (e?.isAxiosError || e?.message?.includes('429')) {
                console.log(`  ⏳ Rate limited on ${label}, retrying in ${2 + i}s...`);
                await sleep((2 + i) * 1000);
            } else throw e;
        }
    }
    throw new Error(`Failed after 10 retries: ${label}`);
}

async function main() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

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

    const balance = await retryOnRateLimit(() => client.getBalance(wallet.address), 'getBalance');
    console.log('Wallet:', wallet.address.toString());
    console.log('TON Balance:', Number(balance) / 1e9, 'TON\n');

    // Fetch all tokens from Supabase
    const { data: tokens, error } = await supabase.from('tokens').select('address, jetton_address, symbol');
    if (error || !tokens) {
        console.error('❌ Could not fetch tokens from Supabase', error);
        return;
    }

    console.log(`Found ${tokens.length} tokens in DB. Checking each for your jetton balance...\n`);

    let soldCount = 0;

    for (const token of tokens) {
        const jmAddr = Address.parse(token.jetton_address);
        const bcAddr = Address.parse(token.address);
        const label = `${token.symbol || 'UNK'} (${token.address.slice(0, 12)}...)`;

        // 1. Get user's JettonWallet address from JettonMaster
        let userJettonWallet: Address;
        try {
            const result = await retryOnRateLimit(
                () => client.runMethod(jmAddr, 'get_wallet_address', [
                    { type: 'slice', cell: beginCell().storeAddress(wallet.address).endCell() }
                ]),
                `get_wallet_address for ${label}`
            );
            userJettonWallet = result.stack.readAddress();
        } catch (e: any) {
            // JettonMaster doesn't exist or is uninitialized — skip
            console.log(`  ⚪ ${label}: JettonMaster not active, skipping`);
            continue;
        }

        // 2. Check balance
        let tokenBalance = 0n;
        try {
            const jwData = await retryOnRateLimit(
                () => client.runMethod(userJettonWallet, 'get_wallet_data'),
                `get_wallet_data for ${label}`
            );
            tokenBalance = jwData.stack.readBigNumber();
        } catch {
            // JettonWallet not deployed — user has no tokens
            console.log(`  ⚪ ${label}: No JettonWallet (0 tokens)`);
            continue;
        }

        if (tokenBalance === 0n) {
            console.log(`  ⚪ ${label}: Balance is 0`);
            continue;
        }

        console.log(`  🟢 ${label}: ${Number(tokenBalance) / 1e9} tokens — SELLING`);

        // 3. Build Sell TX
        const forwardPayload = beginCell()
            .storeUint(OP_SELL_TOKENS, 32)
            .storeUint(Date.now(), 64)
            .storeCoins(0) // minTonOut = 0 (accept any)
            .endCell();

        const sellBody = beginCell()
            .storeUint(OP_JETTON_TRANSFER, 32)
            .storeUint(Date.now(), 64)
            .storeCoins(tokenBalance)
            .storeAddress(bcAddr)         // destination: BondingCurve
            .storeAddress(wallet.address) // response_destination
            .storeMaybeRef(null)          // custom_payload
            .storeCoins(toNano('0.15'))   // forward_ton_amount
            .storeSlice(forwardPayload.beginParse())
            .endCell();

        const seqno = await retryOnRateLimit(() => contract.getSeqno(), 'getSeqno');
        await contract.sendTransfer({
            seqno,
            secretKey: key.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
                internal({
                    to: userJettonWallet,
                    value: toNano('0.25'),
                    bounce: true,
                    body: sellBody,
                })
            ],
        });

        console.log(`    TX sent (seqno=${seqno}). Waiting for confirmation...`);
        for (let i = 0; i < 30; i++) {
            await sleep(3000);
            try {
                const newSeqno = await contract.getSeqno();
                if (newSeqno > seqno) break;
            } catch { /* rate limit, keep trying */ }
        }
        console.log(`    ✅ Sell confirmed!`);
        soldCount++;

        // Small delay between sells to avoid rate limits
        await sleep(3000);
    }

    console.log(`\n${'═'.repeat(50)}`);
    if (soldCount === 0) {
        console.log('No tokens found in your wallet to sell.');
        console.log('The TON spent on old broken BondingCurves cannot be recovered');
        console.log('(the Mint bounced due to the circular dependency bug).');
    } else {
        console.log(`🎉 Sold ${soldCount} token(s)!`);
    }

    const newBalance = await retryOnRateLimit(() => client.getBalance(wallet.address), 'getBalance');
    console.log(`Final TON Balance: ${Number(newBalance) / 1e9} TON`);
}

main().catch(console.error);
