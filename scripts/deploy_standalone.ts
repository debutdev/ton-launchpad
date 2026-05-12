import * as dotenv from 'dotenv';
import { TonClient, WalletContractV5R1, internal } from "@ton/ton";
import { mnemonicToWalletKey } from "@ton/crypto";
import { LaunchpadFactory } from "../wrappers/LaunchpadFactory";
import { toNano } from "@ton/core";

dotenv.config();

async function main() {
    const mnemonic = process.env.WALLET_MNEMONIC;
    const apiKey = process.env.TONCENTER_API_KEY;
    
    if (!mnemonic || !apiKey) {
        throw new Error("WALLET_MNEMONIC and TONCENTER_API_KEY must be set in .env");
    }

    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: apiKey,
    });

    const words = mnemonic.trim().split(/\s+/);
    const key = await mnemonicToWalletKey(words);
    const wallet = WalletContractV5R1.create({ publicKey: key.publicKey, workchain: 0 });
    const walletContract = client.open(wallet);
    const sender = walletContract.sender(key.secretKey);

    console.log("Using Wallet Address (v5R1):", wallet.address.toString({ testOnly: true, bounceable: false }));
    
    const balance = await walletContract.getBalance();
    console.log("Current Balance:", (Number(balance) / 1e9).toFixed(2), "TON");

    if (balance < toNano('0.2')) {
        throw new Error("Insufficient balance for deployment (need at least 0.2 TON)");
    }

    const factory = await LaunchpadFactory.fromInit(
        wallet.address, // Owner
        wallet.address, // Platform Wallet
        0n,             // tokenCount
    );
    const factoryAddress = factory.address;
    
    console.log("Factory will be deployed at:", factoryAddress.toString());

    const isDeployed = await client.isContractDeployed(factoryAddress);
    if (isDeployed) {
        console.log("Factory is already deployed!");
    } else {
        console.log("Deploying Factory...");
        
        await sender.send({
            to: factoryAddress,
            value: toNano("0.1"),
            bounce: false,
            init: factory.init,
            body: internal({
                to: factoryAddress,
                value: toNano("0.1"),
                body: "deploy"
            }).body,
        });
        
        console.log("Deployment message sent. Waiting for confirmation...");
        
        let attempt = 0;
        while (attempt < 20) {
            process.stdout.write(".");
            const deployed = await client.isContractDeployed(factoryAddress);
            if (deployed) {
                console.log("\nSuccess! LaunchpadFactory is live.");
                break;
            }
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    console.log("\n------------------------------------------------");
    console.log("FACTORY_ADDRESS=" + factoryAddress.toString());
    console.log("------------------------------------------------");
}

main().catch(console.error);
