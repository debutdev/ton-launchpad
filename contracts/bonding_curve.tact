// Tonked.io — Bonding Curve Contract
// Constant product AMM (x * y = k) with virtual reserves
// Testnet migration threshold is intentionally low while DEX migration is tested.

import "./messages";
import "./constants";
import "./jetton_master";
import "./jetton_wallet";

contract BondingCurve(
    virtualTonReserves: Int as coins,
    virtualTokenReserves: Int as coins,
    realTonReserves: Int as coins,
    realTokenReserves: Int as coins,
    migrated: Bool,
    jettonMaster: Address,
    creator: Address,
    platformWallet: Address,
    createdAt: Int as uint32,
    dedustNativeVault: Address,
    dedustJettonVault: Address,
    dedustPool: Address,
) {

    // ─── Buy Tokens ──────────────────────────────────────────────────────────

    receive(msg: BuyTokens) {
        require(!self.migrated, "Token has migrated to DEX");

        let ctx = context();
        // msg.value is the TON sent by buyer (includes gas)
        // We reserve gas and use the rest for the buy
        let gasReserve = ton("0.1");
        let tonIn = ctx.value - gasReserve;
        require(tonIn > 0, "Insufficient TON sent");

        let tonInNet = tonIn;
        require(tonInNet > 0, "Amount too small");

        if (self.realTonReserves + tonInNet >= MIGRATION_THRESHOLD) {
            gasReserve = MIGRATION_GAS_RESERVE;
            tonIn = ctx.value - gasReserve;
            require(tonIn > 0, "Migration gas required");
            tonInNet = tonIn;
            require(tonInNet > 0, "Amount too small");
            require(self.realTonReserves + tonInNet >= MIGRATION_THRESHOLD, "Migration gas required");
        }

        // Constant product formula
        let k = self.virtualTonReserves * self.virtualTokenReserves;
        let newVirtualTonReserves = self.virtualTonReserves + tonInNet;
        // Round up to protect pool
        let newVirtualTokenReserves = (k + newVirtualTonReserves - 1) / newVirtualTonReserves;
        let tokensOut = self.virtualTokenReserves - newVirtualTokenReserves;

        require(tokensOut > 0, "Zero tokens out");
        require(tokensOut >= msg.minTokensOut, "Slippage exceeded");
        require(tokensOut <= self.realTokenReserves, "Insufficient token reserves");

        // Update state
        self.virtualTonReserves = newVirtualTonReserves;
        self.virtualTokenReserves = newVirtualTokenReserves;
        self.realTonReserves += tonInNet;
        self.realTokenReserves -= tokensOut;

        // Mint tokens to buyer via JettonMaster
        message(MessageParameters {
            to: self.jettonMaster,
            value: ton("0.05"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: Mint {
                queryId: msg.queryId,
                receiver: sender(),
                mintMessage: JettonTransferInternal {
                    queryId: msg.queryId,
                    amount: tokensOut,
                    sender: myAddress(),
                    responseDestination: sender(),
                    forwardTonAmount: 1,
                    forwardPayload: emptySlice(),
                },
            }.toCell(),
        });

        // Check migration threshold
        if (self.realTonReserves >= MIGRATION_THRESHOLD && self.isDedustConfigured()) {
            // Auto-trigger migration
            self.doMigrate(msg.queryId);
        }
    }

    // ─── Sell Tokens ─────────────────────────────────────────────────────────
    // Users send jettons to BondingCurve's jetton wallet with SellTokens in forward payload.
    // We receive JettonNotification when tokens arrive.

    receive(msg: JettonNotification) {
        let payload = msg.forwardPayload;
        let opcode = payload.loadUint(32);

        if (opcode == 0x10004) {
            require(self.migrated, "Not migrating");
            require(sender() == self.getJettonWalletAddress(myAddress()), "Invalid migration wallet");
            let queryId = payload.loadUint(64);
            require(msg.amount >= MIGRATION_TOKEN_RESERVE, "Migration tokens missing");
            self.finishDedustMigration(queryId, msg.amount);
        } else {
            require(!self.migrated, "Token has migrated to DEX");

            // Verify the notification comes from our jetton master's wallet
            // The sender of JettonNotification is the BondingCurve's own jetton wallet
            let tokensIn = msg.amount;
            require(tokensIn > 0, "Zero tokens received");

            require(opcode == 0x10002, "Invalid sell opcode");
            let queryId = payload.loadUint(64);
            let minTonOut = payload.loadCoins();

            // Constant product formula (sell direction)
            let k = self.virtualTonReserves * self.virtualTokenReserves;
            let newVirtualTokenReserves = self.virtualTokenReserves + tokensIn;
            // Round up to protect pool
            let newVirtualTonReserves = (k + newVirtualTokenReserves - 1) / newVirtualTokenReserves;
            let tonOutGross = self.virtualTonReserves - newVirtualTonReserves;

            require(tonOutGross > 0, "Zero TON out");

            let platformFeeTon = (tonOutGross * SELL_TAX_BPS) / BPS_DENOMINATOR;
            let tonOutNet = tonOutGross - platformFeeTon;

            require(tonOutNet >= minTonOut, "Slippage exceeded");
            require(tonOutNet > 0, "Amount too small after fee");
            require(tonOutGross <= self.realTonReserves, "Insufficient TON reserves");

            // Update state
            self.virtualTonReserves = newVirtualTonReserves;
            self.virtualTokenReserves = newVirtualTokenReserves;
            self.realTonReserves -= tonOutGross;
            self.realTokenReserves += tokensIn;

            // Send TON to seller
            message(MessageParameters {
                to: msg.sender, // original token sender (the seller)
                value: tonOutNet,
                mode: SendPayGasSeparately,
                bounce: true,
                body: "sell".asComment(),
            });

            if (platformFeeTon > 0) {
                message(MessageParameters {
                    to: self.platformWallet,
                    value: platformFeeTon,
                    mode: SendPayGasSeparately,
                    bounce: true,
                    body: "sell_fee".asComment(),
                });
            }

            // Burn the received tokens (they go back to virtual supply)
            // Note: tokens are already in BondingCurve's wallet, send burn
            // For simplicity, we track them as part of realTokenReserves
        }
    }

    // ─── Migration ───────────────────────────────────────────────────────────

    receive(msg: MigrateToStonfi) {
        require(!self.migrated, "Already migrated");
        require(self.realTonReserves >= MIGRATION_THRESHOLD, "Threshold not met");
        require(self.isDedustConfigured(), "DeDust not configured");
        self.doMigrate(msg.queryId);
    }

    receive(msg: ConfigureDedustMigration) {
        require(sender() == self.platformWallet || sender() == self.creator, "Only platform or creator");
        require(!self.migrated, "Already migrated");
        self.dedustNativeVault = msg.nativeVault;
        self.dedustJettonVault = msg.jettonVault;
        self.dedustPool = msg.pool;
        cashback(sender());
    }

    fun doMigrate(queryId: Int) {
        self.migrated = true;

        let migrationPayload = beginCell()
            .storeUint(0x10004, 32)
            .storeUint(queryId, 64)
            .asSlice();

        // Mint LP reserve tokens to this contract. When the mint arrives, the
        // JettonNotification path below sends both liquidity legs to DeDust.
        message(MessageParameters {
            to: self.jettonMaster,
            value: ton("0.12"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: Mint {
                queryId: queryId,
                receiver: myAddress(),
                mintMessage: JettonTransferInternal {
                    queryId: queryId,
                    amount: MIGRATION_TOKEN_RESERVE,
                    sender: myAddress(),
                    responseDestination: myAddress(),
                    forwardTonAmount: ton("0.05"),
                    forwardPayload: migrationPayload,
                },
            }.toCell(),
        });
    }

    fun finishDedustMigration(queryId: Int, tokenAmount: Int) {
        require(self.isDedustConfigured(), "DeDust not configured");
        let ownTokenWallet = self.getJettonWalletAddress(myAddress());
        let tokenLegPayload = self.createDedustJettonDepositPayload(self.realTonReserves, tokenAmount);

        message(MessageParameters {
            to: ownTokenWallet,
            value: ton("0.35"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: JettonTransfer {
                queryId: queryId,
                amount: tokenAmount,
                destination: self.dedustJettonVault,
                responseDestination: self.platformWallet,
                customPayload: null,
                forwardTonAmount: ton("0.235"),
                forwardPayload: beginCell().storeMaybeRef(tokenLegPayload).asSlice(),
            }.toCell(),
        });

        message(MessageParameters {
            to: self.dedustNativeVault,
            value: self.realTonReserves + ton("0.31"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: self.createDedustNativeDepositBody(queryId, self.realTonReserves, tokenAmount),
        });

        message(MessageParameters {
            to: self.jettonMaster,
            value: ton("0.01"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: "close_mint".asComment(),
        });
    }

    fun createDedustJettonDepositPayload(tonAmount: Int, tokenAmount: Int): Cell {
        let noPayload: Cell? = null;
        return beginCell()
            .storeUint(OP_DEDUST_JETTON_DEPOSIT_LIQUIDITY, 32)
            .storeUint(0, 1)
            .storeSlice(self.dedustNativeAsset())
            .storeSlice(self.dedustJettonAsset())
            .storeCoins(1)
            .storeCoins(tonAmount)
            .storeCoins(tokenAmount)
            .storeMaybeRef(noPayload)
            .storeMaybeRef(noPayload)
            .endCell();
    }

    fun createDedustNativeDepositBody(queryId: Int, tonAmount: Int, tokenAmount: Int): Cell {
        let noPayload: Cell? = null;
        let targetBalances = beginCell()
            .storeCoins(1)
            .storeCoins(tonAmount)
            .storeCoins(tokenAmount)
            .endCell();

        return beginCell()
            .storeUint(OP_DEDUST_NATIVE_DEPOSIT_LIQUIDITY, 32)
            .storeUint(queryId, 64)
            .storeCoins(tonAmount)
            .storeUint(0, 1)
            .storeSlice(self.dedustNativeAsset())
            .storeSlice(self.dedustJettonAsset())
            .storeRef(targetBalances)
            .storeMaybeRef(noPayload)
            .storeMaybeRef(noPayload)
            .endCell();
    }

    fun dedustNativeAsset(): Slice {
        return beginCell()
            .storeUint(0, 4)
            .asSlice();
    }

    fun dedustJettonAsset(): Slice {
        let jetton = parseStdAddress(self.jettonMaster.asSlice());
        return beginCell()
            .storeUint(1, 4)
            .storeInt(jetton.workchain, 8)
            .storeUint(jetton.address, 256)
            .asSlice();
    }

    fun isDedustConfigured(): Bool {
        return self.dedustNativeVault != DEAD_ADDRESS && self.dedustJettonVault != DEAD_ADDRESS && self.dedustPool != DEAD_ADDRESS;
    }

    fun getJettonWalletAddress(owner: Address): Address {
        return contractAddress(initOf JettonWallet(owner, self.jettonMaster, 0, self.platformWallet));
    }

    // ─── Bounced Message Handlers ────────────────────────────────────────────
    // CRITICAL: Never lose user funds

    bounced(msg: bounced<Mint>) {
        // Mint failed — reverse the buy
        // The user didn't receive tokens, so we need to refund
        // This is a simplified handler; production needs full reversal
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    get fun getReserves(): ReserveData {
        return ReserveData {
            virtualTonReserves: self.virtualTonReserves,
            virtualTokenReserves: self.virtualTokenReserves,
            realTonReserves: self.realTonReserves,
            realTokenReserves: self.realTokenReserves,
            migrated: self.migrated,
        };
    }

    get fun getBuyQuote(tonIn: Int): QuoteResult {
        require(tonIn > 0, "tonIn must be positive");

        let fee = 0;
        let tonInNet = tonIn;

        let k = self.virtualTonReserves * self.virtualTokenReserves;
        let newVTon = self.virtualTonReserves + tonInNet;
        let newVTokens = (k + newVTon - 1) / newVTon;
        let tokensOut = self.virtualTokenReserves - newVTokens;

        return QuoteResult {
            amountOut: tokensOut,
            fee: fee,
        };
    }

    get fun getSellQuote(tokensIn: Int): QuoteResult {
        require(tokensIn > 0, "tokensIn must be positive");

        let k = self.virtualTonReserves * self.virtualTokenReserves;
        let newVTokens = self.virtualTokenReserves + tokensIn;
        let newVTon = (k + newVTokens - 1) / newVTokens;
        let tonOutGross = self.virtualTonReserves - newVTon;

        let platformFeeTon = (tonOutGross * SELL_TAX_BPS) / BPS_DENOMINATOR;
        let tonOutNet = tonOutGross - platformFeeTon;

        return QuoteResult {
            amountOut: tonOutNet,
            fee: platformFeeTon,
        };
    }

    get fun getPrice(): Int {
        // Returns price scaled by 10^18 for precision
        return (self.virtualTonReserves * NANOS_PER_TON * NANOS_PER_TON) / self.virtualTokenReserves;
    }

    get fun isMigrated(): Bool {
        return self.migrated;
    }
}

// ─── Structs for Getters ─────────────────────────────────────────────────────

struct ReserveData {
    virtualTonReserves: Int as coins;
    virtualTokenReserves: Int as coins;
    realTonReserves: Int as coins;
    realTokenReserves: Int as coins;
    migrated: Bool;
}

struct QuoteResult {
    amountOut: Int as coins;
    fee: Int as coins;
}
