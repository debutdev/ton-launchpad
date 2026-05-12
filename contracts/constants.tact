// Tonked.io — Shared Constants
// Must match lib/bondingCurve.ts exactly

// 1 TON = 1,000,000,000 nanotons
const NANOS_PER_TON: Int = 1000000000;

// Pump.fun uses a 30 SOL virtual reserve. With SOL ~= 36 TON, mirror that
// curve in TON terms so token prices start at the same approximate USD value.
const SOL_TO_TON_SCALE: Int = 36;
const INITIAL_VIRTUAL_TON: Int = 30 * SOL_TO_TON_SCALE * NANOS_PER_TON;

// Initial virtual token reserves: 1,073,000,000 tokens (in nano-tokens)
const INITIAL_VIRTUAL_TOKENS: Int = 1073000000 * NANOS_PER_TON;

// Real token supply for bonding curve: 793,100,000 tokens
const REAL_TOKEN_SUPPLY: Int = 793100000 * NANOS_PER_TON;

// Production migration target: 85 SOL, denominated in TON.
// Keep the live testnet threshold low while DeDust migration is being tested.
const PRODUCTION_MIGRATION_THRESHOLD: Int = 85 * SOL_TO_TON_SCALE * NANOS_PER_TON;
const MIGRATION_THRESHOLD: Int = ton("0.2");
const MIGRATION_TOKEN_RESERVE: Int = 206900000 * NANOS_PER_TON;
const MIGRATION_GAS_RESERVE: Int = ton("0.8");

// Bonding curve TON fee is disabled. Revenue comes from token-level sell tax.
const FEE_BPS: Int = 0;
// Sell tax: 2% = 200 basis points. Applied by JettonWallet to sell/swap payloads.
const SELL_TAX_BPS: Int = 200;
const BPS_DENOMINATOR: Int = 10000;

// Deploy fee: 0.2 TON
const DEPLOY_FEE: Int = NANOS_PER_TON / 5;

// Minimum TON for storage rent
const MIN_TONS_FOR_STORAGE: Int = ton("0.01");

// Gas constants (approximate, verified in tests)
const GAS_FOR_TRANSFER: Int = 10500;
const GAS_FOR_BURN: Int = 6700;
const WALLET_STATE_INIT_CELLS: Int = 30;
const WALLET_STATE_INIT_BITS: Int = 20000;
const BASECHAIN: Int = 0;
const TAX_TRANSFER_GAS: Int = ton("0.04");
const OP_BONDING_CURVE_SELL: Int = 0x10002;
const OP_DEDUST_JETTON_SWAP: Int = 0xe3a0d482;
const OP_DEDUST_JETTON_DEPOSIT_LIQUIDITY: Int = 0x40e108d6;
const OP_DEDUST_NATIVE_DEPOSIT_LIQUIDITY: Int = 0xd55e4686;

// Dead address for LP lock (address with no private key)
const DEAD_ADDRESS: Address = address("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c");
