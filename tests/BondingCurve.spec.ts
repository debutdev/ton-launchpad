/**
 * Tonked.io — BondingCurve Contract Tests
 * Tests the BondingCurve contract using @ton/sandbox
 */

import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, beginCell, Address } from '@ton/core';
import { BondingCurve } from '../build/BondingCurve/BondingCurve_BondingCurve';
import { JettonMaster } from '../build/BondingCurve/BondingCurve_JettonMaster';
import { JettonWallet } from '../build/BondingCurve/BondingCurve_JettonWallet';
import '@ton/test-utils';
import {
  BPS_DENOMINATOR,
  getBuyQuote as tsBuyQuote,
  getSellQuote as tsSellQuote,
  INITIAL_VIRTUAL_TON,
  INITIAL_VIRTUAL_TOKENS,
  REAL_TOKEN_SUPPLY,
  MIGRATION_TOKEN_RESERVE,
  SELL_TAX_BPS,
} from '../lib/bondingCurve';

const DEAD_ADDRESS = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');

describe('BondingCurve Contract', () => {
  let blockchain: Blockchain;
  let deployer: SandboxContract<TreasuryContract>;
  let platformWallet: SandboxContract<TreasuryContract>;
  let buyer: SandboxContract<TreasuryContract>;
  let bondingCurve: SandboxContract<BondingCurve>;
  let jettonMaster: SandboxContract<JettonMaster>;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    deployer = await blockchain.treasury('deployer');
    platformWallet = await blockchain.treasury('platform');
    buyer = await blockchain.treasury('buyer');

    // First, we need to compute the BondingCurve address to set as JettonMaster owner
    // Deploy JettonMaster with a placeholder first, then set up correctly

    const metadataCell = beginCell()
      .storeUint(1, 8) // off-chain metadata flag
      .storeStringTail('ipfs://test-metadata')
      .endCell();

    // Compute BC address first (deterministic)
    const bcFromInit = await BondingCurve.fromInit(
      INITIAL_VIRTUAL_TON,
      INITIAL_VIRTUAL_TOKENS,
      0n,
      REAL_TOKEN_SUPPLY,
      false,
      deployer.address, // placeholder for jettonMaster — will compute real one
      deployer.address,
      platformWallet.address,
      BigInt(Math.floor(Date.now() / 1000)),
      DEAD_ADDRESS,
      DEAD_ADDRESS,
      DEAD_ADDRESS,
    );

    // Now compute JettonMaster with BC address as owner
    jettonMaster = blockchain.openContract(
      await JettonMaster.fromInit(
        0n,
        deployer.address, // temporary owner, matching the factory ChangeOwner flow
        deployer.address, // factory placeholder for direct unit tests
        platformWallet.address,
        metadataCell,
        true, // mintable
      ),
    );

    // Now create the real BondingCurve with correct jettonMaster address
    bondingCurve = blockchain.openContract(
      await BondingCurve.fromInit(
        INITIAL_VIRTUAL_TON,
        INITIAL_VIRTUAL_TOKENS,
        0n,
        REAL_TOKEN_SUPPLY,
        false,
        jettonMaster.address,
        deployer.address,
        platformWallet.address,
        BigInt(Math.floor(Date.now() / 1000)),
        DEAD_ADDRESS,
        DEAD_ADDRESS,
        DEAD_ADDRESS,
      ),
    );

    // Deploy both contracts
    const bcDeployResult = await bondingCurve.send(
      deployer.getSender(),
      { value: toNano('0.05') },
      { $$type: 'BuyTokens', queryId: 0n, minTokensOut: 0n }, // Will fail but deploy succeeds
    );

    const jmDeployResult = await jettonMaster.send(
      deployer.getSender(),
      { value: toNano('0.05') },
      { $$type: 'ProvideWalletAddress', queryId: 0n, ownerAddress: deployer.address, includeAddress: false },
    );

    await jettonMaster.send(
      deployer.getSender(),
      { value: toNano('0.05') },
      { $$type: 'ChangeOwner', queryId: 0n, newOwner: bondingCurve.address },
    );
  });

  async function getWalletBalance(owner: Address): Promise<bigint> {
    const walletAddress = await jettonMaster.getGetWalletAddress(owner);
    const wallet = blockchain.openContract(JettonWallet.fromAddress(walletAddress));
    try {
      return (await wallet.getGetWalletData()).balance;
    } catch {
      return 0n;
    }
  }

  async function buyForBuyer(value: bigint = toNano('0.2')): Promise<bigint> {
    await bondingCurve.send(
      buyer.getSender(),
      { value },
      { $$type: 'BuyTokens', queryId: 1n, minTokensOut: 0n },
    );

    return getWalletBalance(buyer.address);
  }

  it('should deploy and have correct initial reserves', async () => {
    const reserves = await bondingCurve.getGetReserves();
    expect(reserves.virtualTonReserves).toBe(INITIAL_VIRTUAL_TON);
    expect(reserves.virtualTokenReserves).toBe(INITIAL_VIRTUAL_TOKENS);
    expect(reserves.realTonReserves).toBe(0n);
    expect(reserves.realTokenReserves).toBe(REAL_TOKEN_SUPPLY);
    expect(reserves.migrated).toBe(false);
  });

  it('should not be migrated initially', async () => {
    const migrated = await bondingCurve.getIsMigrated();
    expect(migrated).toBe(false);
  });

  it('should return a valid price', async () => {
    const price = await bondingCurve.getGetPrice();
    expect(price).toBeGreaterThan(0n);
  });

  it('getBuyQuote getter matches TypeScript math', async () => {
    const tonIn = toNano('1'); // 1 TON

    // Contract getter
    const contractQuote = await bondingCurve.getGetBuyQuote(tonIn);

    // TypeScript math
    const tsQuote = tsBuyQuote(tonIn, INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);

    // They must match EXACTLY
    expect(contractQuote.amountOut).toBe(tsQuote.tokensOut);
    expect(contractQuote.fee).toBe(tsQuote.fee);
  });

  it('getBuyQuote getter matches for multiple amounts', async () => {
    const amounts = [
      toNano('0.1'),
      toNano('0.5'),
      toNano('1'),
      toNano('5'),
      toNano('10'),
      toNano('50'),
    ];

    for (const tonIn of amounts) {
      const contractQuote = await bondingCurve.getGetBuyQuote(tonIn);
      const tsQuote = tsBuyQuote(tonIn, INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);

      expect(contractQuote.amountOut).toBe(tsQuote.tokensOut);
      expect(contractQuote.fee).toBe(tsQuote.fee);
    }
  });

  it('buy transaction updates reserves correctly', async () => {
    const tonIn = toNano('0.1');

    const reservesBefore = await bondingCurve.getGetReserves();

    const result = await bondingCurve.send(
      buyer.getSender(),
      { value: tonIn + toNano('0.1') },
      { $$type: 'BuyTokens', queryId: 1n, minTokensOut: 0n },
    );

    // Check transaction succeeded
    expect(result.transactions).toHaveTransaction({
      from: buyer.address,
      to: bondingCurve.address,
      success: true,
    });

    const reservesAfter = await bondingCurve.getGetReserves();

    // Virtual TON reserves should have increased
    expect(reservesAfter.virtualTonReserves).toBeGreaterThan(reservesBefore.virtualTonReserves);
    // Virtual token reserves should have decreased
    expect(reservesAfter.virtualTokenReserves).toBeLessThan(reservesBefore.virtualTokenReserves);
    // Real TON reserves should have increased
    expect(reservesAfter.realTonReserves).toBeGreaterThan(reservesBefore.realTonReserves);
    // Real token reserves should have decreased
    expect(reservesAfter.realTokenReserves).toBeLessThan(reservesBefore.realTokenReserves);
  });

  it('price increases after buy', async () => {
    const priceBefore = await bondingCurve.getGetPrice();

    await bondingCurve.send(
      buyer.getSender(),
      { value: toNano('0.2') },
      { $$type: 'BuyTokens', queryId: 1n, minTokensOut: 0n },
    );

    const priceAfter = await bondingCurve.getGetPrice();
    expect(priceAfter).toBeGreaterThan(priceBefore);
  });

  it('does not send a bonding-curve TON fee to platform wallet on buy', async () => {
    const result = await bondingCurve.send(
      buyer.getSender(),
      { value: toNano('0.2') },
      { $$type: 'BuyTokens', queryId: 1n, minTokensOut: 0n },
    );

    expect(result.transactions).not.toHaveTransaction({
      from: bondingCurve.address,
      to: platformWallet.address,
    });
  });

  it('sends 2% TON fee to platform wallet on bonding-curve sells', async () => {
    const tokensBought = await buyForBuyer();

    const reservesBeforeSell = await bondingCurve.getGetReserves();
    const contractQuote = await bondingCurve.getGetSellQuote(tokensBought);
    const tsQuote = tsSellQuote(
      tokensBought,
      reservesBeforeSell.virtualTonReserves,
      reservesBeforeSell.virtualTokenReserves,
    );
    expect(contractQuote.amountOut).toBe(tsQuote.tonOut);
    expect(contractQuote.fee).toBe(tsQuote.fee);

    const buyerWalletAddress = await jettonMaster.getGetWalletAddress(buyer.address);
    const buyerWallet = blockchain.openContract(JettonWallet.fromAddress(buyerWalletAddress));
    const platformTonBefore = await platformWallet.getBalance();
    const sellPayload = beginCell()
      .storeBit(0)
      .storeUint(0x10002, 32)
      .storeUint(2n, 64)
      .storeCoins(0)
      .endCell()
      .beginParse();

    const result = await buyerWallet.send(
      buyer.getSender(),
      { value: toNano('0.3') },
      {
        $$type: 'JettonTransfer',
        queryId: 2n,
        amount: tokensBought,
        destination: bondingCurve.address,
        responseDestination: buyer.address,
        customPayload: null,
        forwardTonAmount: toNano('0.15'),
        forwardPayload: sellPayload,
      },
    );

    expect(result.transactions).toHaveTransaction({
      from: bondingCurve.address,
      to: buyer.address,
      success: true,
    });

    expect(result.transactions).toHaveTransaction({
      from: bondingCurve.address,
      to: platformWallet.address,
      value: contractQuote.fee,
      success: true,
    });

    const platformTonAfter = await platformWallet.getBalance();
    expect(platformTonAfter - platformTonBefore).toBeGreaterThan(0n);

    const platformTokenBalance = await getWalletBalance(platformWallet.address);
    expect(platformTokenBalance).toBe(0n);

    const curveTokenBalance = await getWalletBalance(bondingCurve.address);
    expect(curveTokenBalance).toBe(tokensBought);
  });

  it('does not tax normal wallet-to-wallet transfers', async () => {
    const tokensBought = await buyForBuyer();
    const recipient = await blockchain.treasury('recipient');
    const transferAmount = tokensBought / 3n;
    const platformBefore = await getWalletBalance(platformWallet.address);

    const buyerWalletAddress = await jettonMaster.getGetWalletAddress(buyer.address);
    const buyerWallet = blockchain.openContract(JettonWallet.fromAddress(buyerWalletAddress));

    await buyerWallet.send(
      buyer.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'JettonTransfer',
        queryId: 3n,
        amount: transferAmount,
        destination: recipient.address,
        responseDestination: buyer.address,
        customPayload: null,
        forwardTonAmount: 0n,
        forwardPayload: beginCell().endCell().beginParse(),
      },
    );

    expect(await getWalletBalance(recipient.address)).toBe(transferAmount);
    expect(await getWalletBalance(platformWallet.address)).toBe(platformBefore);
  });

  it('does not tax platform-owned sell transfers', async () => {
    await bondingCurve.send(
      platformWallet.getSender(),
      { value: toNano('0.2') },
      { $$type: 'BuyTokens', queryId: 4n, minTokensOut: 0n },
    );

    const platformTokens = await getWalletBalance(platformWallet.address);
    const platformWalletAddress = await jettonMaster.getGetWalletAddress(platformWallet.address);
    const platformTokenWallet = blockchain.openContract(JettonWallet.fromAddress(platformWalletAddress));
    const sellPayload = beginCell()
      .storeUint(0x10002, 32)
      .storeUint(5n, 64)
      .storeCoins(0)
      .endCell()
      .beginParse();

    await platformTokenWallet.send(
      platformWallet.getSender(),
      { value: toNano('0.3') },
      {
        $$type: 'JettonTransfer',
        queryId: 5n,
        amount: platformTokens,
        destination: bondingCurve.address,
        responseDestination: platformWallet.address,
        customPayload: null,
        forwardTonAmount: toNano('0.15'),
        forwardPayload: sellPayload,
      },
    );

    expect(await getWalletBalance(platformWallet.address)).toBe(0n);
    expect(await getWalletBalance(bondingCurve.address)).toBe(platformTokens);
  });

  it('taxes DeDust jetton swap payloads but leaves LP-style transfers untaxed', async () => {
    const tokensBought = await buyForBuyer();
    const dedustVault = await blockchain.treasury('dedust-vault');
    const swapAmount = tokensBought / 4n;
    const lpAmount = tokensBought / 5n;
    const swapTax = (swapAmount * SELL_TAX_BPS) / BPS_DENOMINATOR;

    const buyerWalletAddress = await jettonMaster.getGetWalletAddress(buyer.address);
    const buyerWallet = blockchain.openContract(JettonWallet.fromAddress(buyerWalletAddress));

    await buyerWallet.send(
      buyer.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'JettonTransfer',
        queryId: 4n,
        amount: swapAmount,
        destination: dedustVault.address,
        responseDestination: buyer.address,
        customPayload: null,
        forwardTonAmount: 0n,
        forwardPayload: beginCell()
          .storeMaybeRef(beginCell().storeUint(0xe3a0d482, 32).endCell())
          .endCell()
          .beginParse(),
      },
    );

    expect(await getWalletBalance(platformWallet.address)).toBe(swapTax);
    expect(await getWalletBalance(dedustVault.address)).toBe(swapAmount - swapTax);

    await buyerWallet.send(
      buyer.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'JettonTransfer',
        queryId: 5n,
        amount: lpAmount,
        destination: dedustVault.address,
        responseDestination: buyer.address,
        customPayload: null,
        forwardTonAmount: 0n,
        forwardPayload: beginCell()
          .storeMaybeRef(beginCell().storeUint(0x40e108d6, 32).endCell())
          .endCell()
          .beginParse(),
      },
    );

    expect(await getWalletBalance(platformWallet.address)).toBe(swapTax);
    expect(await getWalletBalance(dedustVault.address)).toBe((swapAmount - swapTax) + lpAmount);
  });

  it('sends mint message to JettonMaster on buy', async () => {
    const result = await bondingCurve.send(
      buyer.getSender(),
      { value: toNano('0.2') },
      { $$type: 'BuyTokens', queryId: 1n, minTokensOut: 0n },
    );

    // Should have a transaction to JettonMaster (mint)
    expect(result.transactions).toHaveTransaction({
      from: bondingCurve.address,
      to: jettonMaster.address,
    });
  });

  it('rejects buy with insufficient value', async () => {
    const result = await bondingCurve.send(
      buyer.getSender(),
      { value: toNano('0.05') }, // Too low — only covers gas
      { $$type: 'BuyTokens', queryId: 1n, minTokensOut: 0n },
    );

    expect(result.transactions).toHaveTransaction({
      from: buyer.address,
      to: bondingCurve.address,
      success: false,
    });
  });

  it('sequential buys increase price monotonically', async () => {
    let prevPrice = await bondingCurve.getGetPrice();

    for (let i = 0; i < 2; i++) {
      await bondingCurve.send(
        buyer.getSender(),
        { value: toNano('0.15') },
        { $$type: 'BuyTokens', queryId: BigInt(i + 1), minTokensOut: 0n },
      );

      const newPrice = await bondingCurve.getGetPrice();
      expect(newPrice).toBeGreaterThan(prevPrice);
      prevPrice = newPrice;
    }
  });

  it('auto-migrates when a buy crosses the low test threshold', async () => {
    const ownTokenWallet = await jettonMaster.getGetWalletAddress(bondingCurve.address);
    const dedustNativeVault = await blockchain.treasury('dedust-native-vault');
    const dedustJettonVault = await blockchain.treasury('dedust-jetton-vault');
    const dedustPool = await blockchain.treasury('dedust-pool');
    const dedustJettonVaultTokenWallet = await jettonMaster.getGetWalletAddress(dedustJettonVault.address);

    await bondingCurve.send(
      platformWallet.getSender(),
      { value: toNano('0.05') },
      {
        $$type: 'ConfigureDedustMigration',
        queryId: 10n,
        nativeVault: dedustNativeVault.address,
        jettonVault: dedustJettonVault.address,
        pool: dedustPool.address,
      },
    );

    const result = await bondingCurve.send(
      buyer.getSender(),
      { value: toNano('1.1') },
      { $$type: 'BuyTokens', queryId: 1n, minTokensOut: 0n },
    );

    expect(result.transactions).toHaveTransaction({
      from: buyer.address,
      to: bondingCurve.address,
      success: true,
    });

    const reserves = await bondingCurve.getGetReserves();
    expect(reserves.realTonReserves).toBeGreaterThanOrEqual(toNano('0.2'));
    expect(reserves.migrated).toBe(true);

    expect(result.transactions).toHaveTransaction({
      from: bondingCurve.address,
      to: ownTokenWallet,
      success: true,
    });
    expect(result.transactions).toHaveTransaction({
      from: bondingCurve.address,
      to: dedustNativeVault.address,
    });
    expect(result.transactions).toHaveTransaction({
      from: ownTokenWallet,
      to: dedustJettonVaultTokenWallet,
    });

    const jettonData = await jettonMaster.getGetJettonData();
    expect(jettonData.totalSupply).toBeGreaterThanOrEqual(MIGRATION_TOKEN_RESERVE);
    expect(jettonData.mintable).toBe(false);

    const blockedBuy = await bondingCurve.send(
      buyer.getSender(),
      { value: toNano('0.2') },
      { $$type: 'BuyTokens', queryId: 2n, minTokensOut: 0n },
    );

    expect(blockedBuy.transactions).toHaveTransaction({
      from: buyer.address,
      to: bondingCurve.address,
      success: false,
    });
  });
});
