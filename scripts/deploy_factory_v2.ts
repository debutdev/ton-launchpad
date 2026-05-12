import { toNano, Address, SendMode } from '@ton/core';
import { TonClient, WalletContractV5R1, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { LaunchpadFactory } from '../build/LaunchpadFactory/LaunchpadFactory_LaunchpadFactory';
import * as dotenv from 'dotenv';
dotenv.config();

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

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    async function retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
        while (true) {
            try { return await fn(); }
            catch (e: any) {
                if (e.isAxiosError) {
                    console.log(`  ⏳ Rate limited on ${label}, retrying in 3s...`);
                    await sleep(3000);
                } else throw e;
            }
        }
    }

    console.log('Deployer:', wallet.address.toString());
    const balance = await retry(() => client.getBalance(wallet.address), 'getBalance');
    console.log('Balance:', Number(balance) / 1e9, 'TON');

    const factoryInit = await LaunchpadFactory.fromInit(
        wallet.address,
        wallet.address,
        3000n,
    );
    const factoryAddress = factoryInit.address;
    console.log('New Factory v4 address:', factoryAddress.toString());

    const state = await retry(() => client.getContractState(factoryAddress), 'getContractState');
    if (state.state === 'active') {
        console.log('✅ Already deployed!');
        return;
    }

    console.log('Deploying new Factory...');
    const seqno = await retry(() => contract.getSeqno(), 'getSeqno');

    await retry(() => contract.sendTransfer({
        seqno,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: factoryAddress,
                value: toNano('0.2'),
                bounce: false,
                init: factoryInit.init,
            })
        ],
    }), 'sendTransfer');

    console.log('TX sent. Waiting for confirmation...');
    while (await retry(() => contract.getSeqno(), 'getSeqno') === seqno) {
        process.stdout.write('.');
        await sleep(3000);
    }

    console.log(`\n🎉 NEW FACTORY DEPLOYED!`);
    console.log(`Address: ${factoryAddress.toString()}`);
}

main().catch(console.error);
