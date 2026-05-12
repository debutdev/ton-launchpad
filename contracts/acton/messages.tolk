tolk 1.4

struct JettonWalletData {
    balance: coins
    owner: address
    minter: address
    code: cell
}

struct JettonMinterState {
    totalSupply: coins
    mintable: bool
    adminAddress: address
    jettonContent: cell
    jettonWalletCode: cell
}

struct (0b00001111100010100111111010100101) JettonTransfer {
    queryId: uint64
    amount: coins
    destination: address
    responseDestination: address?
    customPayload: cell?
    forwardTonAmount: coins
    forwardPayload: RemainingBitsAndRefs
}

struct (0b00010111100011010100010100011001) JettonTransferInternal {
    queryId: uint64
    amount: coins
    sender: address
    responseDestination: address?
    forwardTonAmount: coins
    forwardPayload: RemainingBitsAndRefs
}

struct (0b01110011011000101101000010011100) JettonNotification {
    queryId: uint64
    amount: coins
    sender: address
    forwardPayload: RemainingBitsAndRefs
}

struct (0b01011001010111110000011110111100) JettonBurn {
    queryId: uint64
    amount: coins
    responseDestination: address?
    customPayload: cell?
}

struct (0b01111011110111011001011111011110) JettonBurnNotification {
    queryId: uint64
    amount: coins
    sender: address
    responseDestination: address?
}

struct (0b11010101001100100111011011011011) JettonExcesses {
    queryId: uint64
}

struct (0b00101100011101101011100101110011) ProvideWalletAddress {
    queryId: uint64
    ownerAddress: address
    includeAddress: bool
}

struct (0b11010001011100110101010000000000) TakeWalletAddress {
    queryId: uint64
    walletAddress: address
    ownerAddress: cell?
}

struct (0b01100100001010110111110100000111) Mint {
    queryId: uint64
    receiver: address
    mintMessage: Cell<JettonTransferInternal>
}

struct (0b00010010001101000101011001111000) ChangeOwner {
    queryId: uint64
    newOwner: address
}

struct (0b00000000000000110000000000000001) CloseMint {
    queryId: uint64
}

struct (0b00000000000000010000000000000001) BuyTokens {
    queryId: uint64
    minTokensOut: coins
}

struct (0b00000000000000010000000000000010) SellTokens {
    queryId: uint64
    minTonOut: coins
}

struct (0b00000000000000010000000000000011) MigrateToStonfi {
    queryId: uint64
}

struct StonfiRouterConfig {
    router: address
    ptonWallet: address
}

struct StonfiReceiverConfig {
    routerTokenWallet: address
    lpReceiver: address
}

struct StonfiMigrationConfig {
    routerConfig: Cell<StonfiRouterConfig>
    receiverConfig: Cell<StonfiReceiverConfig>
}

struct (0b00000000000000010000000000000101) ConfigureStonfiMigration {
    queryId: uint64
    config: Cell<StonfiMigrationConfig>
}

struct (0b00000000000000010000000000000110) RetryStonfiMigration {
    queryId: uint64
}

struct (0b00000000000000100000000000000001) DeployToken {
    queryId: uint64
    jettonContent: cell
    initialBuyTon: coins
}

struct (0b00000000000000100000000000000010) TokenDeployed {
    queryId: uint64
    bondingCurveAddress: address
    jettonMasterAddress: address
    creator: address
}

struct (0b00000000000000100000000000000011) UpdateFactoryStonfiConfig {
    queryId: uint64
    config: Cell<StonfiMigrationConfig>
}

struct (0b00000000000000100000000000000100) UpdateFactoryMigrationMarketCap {
    queryId: uint64
    migrationMarketCapTon: coins
}

struct StonfiProvideLiquidityData {
    minLpOut: coins
    receiverAddress: address
    bothPositive: uint1
    fwdGas: coins
    customPayload: cell?
}

struct (0b00110111110000001001011011011111) StonfiProvideLiquidity {
    routerWalletAddress: address
    refundAddress: address
    excessesAddress: address
    deadline: uint64
    additionalData: Cell<StonfiProvideLiquidityData>
}

struct (0b00000001111100111000001101011101) PtonTonTransfer {
    queryId: uint64
    tonAmount: coins
    refundAddress: address
    forwardPayload: Cell<StonfiProvideLiquidity>?
}
