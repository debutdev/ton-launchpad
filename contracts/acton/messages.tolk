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

struct (0b00000000000000010000000000000011) MigrateToDedust {
    queryId: uint64
}

struct DedustMigrationConfig {
    nativeVault: address
    jettonVault: address
    pool: address
}

struct (0b00000000000000010000000000000101) ConfigureDedustMigration {
    queryId: uint64
    nativeVault: address
    jettonVault: address
    pool: address
}

struct (0b00000000000000010000000000000110) RetryDedustMigration {
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

struct (0b00000000000000100000000000000011) UpdateFactoryDedustConfig {
    queryId: uint64
    nativeVault: address
}

struct (0b00000000000000100000000000000100) UpdateFactoryMigrationMarketCap {
    queryId: uint64
    migrationMarketCapTon: coins
}
