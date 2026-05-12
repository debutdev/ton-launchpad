tolk 1.4

import "@contracts/acton/constants"
import "@contracts/acton/helpers"
import "@contracts/acton/messages"

struct BondingStonfiConfig {
    routerConfig: Cell<BondingStonfiRouterConfig>
    receiverConfig: Cell<BondingStonfiReceiverConfig>
}

struct BondingStonfiRouterConfig {
    router: address
    ptonWallet: address
}

struct BondingStonfiReceiverConfig {
    routerTokenWallet: address
    lpReceiver: address
}

struct BondingCodeConfig {
    walletCode: cell
}

struct BondingIdentityConfig {
    jettonMaster: address
    creator: address
    platformWallet: address
}

struct BondingStorage {
    virtualTonReserves: coins
    virtualTokenReserves: coins
    realTonReserves: coins
    realTokenReserves: coins
    currentSupply: coins
    migrationState: uint8
    createdAt: uint32
    migrationMarketCapTon: coins
    identityConfig: Cell<BondingIdentityConfig>
    stonfiConfig: Cell<BondingStonfiConfig>
    codeConfig: Cell<BondingCodeConfig>
}

struct ReserveData {
    virtualTonReserves: coins
    virtualTokenReserves: coins
    realTonReserves: coins
    realTokenReserves: coins
    currentSupply: coins
    migrationState: uint8
}

struct QuoteResult {
    amountOut: coins
    fee: coins
}

struct MarketData {
    price: int
    marketCapTon: coins
    migrationMarketCapTon: coins
    progressBps: int
}

struct BondingWalletStorageData {
    owner: address
    minter: address
    balance: coins
    platformWallet: address
}

fun BondingStorage.load(): BondingStorage {
    return BondingStorage.fromCell(contract.getData());
}

fun BondingStorage.save(self): void {
    contract.setData(self.toCell());
}

fun bondingWalletState(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): ContractState {
    return ContractState {
        code: walletCode,
        data: BondingWalletStorageData {
            owner,
            minter,
            balance: 0,
            platformWallet,
        }.toCell(),
    };
}

fun bondingWalletAddress(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): address {
    return AutoDeployAddress {
        workchain: BASECHAIN,
        stateInit: bondingWalletState(owner, minter, platformWallet, walletCode),
    }.calculateAddress();
}

fun getMarketCapTon(virtualTonReserves: coins, virtualTokenReserves: coins): coins {
    return (virtualTonReserves * TOTAL_SUPPLY) / virtualTokenReserves;
}

fun getPriceScaled(virtualTonReserves: coins, virtualTokenReserves: coins): int {
    return (virtualTonReserves * NANOS_PER_TON * NANOS_PER_TON) / virtualTokenReserves;
}

fun quoteBuyTokens(tonIn: coins, virtualTonReserves: coins, virtualTokenReserves: coins): coins {
    val k = virtualTonReserves * virtualTokenReserves;
    val newVirtualTonReserves = virtualTonReserves + tonIn;
    val newVirtualTokenReserves = ceilDiv(k, newVirtualTonReserves);
    return virtualTokenReserves - newVirtualTokenReserves;
}

fun quoteSellTon(
    tokensInNet: coins,
    virtualTonReserves: coins,
    virtualTokenReserves: coins,
): coins {
    val k = virtualTonReserves * virtualTokenReserves;
    val newVirtualTokenReserves = virtualTokenReserves + tokensInNet;
    val newVirtualTonReserves = ceilDiv(k, newVirtualTokenReserves);
    return virtualTonReserves - newVirtualTonReserves;
}

fun isStonfiConfigured(storage: BondingStorage): bool {
    val config = storage.stonfiConfig.load();
    val routerConfig = config.routerConfig.load();
    val receiverConfig = config.receiverConfig.load();
    return routerConfig.router != DEAD_ADDRESS && routerConfig.ptonWallet != DEAD_ADDRESS &&
    receiverConfig.routerTokenWallet != DEAD_ADDRESS;
}

fun ownJettonWallet(storage: BondingStorage): address {
    val identity = storage.identityConfig.load();
    val codeConfig = storage.codeConfig.load();
    return bondingWalletAddress(
        contract.getAddress(),
        identity.jettonMaster,
        identity.platformWallet,
        codeConfig.walletCode,
    );
}

fun sendMint(
    storage: BondingStorage,
    queryId: int,
    receiver: address,
    amount: coins,
    responseDestination: address,
    forwardTonAmount: coins,
    forwardPayload: RemainingBitsAndRefs,
    value: coins,
): void {
    val identity = storage.identityConfig.load();
    val transfer = JettonTransferInternal {
        queryId,
        amount,
        sender: contract.getAddress(),
        responseDestination,
        forwardTonAmount,
        forwardPayload,
    };

    val mintMsg = createMessage({
        bounce: BounceMode.Only256BitsOfBody,
        value,
        dest: identity.jettonMaster,
        body: Mint {
            queryId,
            receiver,
            mintMessage: transfer.toCell(),
        },
    });
    mintMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
}

fun makeStonfiProvidePayload(
    routerWalletAddress: address,
    refundAddress: address,
    excessesAddress: address,
    receiverAddress: address,
    deadline: int,
): Cell<StonfiProvideLiquidity> {
    return StonfiProvideLiquidity {
        routerWalletAddress,
        refundAddress,
        excessesAddress,
        deadline,
        additionalData: StonfiProvideLiquidityData {
            minLpOut: 1,
            receiverAddress,
            bothPositive: 1,
            fwdGas: 0,
            customPayload: null,
        }.toCell(),
    }.toCell();
}

fun sendStonfiLiquidity(storage: BondingStorage, queryId: int, tokenAmount: coins, now: int): void {
    val deadline = now + 900;
    val ownWallet = ownJettonWallet(storage);
    val identity = storage.identityConfig.load();
    val config = storage.stonfiConfig.load();
    val routerConfig = config.routerConfig.load();
    val receiverConfig = config.receiverConfig.load();

    val jettonLegPayload = makeStonfiProvidePayload(
        routerConfig.ptonWallet,
        contract.getAddress(),
        identity.platformWallet,
        receiverConfig.lpReceiver,
        deadline,
    );

    val jettonLiquidityMsg = createMessage({
        bounce: BounceMode.Only256BitsOfBody,
        value: 350000000,
        dest: ownWallet,
        body: JettonTransfer {
            queryId,
            amount: tokenAmount,
            destination: routerConfig.router,
            responseDestination: identity.platformWallet,
            customPayload: null,
            forwardTonAmount: 235000000,
            forwardPayload: refForwardPayload(jettonLegPayload as cell),
        },
    });
    jettonLiquidityMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);

    val tonLegPayload = makeStonfiProvidePayload(
        receiverConfig.routerTokenWallet,
        contract.getAddress(),
        identity.platformWallet,
        receiverConfig.lpReceiver,
        deadline,
    );

    val tonLiquidityMsg = createMessage({
        bounce: BounceMode.Only256BitsOfBody,
        value: storage.realTonReserves + 310000000,
        dest: routerConfig.ptonWallet,
        body: PtonTonTransfer {
            queryId,
            tonAmount: storage.realTonReserves,
            refundAddress: contract.getAddress(),
            forwardPayload: tonLegPayload,
        },
    });
    tonLiquidityMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);

    val closeMintMsg = createMessage({
        bounce: BounceMode.NoBounce,
        value: 10000000,
        dest: identity.jettonMaster,
        body: CloseMint { queryId },
    });
    closeMintMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_IGNORE_ERRORS);
}

fun beginMigration(mutatingStorage: BondingStorage, queryId: int): BondingStorage {
    var storage = mutatingStorage;
    assert (
        storage.migrationState == MIGRATION_STATE_ACTIVE ||
        storage.migrationState == MIGRATION_STATE_FAILED
    ) throw 601;
    assert (isStonfiConfigured(storage)) throw 602;

    val remainingToMint = TOTAL_SUPPLY - storage.currentSupply;
    assert (remainingToMint > 0) throw 603;

    storage.migrationState = MIGRATION_STATE_MIGRATING;
    storage.currentSupply = TOTAL_SUPPLY;

    val migrationPayload = beginCell()
        .storeUint(OP_INTERNAL_MIGRATION_MINT, 32)
        .storeUint(queryId, 64)
        .endCell()
        .beginParse();

    sendMint(
        storage,
        queryId,
        contract.getAddress(),
        remainingToMint,
        contract.getAddress(),
        50000000,
        inlineForwardPayload(migrationPayload),
        120000000,
    );
    return storage;
}

type BondingAllowedMessage =
    | BuyTokens
    | JettonNotification
    | MigrateToStonfi
    | ConfigureStonfiMigration
    | RetryStonfiMigration

contract BondingCurve {
    author: "Tonked"
    version: "0.1.0"
    description: "Pump.fun-style bonding curve with STON.fi migration"
    storage: BondingStorage
    incomingMessages: BondingAllowedMessage
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
    }

    val msg = lazy BondingAllowedMessage.fromSlice(in.body);

    match (msg) {
        BuyTokens => {
            var storage = BondingStorage.load();
            assert (storage.migrationState == MIGRATION_STATE_ACTIVE) throw 604;

            var gasReserve = BUY_GAS_RESERVE;
            var tonIn = in.valueCoins - gasReserve;
            assert (tonIn > 0) throw 605;

            var tokensOut = quoteBuyTokens(
                tonIn,
                storage.virtualTonReserves,
                storage.virtualTokenReserves,
            );
            var newVirtualTonReserves = storage.virtualTonReserves + tonIn;
            var newVirtualTokenReserves = storage.virtualTokenReserves - tokensOut;
            var crossesMigration = getMarketCapTon(
                newVirtualTonReserves,
                newVirtualTokenReserves,
            ) >=
            storage.migrationMarketCapTon;

            if (crossesMigration) {
                gasReserve = MIGRATION_GAS_RESERVE;
                tonIn = in.valueCoins - gasReserve;
                assert (tonIn > 0) throw 606;
                tokensOut = quoteBuyTokens(
                    tonIn,
                    storage.virtualTonReserves,
                    storage.virtualTokenReserves,
                );
                newVirtualTonReserves = storage.virtualTonReserves + tonIn;
                newVirtualTokenReserves = storage.virtualTokenReserves - tokensOut;
                crossesMigration = getMarketCapTon(
                    newVirtualTonReserves,
                    newVirtualTokenReserves,
                ) >=
                storage.migrationMarketCapTon;
                assert (crossesMigration) throw 607;
            }

            assert (tokensOut > 0) throw 608;
            assert (tokensOut >= msg.minTokensOut) throw 609;
            assert (tokensOut <= storage.realTokenReserves) throw 610;

            storage.virtualTonReserves = newVirtualTonReserves;
            storage.virtualTokenReserves = newVirtualTokenReserves;
            storage.realTonReserves += tonIn;
            storage.realTokenReserves -= tokensOut;
            storage.currentSupply += tokensOut;

            sendMint(
                storage,
                msg.queryId,
                in.senderAddress,
                tokensOut,
                in.senderAddress,
                0,
                emptyForwardPayload(),
                50000000,
            );

            if (crossesMigration && isStonfiConfigured(storage)) {
                storage = beginMigration(storage, msg.queryId);
            }

            storage.save();
        }

        JettonNotification => {
            var storage = BondingStorage.load();
            assert (in.senderAddress == ownJettonWallet(storage)) throw 611;
            assert (msg.amount > 0) throw 612;

            val op = opFromForwardPayload(msg.forwardPayload);

            if (op == OP_INTERNAL_MIGRATION_MINT) {
                assert (storage.migrationState == MIGRATION_STATE_MIGRATING) throw 613;
                sendStonfiLiquidity(storage, msg.queryId, msg.amount, in.createdAt);
                storage.migrationState = MIGRATION_STATE_MIGRATED;
                storage.save();
                return;
            }

            assert (storage.migrationState == MIGRATION_STATE_ACTIVE) throw 614;
            assert (op == OP_BONDING_CURVE_SELL) throw 615;

            var payload = forwardPayloadSlice(msg.forwardPayload);
            payload.skipBits(32);
            val queryId = payload.loadUint(64);
            val minTonOut = payload.loadCoins();

            val tonOutGross = quoteSellTon(
                msg.amount,
                storage.virtualTonReserves,
                storage.virtualTokenReserves,
            );
            val platformFeeTon = (tonOutGross * SELL_TAX_BPS) / BPS_DENOMINATOR;
            val sellerTonOut = tonOutGross - platformFeeTon;
            assert (sellerTonOut > 0) throw 616;
            assert (sellerTonOut >= minTonOut) throw 617;
            assert (tonOutGross <= storage.realTonReserves) throw 618;

            storage.virtualTonReserves -= tonOutGross;
            storage.virtualTokenReserves += msg.amount;
            storage.realTonReserves -= tonOutGross;
            storage.realTokenReserves += msg.amount;
            storage.currentSupply -= msg.amount;
            storage.save();

            val payoutMsg = createMessage({
                bounce: BounceMode.NoBounce,
                value: sellerTonOut,
                dest: msg.sender,
                body: createEmptyCell(),
            });
            payoutMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_IGNORE_ERRORS);

            if (platformFeeTon > 0) {
                val platformFeeMsg = createMessage({
                    bounce: BounceMode.NoBounce,
                    value: platformFeeTon,
                    dest: storage.identityConfig.load().platformWallet,
                    body: createEmptyCell(),
                });
                platformFeeMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_IGNORE_ERRORS);
            }

            val burnMsg = createMessage({
                bounce: BounceMode.Only256BitsOfBody,
                value: 50000000,
                dest: ownJettonWallet(storage),
                body: JettonBurn {
                    queryId,
                    amount: msg.amount,
                    responseDestination: storage.identityConfig.load().platformWallet,
                    customPayload: null,
                },
            });
            burnMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
        }

        MigrateToStonfi => {
            var storage = BondingStorage.load();
            val identity = storage.identityConfig.load();
            assert (storage.migrationState == MIGRATION_STATE_ACTIVE) throw 619;
            assert (
                getMarketCapTon(storage.virtualTonReserves, storage.virtualTokenReserves) >=
                storage.migrationMarketCapTon
            ) throw 620;
            assert (
                in.senderAddress == identity.platformWallet || in.senderAddress == identity.creator
            ) throw 621;
            storage = beginMigration(storage, msg.queryId);
            storage.save();
        }

        ConfigureStonfiMigration => {
            var storage = BondingStorage.load();
            val identity = storage.identityConfig.load();
            assert (
                in.senderAddress == identity.platformWallet || in.senderAddress == identity.creator
            ) throw 622;
            assert (storage.migrationState == MIGRATION_STATE_ACTIVE) throw 623;

            val config = msg.config.load();
            val routerConfig = config.routerConfig.load();
            val receiverConfig = config.receiverConfig.load();
            storage.stonfiConfig = BondingStonfiConfig {
                routerConfig: BondingStonfiRouterConfig {
                    router: routerConfig.router,
                    ptonWallet: routerConfig.ptonWallet,
                }.toCell(),
                receiverConfig: BondingStonfiReceiverConfig {
                    routerTokenWallet: receiverConfig.routerTokenWallet,
                    lpReceiver: receiverConfig.lpReceiver,
                }.toCell(),
            }.toCell();
            storage.save();
        }

        RetryStonfiMigration => {
            var storage = BondingStorage.load();
            val identity = storage.identityConfig.load();
            assert (
                in.senderAddress == identity.platformWallet || in.senderAddress == identity.creator
            ) throw 624;
            assert (storage.migrationState == MIGRATION_STATE_FAILED) throw 625;
            storage = beginMigration(storage, msg.queryId);
            storage.save();
        }

        else => {
            throw 0xffff;
        }
    }
}

fun onBouncedMessage(_in: InMessageBounced) {
    var storage = BondingStorage.load();
    if (storage.migrationState == MIGRATION_STATE_MIGRATING) {
        storage.migrationState = MIGRATION_STATE_FAILED;
        storage.save();
    }
}

get fun getReserves(): ReserveData {
    val storage = BondingStorage.load();
    return ReserveData {
        virtualTonReserves: storage.virtualTonReserves,
        virtualTokenReserves: storage.virtualTokenReserves,
        realTonReserves: storage.realTonReserves,
        realTokenReserves: storage.realTokenReserves,
        currentSupply: storage.currentSupply,
        migrationState: storage.migrationState,
    };
}

get fun getBuyQuote(tonIn: coins): QuoteResult {
    val storage = BondingStorage.load();
    assert (tonIn > 0) throw 626;
    return QuoteResult {
        amountOut: quoteBuyTokens(tonIn, storage.virtualTonReserves, storage.virtualTokenReserves),
        fee: 0,
    };
}

get fun getSellQuote(tokensIn: coins): QuoteResult {
    val storage = BondingStorage.load();
    assert (tokensIn > 0) throw 627;
    val tonOutGross = quoteSellTon(
        tokensIn,
        storage.virtualTonReserves,
        storage.virtualTokenReserves,
    );
    val fee = (tonOutGross * SELL_TAX_BPS) / BPS_DENOMINATOR;
    val sellerTonOut = tonOutGross - fee;
    assert (sellerTonOut > 0) throw 628;
    return QuoteResult {
        amountOut: sellerTonOut,
        fee,
    };
}

get fun getPrice(): int {
    val storage = BondingStorage.load();
    return getPriceScaled(storage.virtualTonReserves, storage.virtualTokenReserves);
}

get fun getMarketData(): MarketData {
    val storage = BondingStorage.load();
    val marketCap = getMarketCapTon(storage.virtualTonReserves, storage.virtualTokenReserves);
    return MarketData {
        price: getPriceScaled(storage.virtualTonReserves, storage.virtualTokenReserves),
        marketCapTon: marketCap,
        migrationMarketCapTon: storage.migrationMarketCapTon,
        progressBps: minInt(10000, (marketCap * 10000) / storage.migrationMarketCapTon),
    };
}

get fun isMigrated(): bool {
    return BondingStorage.load().migrationState == MIGRATION_STATE_MIGRATED;
}

get fun getMigrationState(): int {
    return BondingStorage.load().migrationState;
}

get fun getJettonMaster(): address {
    return BondingStorage.load().identityConfig.load().jettonMaster;
}
