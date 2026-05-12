import { toNano, Cell, Address } from '@ton/core';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { LaunchpadFactory } from '../wrappers/LaunchpadFactory';
import * as dotenv from 'dotenv';
dotenv.config();

async function deploy() {
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TONCENTER_API_KEY!,
    });

    const mnemonic = process.env.WALLET_MNEMONIC!.split(' ');
    const key = await mnemonicToWalletKey(mnemonic);
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const contract = client.open(wallet);

    console.log('Deployer Wallet:', wallet.address.toString());

    // Init factory
    const factoryInit = await LaunchpadFactory.fromInit(
        wallet.address, // Owner
        wallet.address, // Platform Wallet
        0n              // tokenCount
    );

    const factoryAddress = factoryInit.address;
    console.log('Factory Target Address:', factoryAddress.toString());

    // Check if already deployed
    const state = await client.getContractState(factoryAddress);
    if (state.state === 'active') {
        console.log('Factory is already active!');
    } else {
        console.log('Deploying via simple transfer with init...');
        const seqno = await contract.getSeqno();
        await contract.sendTransfer({
            seqno,
            secretKey: key.secretKey,
            messages: [
                internal({
                    to: factoryAddress,
                    value: toNano('0.2'),
                    bounce: false,
                    init: factoryInit.init,
                    body: Cell.EMPTY
                })
            ]
        });
        console.log('Sent deployment transaction.');
    }
}
deploy().catch(console.error);
