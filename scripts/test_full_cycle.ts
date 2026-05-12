import { toNano, beginCell, Address, Cell, SendMode } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || 'EQDns5_s70xRFHVj5TAF_Qh26OBvL5WLCcLlkTUIL2oRUrzs';
const OP_DEPLOY_TOKEN = 0x20001;
const OP_TOKEN_DEPLOYED = 0x20002;
const OP_BUY_TOKENS = 0x10001;
const OP_SELL_TOKENS = 0x10002;
const OP_JETTON_TRANSFER = 0x0f8a7ea5;
const OP_JETTON_NOTIFICATION = 0x7362d09c;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getSeqnoSafe(contract: any): Promise<number> {
    while (true) {
        try { return await contract.getSeqno(); } 
        catch { await sleep(2000); }
    }
}
async function getBalanceSafe(client: any, address: Address): Promise<bigint> {
    while (true) {
        try { return await client.getBalance(address); } 
        catch (e: any) { 
            console.log('  ⏳ Rate limited on getBalance, retrying in 2s...');
            await sleep(2000); 
        }
    }
}
async function runMethodSafe(client: any, address: Address, method: string, args: any[] = []): Promise<any> {
    while (true) {
        try { return await client.runMethod(address, method, args); } 
        catch (e: any) { 
            if (e.isAxiosError) {
                console.log('  ⏳ Rate limited on runMethod, retrying in 2s...');
                await sleep(2000);
            } 
            else throw e;
        }
    }
}
async function sendTransferSafe(contract: any, args: any): Promise<void> {
    while (true) {
        try { return await contract.sendTransfer(args); } 
        catch (e: any) { 
            if (e.isAxiosError) {
                console.log('  ⏳ Rate limited on sendTransfer, retrying in 2s...');
                await sleep(2000);
            } 
            else throw e;
        }
    }
}
async function getTransactionsSafe(client: any, address: Address, limit: number): Promise<any[]> {
    while (true) {
        try { return await client.getTransactions(address, { limit }); }
        catch (e: any) {
            if (e.isAxiosError) {
                console.log('  Rate limited on getTransactions, retrying in 2s...');
                await sleep(2000);
            }
            else throw e;
        }
    }
}
async function findTokenFromFactoryTxs(client: any, queryId: bigint) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const txs = await getTransactionsSafe(client, Address.parse(FACTORY_ADDRESS), 20);
        for (const tx of txs) {
            for (const outMsg of tx.outMessages.values()) {
                if (!outMsg.body) continue;
                try {
                    const slice = outMsg.body.beginParse();
                    const op = slice.loadUint(32);
                    if (op !== OP_TOKEN_DEPLOYED) continue;
                    const eventQueryId = slice.loadUintBig(64);
                    if (eventQueryId !== queryId) continue;
                    return {
                        address: slice.loadAddress().toString(),
                        jetton_address: slice.loadAddress().toString(),
                    };
                } catch {
                    // Ignore non-event messages.
                }
            }
        }
        await sleep(3000);
    }
    return null;
}

async function main() {
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

    let balance = await getBalanceSafe(client, wallet.address);
    console.log('Wallet:', wallet.address.toString());
    console.log('Balance:', Number(balance) / 1e9, 'TON');

    if (balance < toNano('1.0')) {
        console.error('❌ Not enough balance for full cycle test. Need at least 1.0 TON.');
        return;
    }

    // --- 1. DEPLOY TOKEN ---
    // Use a unique metadata URL per run so we get fresh contract addresses each time
    const deployQueryId = BigInt(Date.now());
    const uniqueId = deployQueryId.toString(36);
    const metadataUrl = `ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenpcac${uniqueId}`;
    console.log('Metadata URL:', metadataUrl);
    const contentCell = beginCell().storeUint(0x01, 8).storeStringTail(metadataUrl).endCell();
    const deployBody = beginCell().storeUint(OP_DEPLOY_TOKEN, 32).storeUint(deployQueryId, 64).storeRef(contentCell).endCell();

    let seqno = await getSeqnoSafe(contract);
    await sendTransferSafe(contract, {
        seqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: Address.parse(FACTORY_ADDRESS),
                value: toNano('0.7'), // 0.2 fee + 0.5 gas
                bounce: true,
                body: deployBody,
            })
        ],
    });

    console.log('Deploy TX sent. Waiting for confirmation...');
    while (await getSeqnoSafe(contract) === seqno) await sleep(3000);
    console.log('Deploy TX confirmed! Reading exact TokenDeployed event...');
    let token: any = await findTokenFromFactoryTxs(client, deployQueryId);

    if (!token) {
        console.error('\n❌ Could not find deployed token in Supabase. Is the indexer running?');
        return;
    }

    console.log(`\n✅ Token Deployed! BondingCurve: ${token.address}`);
    console.log(`JettonMaster: ${token.jetton_address}`);

    // --- 2. BUY TOKEN ---
    console.log('\n--- 2. BUYING TOKENS (0.05 TON) ---');
    const buyBody = beginCell().storeUint(OP_BUY_TOKENS, 32).storeUint(Date.now(), 64).storeCoins(0).endCell();

    seqno = await getSeqnoSafe(contract);
    await sendTransferSafe(contract, {
        seqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: Address.parse(token.address),
                value: toNano('0.15'), // 0.05 TON + 0.1 gas reserve
                bounce: true,
                body: buyBody,
            })
        ],
    });

    console.log('Buy TX sent. Waiting for confirmation...');
    while (await getSeqnoSafe(contract) === seqno) await sleep(3000);
    console.log('Buy TX confirmed! Waiting 20s for Jetton transfers to settle...');
    await sleep(20000);

    // --- 3. GET JETTON WALLET & BALANCE ---
    console.log('\n--- 3. FETCHING USER JETTON WALLET ---');
    const result = await runMethodSafe(client, Address.parse(token.jetton_address), 'get_wallet_address', [
        { type: 'slice', cell: beginCell().storeAddress(wallet.address).endCell() }
    ]);
    const userJettonWallet = result.stack.readAddress();
    console.log('User JettonWallet:', userJettonWallet.toString());

    // Fetch jetton balance
    let tokenBalance = 0n;
    try {
        const jwData = await runMethodSafe(client, userJettonWallet, 'get_wallet_data');
        tokenBalance = jwData.stack.readBigNumber();
        console.log(`✅ User has ${Number(tokenBalance) / 1e9} Tokens!`);
    } catch (e: any) {
        console.error('❌ Could not fetch JettonWallet data. Tokens might not have arrived.', e.message);
        return;
    }

    if (tokenBalance === 0n) {
        console.error('❌ Token balance is 0. Aborting sell.');
        return;
    }

    // --- 4. SELL TOKEN ---
    console.log('\n--- 4. SELLING TOKENS ---');
    
    // Forward payload for BondingCurve (OP_SELL_TOKENS)
    const forwardPayload = beginCell()
        .storeUint(OP_SELL_TOKENS, 32)
        .storeUint(Date.now(), 64)
        .storeCoins(0) // minTonOut
        .endCell();

    // JettonTransfer message body
    const sellBody = beginCell()
        .storeUint(OP_JETTON_TRANSFER, 32)
        .storeUint(Date.now(), 64)
        .storeCoins(tokenBalance) // Sell all
        .storeAddress(Address.parse(token.address)) // destination: Bonding Curve
        .storeAddress(wallet.address) // response_destination (excess TON)
        .storeMaybeRef(null) // custom_payload
        .storeCoins(toNano('0.15')) // forward_ton_amount
        .storeSlice(forwardPayload.beginParse()) // forward_payload
        .endCell();

    seqno = await getSeqnoSafe(contract);
    await sendTransferSafe(contract, {
        seqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: userJettonWallet,
                value: toNano('0.25'), // gas for JettonWallet transfer
                bounce: true,
                body: sellBody,
            })
        ],
    });

    console.log('Sell TX sent. Waiting for confirmation...');
    while (await getSeqnoSafe(contract) === seqno) await sleep(3000);
    console.log('Sell TX confirmed! Waiting 15s for TON to arrive back...');
    await sleep(15000);

    const bcTxs = await client.getTransactions(Address.parse(token.address), { limit: 5 });
    const sellTx = bcTxs.find((tx: any) => {
        try {
            return tx.inMessage?.body.beginParse().preloadUint(32) === OP_JETTON_NOTIFICATION;
        } catch {
            return false;
        }
    });
    const sellCompute = sellTx?.description.type === 'generic' ? sellTx.description.computePhase : null;
    const sellSucceeded = sellCompute?.type === 'vm' && sellCompute.success;
    if (!sellSucceeded) {
        const exitCode = sellCompute?.type === 'vm' ? sellCompute.exitCode : 'unknown';
        console.error(`❌ BondingCurve sell failed on-chain. Exit code: ${exitCode}`);
        return;
    }

    const finalJettonData = await runMethodSafe(client, userJettonWallet, 'get_wallet_data');
    const finalTokenBalance = finalJettonData.stack.readBigNumber();
    if (finalTokenBalance !== 0n) {
        console.error(`❌ Sell did not clear token balance. Remaining: ${Number(finalTokenBalance) / 1e9}`);
        return;
    }

    const finalBalance = await getBalanceSafe(client, wallet.address);
    console.log(`\n🎉 FULL CYCLE COMPLETE!`);
    console.log(`Final TON Balance: ${Number(finalBalance) / 1e9} TON`);
}

main().catch(console.error);
