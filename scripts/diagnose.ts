/**
 * Diagnose why the Mint is failing on the new factory tokens.
 */
import { TonClient, Address } from '@ton/ton';
import { beginCell } from '@ton/core';
import * as dotenv from 'dotenv';
dotenv.config();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    for (let i = 0; i < 15; i++) {
        try { return await fn(); }
        catch (e: any) {
            if (e?.isAxiosError || e?.message?.includes('429') || e?.message?.includes('Request failed')) {
                await sleep(3000 + i * 1000);
            } else throw e;
        }
    }
    throw new Error(`Failed after retries: ${label}`);
}

async function main() {
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TONCENTER_API_KEY!,
    });

    const jm = Address.parse('EQDJA0AbmZgXb0Uda8IUZjAn_A5O6nd8Dv3hRCS8NmK8XPrq');
    const bc = Address.parse('EQDoYbdleBAmLgOJOXXc9u4a_kozHtyotbOnC_8zGY0omOR8');
    const factory = Address.parse(process.env.NEXT_PUBLIC_FACTORY_ADDRESS!);

    // 1. Check contract states
    console.log('=== Contract States ===');
    const jmState = await retry(() => client.getContractState(jm), 'jm state');
    console.log('JettonMaster:', jmState.state);
    await sleep(2000);
    
    const bcState = await retry(() => client.getContractState(bc), 'bc state');
    console.log('BondingCurve:', bcState.state);
    await sleep(2000);

    // 2. Check JettonMaster owner
    console.log('\n=== JettonMaster get_jetton_data ===');
    try {
        const result = await retry(() => client.runMethod(jm, 'get_jetton_data'), 'get_jetton_data');
        const totalSupply = result.stack.readBigNumber();
        const mintable = result.stack.readBoolean();
        const adminAddr = result.stack.readAddress();
        console.log('Total Supply:', totalSupply.toString());
        console.log('Mintable:', mintable);
        console.log('Admin/Owner:', adminAddr.toString());
        console.log('Expected BondingCurve:', bc.toString());
        console.log('Factory:', factory.toString());
        console.log('Owner === BC?', adminAddr.equals(bc));
        console.log('Owner === Factory?', adminAddr.equals(factory));
    } catch(e: any) { console.log('Error:', e.message); }
    await sleep(2000);

    // 3. BondingCurve transactions
    console.log('\n=== BondingCurve Transactions ===');
    try {
        const txs = await retry(() => client.getTransactions(bc, { limit: 5 }), 'bc txs');
        for (const tx of txs) {
            const desc = tx.description;
            if (desc.type === 'generic') {
                const cp = desc.computePhase;
                const exitCode = cp?.type === 'vm' ? cp.exitCode : 'N/A';
                const success = cp?.type === 'vm' ? cp.success : 'N/A';
                let opStr = '';
                if (tx.inMessage?.body) {
                    try {
                        const s = tx.inMessage.body.beginParse();
                        const op = s.loadUint(32);
                        opStr = ` op=0x${op.toString(16)}`;
                    } catch {}
                }
                let fromStr = '';
                if (tx.inMessage?.info.type === 'internal') {
                    fromStr = ` from=${tx.inMessage.info.src.toString().slice(0, 20)}...`;
                }
                console.log(`  TX ${tx.hash().toString('hex').slice(0,12)}: exit=${exitCode} success=${success} outMsgs=${tx.outMessagesCount}${opStr}${fromStr}`);
            }
        }
    } catch(e: any) { console.log('Error:', e.message); }
    await sleep(2000);

    // 4. JettonMaster transactions
    console.log('\n=== JettonMaster Transactions ===');
    try {
        const txs = await retry(() => client.getTransactions(jm, { limit: 5 }), 'jm txs');
        for (const tx of txs) {
            const desc = tx.description;
            if (desc.type === 'generic') {
                const cp = desc.computePhase;
                const exitCode = cp?.type === 'vm' ? cp.exitCode : 'N/A';
                const success = cp?.type === 'vm' ? cp.success : 'N/A';
                let opStr = '';
                if (tx.inMessage?.body) {
                    try {
                        const s = tx.inMessage.body.beginParse();
                        const op = s.loadUint(32);
                        opStr = ` op=0x${op.toString(16)}`;
                    } catch {}
                }
                let fromStr = '';
                if (tx.inMessage?.info.type === 'internal') {
                    fromStr = ` from=${tx.inMessage.info.src.toString().slice(0, 20)}...`;
                }
                console.log(`  TX ${tx.hash().toString('hex').slice(0,12)}: exit=${exitCode} success=${success} outMsgs=${tx.outMessagesCount}${opStr}${fromStr}`);
            }
        }
    } catch(e: any) { console.log('Error:', e.message); }

    // 5. Check BondingCurve reserves
    console.log('\n=== BondingCurve getReserves ===');
    try {
        const result = await retry(() => client.runMethod(bc, 'getReserves'), 'getReserves');
        const vTon = result.stack.readBigNumber();
        const vTokens = result.stack.readBigNumber();
        const rTon = result.stack.readBigNumber();
        const rTokens = result.stack.readBigNumber();
        const migrated = result.stack.readBoolean();
        console.log('Virtual TON:', Number(vTon) / 1e9);
        console.log('Virtual Tokens:', Number(vTokens) / 1e9);
        console.log('Real TON:', Number(rTon) / 1e9);
        console.log('Real Tokens:', Number(rTokens) / 1e9);
        console.log('Migrated:', migrated);
    } catch(e: any) { console.log('Error:', e.message); }
}

main().catch(console.error);
