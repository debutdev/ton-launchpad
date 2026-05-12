import { toNano, beginCell, Address, SendMode } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || 'EQDns5_s70xRFHVj5TAF_Qh26OBvL5WLCcLlkTUIL2oRUrzs';
const OP_DEPLOY_TOKEN = 0x20001;

async function main() {
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TONCENTER_API_KEY!,
    });

    // Load wallet - V5R1 with mainnet networkGlobalId (that's what Tonkeeper uses)
    const mnemonic = process.env.WALLET_MNEMONIC!.split(' ');
    const key = await mnemonicToWalletKey(mnemonic);
    const wallet = WalletContractV5R1.create({
        publicKey: key.publicKey,
        walletId: { networkGlobalId: -239 },
    });
    const contract = client.open(wallet);

    const balance = await client.getBalance(wallet.address);
    console.log('Wallet:', wallet.address.toString());
    console.log('Balance:', Number(balance) / 1e9, 'TON');

    if (balance < toNano('0.8')) {
        console.error('❌ Not enough balance.');
        return;
    }

    // Check factory
    const factoryState = await client.getContractState(Address.parse(FACTORY_ADDRESS));
    console.log('Factory state:', factoryState.state);

    // Build metadata content cell
    const metadataUrl = 'ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenpcactest';
    const contentCell = beginCell()
        .storeUint(0x01, 8)
        .storeStringTail(metadataUrl)
        .endCell();

    // Build DeployToken body
    const body = beginCell()
        .storeUint(OP_DEPLOY_TOKEN, 32)
        .storeUint(Date.now(), 64)
        .storeRef(contentCell)
        .endCell();

    console.log('\n--- Sending DeployToken ---');
    console.log('To:', FACTORY_ADDRESS);
    console.log('Value: 0.7 TON');

    const seqno = await contract.getSeqno();
    console.log('Seqno:', seqno);

    await contract.sendTransfer({
        seqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: Address.parse(FACTORY_ADDRESS),
                value: toNano('0.7'),
                bounce: true,
                body: body,
            })
        ],
    });

    console.log('\n✅ Transaction sent! Waiting for confirmation...');

    // Wait for seqno increment
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const newSeqno = await contract.getSeqno();
        if (newSeqno > seqno) {
            console.log(`\n✅ Confirmed! (seqno ${seqno} → ${newSeqno})`);
            confirmed = true;
            break;
        }
        process.stdout.write('.');
    }

    if (!confirmed) {
        console.log('\n⚠️ Timed out');
        return;
    }

    // Wait for on-chain processing
    console.log('Waiting 10s for on-chain processing...');
    await new Promise(r => setTimeout(r, 10000));

    // Check factory token count
    try {
        const result = await client.runMethod(Address.parse(FACTORY_ADDRESS), 'getTokenCount');
        const count = result.stack.readBigNumber();
        console.log('\n🎉 Factory token count:', count.toString());
    } catch (e: any) {
        console.log('Could not read token count:', e.message);
    }

    // Check latest factory tx
    const txs = await client.getTransactions(Address.parse(FACTORY_ADDRESS), { limit: 3 });
    console.log('\nFactory recent transactions:');
    for (const tx of txs) {
        const hash = tx.hash().toString('hex');
        console.log(`\n  TX: ${hash.slice(0, 16)}...`);
        console.log(`  OutMsgs: ${tx.outMessages.size}`);
        if (tx.description.type === 'generic') {
            const compute = tx.description.computePhase;
            if (compute?.type === 'vm') {
                console.log(`  exitCode: ${compute.exitCode} (${compute.exitCode === 0 ? '✅ SUCCESS' : '❌ FAILED'})`);
            }
            const action = tx.description.actionPhase;
            if (action) {
                console.log(`  actions: ${action.totalActions}, msgs: ${action.messagesCreated}, success: ${action.success}`);
            }
        }
    }
}

main().catch(console.error);
