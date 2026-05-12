// Tonked.io — Shared Message Types
// Messages used across BondingCurve, JettonMaster, JettonWallet, and Factory

// ─── Jetton Standard Messages (TEP-74 / TEP-89) ─────────────────────────────

struct JettonWalletData {
    balance: Int;
    owner: Address;
    minter: Address;
    code: Cell;
}

struct JettonMinterState {
    totalSupply: Int as coins;
    mintable: Bool;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

message(0xf8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x178d4519) JettonTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x7362d09c) JettonNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

message(0x595f07bc) JettonBurn {
    queryId: Int as uint64;
    amount: Int as coins;
    responseDestination: Address?;
    customPayload: Cell?;
}

message(0x7bdd97de) JettonBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
}

message(0xd53276db) JettonExcesses {
    queryId: Int as uint64;
}

message(0x2c76b973) ProvideWalletAddress {
    queryId: Int as uint64;
    ownerAddress: Address;
    includeAddress: Bool;
}

message(0xd1735400) TakeWalletAddress {
    queryId: Int as uint64;
    walletAddress: Address;
    ownerAddress: Cell?;
}

message(0x642b7d07) Mint {
    queryId: Int as uint64;
    receiver: Address;
    mintMessage: JettonTransferInternal;
}

message(0x12345678) ChangeOwner {
    queryId: Int as uint64;
    newOwner: Address;
}

// ─── Bonding Curve Messages ──────────────────────────────────────────────────

// Buy tokens with TON. Sent directly to BondingCurve contract.
message(0x10001) BuyTokens {
    queryId: Int as uint64;
    minTokensOut: Int as coins; // slippage protection
}

// Sell tokens for TON. Sent as forward payload in JettonTransfer to BondingCurve's jetton wallet.
// The sell operation is embedded in the forwardPayload of a JettonNotification.
message(0x10002) SellTokens {
    queryId: Int as uint64;
    minTonOut: Int as coins; // slippage protection
}

// Force migration to the configured DEX. The name is kept for opcode compatibility.
message(0x10003) MigrateToStonfi {
    queryId: Int as uint64;
}

// Configure DeDust vault/pool addresses derived off-chain from the DeDust factory.
message(0x10005) ConfigureDedustMigration {
    queryId: Int as uint64;
    nativeVault: Address;
    jettonVault: Address;
    pool: Address;
}

// ─── Factory Messages ────────────────────────────────────────────────────────

message(0x20001) DeployToken {
    queryId: Int as uint64;
    jettonContent: Cell; // TEP-64 metadata cell (IPFS URL)
}

// Emitted by factory when a token is deployed
message(0x20002) TokenDeployed {
    queryId: Int as uint64;
    bondingCurveAddress: Address;
    jettonMasterAddress: Address;
    creator: Address;
}
