import { mnemonicToWalletKey } from '@ton/crypto';
import { WalletContractV4, WalletContractV3R2, WalletContractV5R1, WalletContractV5Beta } from '@ton/ton';
import { Address } from '@ton/core';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    const mnemonic = process.env.WALLET_MNEMONIC!.split(' ');
    const key = await mnemonicToWalletKey(mnemonic);
    
    const target = Address.parse('0QAyLd-uudWe8OMPxkeMh7wFkJgrdrYK4VI1waxmrAexb_R4');
    console.log('Target:', target.toRawString());
    
    const versions: { name: string; addr: string }[] = [];
    
    const v4 = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    versions.push({ name: 'v4R2', addr: v4.address.toRawString() });
    
    const v3r2 = WalletContractV3R2.create({ publicKey: key.publicKey, workchain: 0 });
    versions.push({ name: 'v3R2', addr: v3r2.address.toRawString() });
    
    try {
        const v5r1 = WalletContractV5R1.create({ walletId: { networkGlobalId: -3 }, publicKey: key.publicKey });
        versions.push({ name: 'v5R1 (testnet)', addr: v5r1.address.toRawString() });
    } catch (e: any) { console.log('v5R1 testnet error:', e.message); }

    try {
        const v5r1m = WalletContractV5R1.create({ walletId: { networkGlobalId: -239 }, publicKey: key.publicKey });
        versions.push({ name: 'v5R1 (mainnet)', addr: v5r1m.address.toRawString() });
    } catch (e: any) { console.log('v5R1 mainnet error:', e.message); }

    try {
        const v5b = WalletContractV5Beta.create({ walletId: { networkGlobalId: -3 }, publicKey: key.publicKey });
        versions.push({ name: 'v5Beta (testnet)', addr: v5b.address.toRawString() });
    } catch (e: any) { console.log('v5Beta testnet error:', e.message); }

    try {
        const v5bm = WalletContractV5Beta.create({ walletId: { networkGlobalId: -239 }, publicKey: key.publicKey });
        versions.push({ name: 'v5Beta (mainnet)', addr: v5bm.address.toRawString() });
    } catch (e: any) { console.log('v5Beta mainnet error:', e.message); }

    for (const v of versions) {
        const match = v.addr === target.toRawString();
        console.log(`${v.name}: ${v.addr} ${match ? '✅ MATCH' : ''}`);
    }
}
main().catch(console.error);
