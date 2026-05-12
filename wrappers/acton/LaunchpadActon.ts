import {
  Address,
  Cell,
  Contract,
  ContractProvider,
  Sender,
  TupleBuilder,
  beginCell,
} from '@ton/core';

export const OP_BUY_TOKENS = 0x10001;
export const OP_SELL_TOKENS = 0x10002;
export const OP_MIGRATE_TO_STONFI = 0x10003;
export const OP_CONFIGURE_STONFI = 0x10005;
export const OP_RETRY_STONFI_MIGRATION = 0x10006;
export const OP_DEPLOY_TOKEN = 0x20001;
export const OP_UPDATE_STONFI_CONFIG = 0x20003;
export const OP_UPDATE_MIGRATION_MARKET_CAP = 0x20004;
export const OP_JETTON_TRANSFER = 0x0f8a7ea5;

export type StonfiMigrationConfig = {
  router: Address;
  ptonWallet: Address;
  routerTokenWallet: Address;
  lpReceiver: Address;
};

export type ReserveData = {
  virtualTonReserves: bigint;
  virtualTokenReserves: bigint;
  realTonReserves: bigint;
  realTokenReserves: bigint;
  currentSupply: bigint;
  migrationState: number;
};

export type QuoteResult = {
  amountOut: bigint;
  fee: bigint;
};

export type MarketData = {
  price: bigint;
  marketCapTon: bigint;
  migrationMarketCapTon: bigint;
  progressBps: bigint;
};

export function stonfiMigrationConfigCell(config: StonfiMigrationConfig): Cell {
  const routerConfig = beginCell()
    .storeAddress(config.router)
    .storeAddress(config.ptonWallet)
    .endCell();
  const receiverConfig = beginCell()
    .storeAddress(config.routerTokenWallet)
    .storeAddress(config.lpReceiver)
    .endCell();

  return beginCell()
    .storeRef(routerConfig)
    .storeRef(receiverConfig)
    .endCell();
}

export function buyTokensBody(queryId: bigint, minTokensOut: bigint = 0n): Cell {
  return beginCell()
    .storeUint(OP_BUY_TOKENS, 32)
    .storeUint(queryId, 64)
    .storeCoins(minTokensOut)
    .endCell();
}

export function sellForwardPayload(queryId: bigint, minTonOut: bigint = 0n): Cell {
  return beginCell()
    .storeUint(OP_SELL_TOKENS, 32)
    .storeUint(queryId, 64)
    .storeCoins(minTonOut)
    .endCell();
}

export function inlineForwardPayload(payload: Cell): Cell {
  return beginCell()
    .storeBit(0)
    .storeSlice(payload.beginParse())
    .endCell();
}

export function refForwardPayload(payload: Cell): Cell {
  return beginCell()
    .storeBit(1)
    .storeRef(payload)
    .endCell();
}

export function jettonTransferBody(args: {
  queryId: bigint;
  amount: bigint;
  destination: Address;
  responseDestination: Address | null;
  forwardTonAmount: bigint;
  forwardPayload: Cell;
  forwardPayloadByRef?: boolean;
}): Cell {
  const encodedForwardPayload = args.forwardPayloadByRef
    ? refForwardPayload(args.forwardPayload)
    : inlineForwardPayload(args.forwardPayload);

  return beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(args.queryId, 64)
    .storeCoins(args.amount)
    .storeAddress(args.destination)
    .storeAddress(args.responseDestination)
    .storeMaybeRef(null)
    .storeCoins(args.forwardTonAmount)
    .storeSlice(encodedForwardPayload.beginParse())
    .endCell();
}

export class BondingCurveActon implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static fromAddress(address: Address): BondingCurveActon {
    return new BondingCurveActon(address);
  }

  async sendBuy(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    queryId: bigint,
    minTokensOut: bigint = 0n,
  ): Promise<void> {
    await provider.internal(via, {
      value,
      bounce: true,
      body: buyTokensBody(queryId, minTokensOut),
    });
  }

  async sendMigrate(provider: ContractProvider, via: Sender, value: bigint, queryId: bigint): Promise<void> {
    await provider.internal(via, {
      value,
      bounce: true,
      body: beginCell()
        .storeUint(OP_MIGRATE_TO_STONFI, 32)
        .storeUint(queryId, 64)
        .endCell(),
    });
  }

  async sendConfigureStonfi(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    queryId: bigint,
    config: StonfiMigrationConfig,
  ): Promise<void> {
    await provider.internal(via, {
      value,
      bounce: true,
      body: beginCell()
        .storeUint(OP_CONFIGURE_STONFI, 32)
        .storeUint(queryId, 64)
        .storeRef(stonfiMigrationConfigCell(config))
        .endCell(),
    });
  }

  async sendRetryStonfi(provider: ContractProvider, via: Sender, value: bigint, queryId: bigint): Promise<void> {
    await provider.internal(via, {
      value,
      bounce: true,
      body: beginCell()
        .storeUint(OP_RETRY_STONFI_MIGRATION, 32)
        .storeUint(queryId, 64)
        .endCell(),
    });
  }

  async getReserves(provider: ContractProvider): Promise<ReserveData> {
    const source = (await provider.get('getReserves', [])).stack;
    return {
      virtualTonReserves: source.readBigNumber(),
      virtualTokenReserves: source.readBigNumber(),
      realTonReserves: source.readBigNumber(),
      realTokenReserves: source.readBigNumber(),
      currentSupply: source.readBigNumber(),
      migrationState: Number(source.readBigNumber()),
    };
  }

  async getBuyQuote(provider: ContractProvider, tonIn: bigint): Promise<QuoteResult> {
    const builder = new TupleBuilder();
    builder.writeNumber(tonIn);
    const source = (await provider.get('getBuyQuote', builder.build())).stack;
    return { amountOut: source.readBigNumber(), fee: source.readBigNumber() };
  }

  async getSellQuote(provider: ContractProvider, tokensIn: bigint): Promise<QuoteResult> {
    const builder = new TupleBuilder();
    builder.writeNumber(tokensIn);
    const source = (await provider.get('getSellQuote', builder.build())).stack;
    return { amountOut: source.readBigNumber(), fee: source.readBigNumber() };
  }

  async getMarketData(provider: ContractProvider): Promise<MarketData> {
    const source = (await provider.get('getMarketData', [])).stack;
    return {
      price: source.readBigNumber(),
      marketCapTon: source.readBigNumber(),
      migrationMarketCapTon: source.readBigNumber(),
      progressBps: source.readBigNumber(),
    };
  }

  async getMigrationState(provider: ContractProvider): Promise<number> {
    const source = (await provider.get('getMigrationState', [])).stack;
    return Number(source.readBigNumber());
  }

  async getJettonMaster(provider: ContractProvider): Promise<Address> {
    const source = (await provider.get('getJettonMaster', [])).stack;
    return source.readAddress();
  }
}

export class FeeJettonMasterActon implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static fromAddress(address: Address): FeeJettonMasterActon {
    return new FeeJettonMasterActon(address);
  }

  async getJettonData(provider: ContractProvider): Promise<{
    totalSupply: bigint;
    mintable: boolean;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
  }> {
    const source = (await provider.get('get_jetton_data', [])).stack;
    return {
      totalSupply: source.readBigNumber(),
      mintable: source.readBoolean(),
      adminAddress: source.readAddress(),
      jettonContent: source.readCell(),
      jettonWalletCode: source.readCell(),
    };
  }

  async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
    const source = (await provider.get('get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
    ])).stack;
    return source.readAddress();
  }
}

export class LaunchpadFactoryActon implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static fromAddress(address: Address): LaunchpadFactoryActon {
    return new LaunchpadFactoryActon(address);
  }

  async sendDeployToken(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    queryId: bigint,
    jettonContent: Cell,
    initialBuyTon: bigint = 0n,
  ): Promise<void> {
    await provider.internal(via, {
      value,
      bounce: true,
      body: beginCell()
        .storeUint(OP_DEPLOY_TOKEN, 32)
        .storeUint(queryId, 64)
        .storeRef(jettonContent)
        .storeCoins(initialBuyTon)
        .endCell(),
    });
  }

  async sendUpdateStonfiConfig(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    queryId: bigint,
    config: StonfiMigrationConfig,
  ): Promise<void> {
    await provider.internal(via, {
      value,
      bounce: true,
      body: beginCell()
        .storeUint(OP_UPDATE_STONFI_CONFIG, 32)
        .storeUint(queryId, 64)
        .storeRef(stonfiMigrationConfigCell(config))
        .endCell(),
    });
  }

  async sendUpdateMigrationMarketCap(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    queryId: bigint,
    migrationMarketCapTon: bigint,
  ): Promise<void> {
    await provider.internal(via, {
      value,
      bounce: true,
      body: beginCell()
        .storeUint(OP_UPDATE_MIGRATION_MARKET_CAP, 32)
        .storeUint(queryId, 64)
        .storeCoins(migrationMarketCapTon)
        .endCell(),
    });
  }

  async getTokenCount(provider: ContractProvider): Promise<bigint> {
    const source = (await provider.get('getTokenCount', [])).stack;
    return source.readBigNumber();
  }

  async getOwner(provider: ContractProvider): Promise<Address> {
    const source = (await provider.get('getOwner', [])).stack;
    return source.readAddress();
  }

  async getPlatformWallet(provider: ContractProvider): Promise<Address> {
    const source = (await provider.get('getPlatformWallet', [])).stack;
    return source.readAddress();
  }

  async getMigrationMarketCapTon(provider: ContractProvider): Promise<bigint> {
    const source = (await provider.get('getMigrationMarketCapTon', [])).stack;
    return source.readBigNumber();
  }
}
