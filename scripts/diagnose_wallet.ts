import * as dotenv from 'dotenv';
import { WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { mnemonicToWalletKey } from "@ton/crypto";

dotenv.config();

async function diagnose() {
    const mnemonic = process.env.WALLET_MNEMONIC;
    if (!mnemonic) return;
    
    // Use regex to handle multiple spaces
    const words = mnemonic.trim().split(/\s+/);
    console.log("Words count:", words.length);
    
    const key = await mnemonicToWalletKey(words);
    const target = "0QAyLd-uudWe8OMPxkeMh7wFkJgrdrYK4VI1waxmrAexb_R4";

    const versions = [
        { name: "v3R1", wallet: WalletContractV3R1.create({ publicKey: key.publicKey, workchain: 0 }) },
        { name: "v3R2", wallet: WalletContractV3R2.create({ publicKey: key.publicKey, workchain: 0 }) },
        { name: "v4R2", wallet: WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 }) },
        { name: "v5R1", wallet: WalletContractV5R1.create({ publicKey: key.publicKey, workchain: 0 }) },
    ];

    console.log("\nChecking versions for target:", target);
    for (const v of versions) {
        // Check bounceable and non-bounceable (testnet)
        const bounceable = v.wallet.address.toString({ testOnly: true, bounceable: true });
        const nonBounceable = v.wallet.address.toString({ testOnly: true, bounceable: false });
        
        console.log(`${v.name}:`);
        console.log(`  - Bounceable:     ${bounceable}`);
        console.log(`  - Non-Bounceable: ${nonBounceable}`);
        
        if (bounceable === target || nonBounceable === target) {
            console.log(`\n✅ MATCH FOUND: ${v.name}`);
        }
    }
}

diagnose();
