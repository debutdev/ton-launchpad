tolk 1.4

import "@acton/build"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/types/message"
import "@contracts/acton/bonding_curve"
import "@contracts/acton/constants"
import "@contracts/acton/helpers"
import "@contracts/acton/launchpad_factory"
import "@contracts/acton/messages"
import "@wrappers/acton-tolk/BondingCurve.gen"
import "@wrappers/acton-tolk/FeeJettonMaster.gen"
import "@wrappers/acton-tolk/FeeJettonWallet.gen"
import "@wrappers/acton-tolk/LaunchpadFactory.gen"

const LOW_TEST_MIGRATION_CAP = START_MARKET_CAP_TON + 500000000

struct FlowSetup {
    factory: LaunchpadFactory
    curve: BondingCurve
    master: FeeJettonMaster
    owner: Treasury
    alice: Treasury
    platform: Treasury
    router: Treasury
}

fun testContent(): cell {
    return beginCell().storeUint(1, 8).storeString("ipfs://acton-test-token").endCell();
}

fun factoryStorage(
    owner: address,
    platformWallet: address,
    migrationMarketCapTon: coins,
    router: address,
    ptonWallet: address,
    lpReceiver: address,
): FactoryStorage {
    return FactoryStorage {
        owner,
        platformWallet,
        tokenCount: 0,
        migrationMarketCapTon,
        stonfiConfig: FactoryStonfiConfig { router, ptonWallet, lpReceiver }.toCell(),
        codeConfig: FactoryCodeConfig {
            bondingCurveCode: build("BondingCurve"),
            jettonMasterCode: build("FeeJettonMaster"),
            jettonWalletCode: build("FeeJettonWallet"),
        }.toCell(),
    };
}

fun deployFactory(
    owner: Treasury,
    platform: Treasury,
    migrationMarketCapTon: coins,
    router: Treasury,
    pton: Treasury,
    lp: Treasury,
): LaunchpadFactory {
    val factory = LaunchpadFactory.fromStorage(
        factoryStorage(
            owner.address,
            platform.address,
            migrationMarketCapTon,
            router.address,
            pton.address,
            lp.address,
        ),
    );
    val deployRes = factory.deploy(owner.address, { value: ton("0.5") });
    expect(deployRes).toHaveSuccessfulDeploy({ to: factory.address });
    return factory;
}

fun launchToken(
    factory: LaunchpadFactory,
    owner: Treasury,
    queryId: uint64,
): (BondingCurve, FeeJettonMaster) {
    val res = factory.sendDeployToken(
        owner.address,
        queryId,
        testContent(),
        0,
        { value: ton("0.7"), bounce: true },
    );
    expect(res).toHaveAllSuccessfulTxs();
    expect(factory.getTokenCount()).toEqual(1);

    val eventMsg = res.findExternalOutMessage<TokenDeployed>({ from: factory.address });
    expect(eventMsg).toBeNotNull();
    val event = eventMsg!.loadBody();

    val curve = BondingCurve.fromAddress(event.bondingCurveAddress);
    val master = FeeJettonMaster.fromAddress(event.jettonMasterAddress);
    expect(master.getJettonData().adminAddress).toEqual(curve.address);
    expect(curve.getMarketData().migrationMarketCapTon).toEqual(LOW_TEST_MIGRATION_CAP);

    return (curve, master);
}

fun setupFlow(): FlowSetup {
    return setupFlowWithMigrationCap(LOW_TEST_MIGRATION_CAP);
}

fun setupFlowWithMigrationCap(migrationMarketCapTon: coins): FlowSetup {
    testing.setNow(1_800_000_000);
    val owner = testing.treasury("owner");
    val alice = testing.treasury("alice");
    val platform = testing.treasury("platform");
    val router = testing.treasury("router");
    val pton = testing.treasury("pton");
    val lp = testing.treasury("lp-lock");

    val factory = deployFactory(
        owner,
        platform,
        migrationMarketCapTon,
        router,
        pton,
        lp,
    );
    val (curve, master) = launchToken(factory, owner, 100);

    return FlowSetup { factory, curve, master, owner, alice, platform, router };
}

fun wallet(master: FeeJettonMaster, owner: address): FeeJettonWallet {
    return FeeJettonWallet.fromAddress(master.getWalletAddress(owner));
}

fun walletBalance(master: FeeJettonMaster, owner: address): coins {
    val tokenWallet = wallet(master, owner);
    if (!testing.isDeployed(tokenWallet.address)) {
        return 0;
    }

    return tokenWallet.getWalletData().balance;
}

fun sellPayloadWithMin(queryId: uint64, minTonOut: coins): RemainingBitsAndRefs {
    return inlineForwardPayload(
        beginCell()
            .storeUint(OP_BONDING_CURVE_SELL, 32)
            .storeUint(queryId, 64)
            .storeCoins(minTonOut)
            .endCell()
            .beginParse(),
    );
}

fun sellPayload(queryId: uint64): RemainingBitsAndRefs {
    return sellPayloadWithMin(queryId, 0);
}

fun stonfiSwapPayload(): RemainingBitsAndRefs {
    return inlineForwardPayload(beginCell().storeUint(OP_STONFI_SWAP, 32).endCell().beginParse());
}

get fun `test factory launches low cap token`() {
    val owner = testing.treasury("factory-owner");
    val platform = testing.treasury("factory-platform");
    val router = testing.treasury("factory-router");
    val pton = testing.treasury("factory-pton");
    val lp = testing.treasury("factory-lp");

    val factory = deployFactory(
        owner,
        platform,
        LOW_TEST_MIGRATION_CAP,
        router,
        pton,
        lp,
    );
    val (curve, master) = launchToken(factory, owner, 1);

    expect(curve.getJettonMaster()).toEqual(master.address);
    expect(factory.getMigrationMarketCapTon()).toEqual(LOW_TEST_MIGRATION_CAP);
}

get fun `test buy then sell sends two percent TON to platform`() {
    val setup = setupFlow();

    val buyRes = setup
        .curve
        .sendBuyTokens(
            setup.alice.address,
            200,
            0,
            { value: ton("0.3"), bounce: true },
        );
    expect(buyRes).toHaveAllSuccessfulTxs();

    val aliceTokens = walletBalance(setup.master, setup.alice.address);
    expect(aliceTokens > 0).toBeTrue();
    val quote = setup.curve.getSellQuote(aliceTokens);
    expect(quote.fee > 0).toBeTrue();
    val platformTonBefore = testing.getAccountBalance(setup.platform.address);

    val sellRes = wallet(setup.master, setup.alice.address).sendJettonTransfer(
        setup.alice.address,
        201,
        aliceTokens,
        setup.curve.address,
        setup.alice.address,
        null,
        ton("0.15"),
        sellPayload(201),
        { value: ton("0.3"), bounce: true },
    );
    expect(sellRes).toHaveAllSuccessfulTxs();

    expect(walletBalance(setup.master, setup.alice.address)).toEqual(0);
    expect(walletBalance(setup.master, setup.platform.address)).toEqual(0);
    expect(
        testing.getAccountBalance(setup.platform.address) >= platformTonBefore + quote.fee,
    ).toBeTrue();
}

get fun `test large sell pays TON and does not strand tokens in curve wallet`() {
    val setup = setupFlowWithMigrationCap(START_MARKET_CAP_TON + ton("100"));

    val buyRes = setup
        .curve
        .sendBuyTokens(
            setup.alice.address,
            250,
            0,
            { value: ton("8.8"), bounce: true },
        );
    expect(buyRes).toHaveAllSuccessfulTxs();

    val aliceTokens = walletBalance(setup.master, setup.alice.address);
    expect(aliceTokens > 0).toBeTrue();
    val quote = setup.curve.getSellQuote(aliceTokens);
    val aliceTonBefore = testing.getAccountBalance(setup.alice.address);
    val platformTonBefore = testing.getAccountBalance(setup.platform.address);

    val sellRes = wallet(setup.master, setup.alice.address).sendJettonTransfer(
        setup.alice.address,
        251,
        aliceTokens,
        setup.curve.address,
        setup.alice.address,
        null,
        ton("0.15"),
        sellPayload(251),
        { value: ton("0.3"), bounce: true },
    );
    expect(sellRes).toHaveAllSuccessfulTxs();

    expect(walletBalance(setup.master, setup.alice.address)).toEqual(0);
    expect(walletBalance(setup.master, setup.curve.address)).toEqual(0);
    expect(testing.getAccountBalance(setup.alice.address) > aliceTonBefore).toBeTrue();
    expect(
        testing.getAccountBalance(setup.platform.address) >= platformTonBefore + quote.fee,
    ).toBeTrue();
}

get fun `test failed sell notification refunds tokens to seller`() {
    val setup = setupFlowWithMigrationCap(START_MARKET_CAP_TON + ton("100"));

    val buyRes = setup
        .curve
        .sendBuyTokens(
            setup.alice.address,
            260,
            0,
            { value: ton("1.0"), bounce: true },
        );
    expect(buyRes).toHaveAllSuccessfulTxs();

    val aliceTokens = walletBalance(setup.master, setup.alice.address);
    expect(aliceTokens > 0).toBeTrue();

    wallet(setup.master, setup.alice.address).sendJettonTransfer(
        setup.alice.address,
        261,
        aliceTokens,
        setup.curve.address,
        setup.alice.address,
        null,
        ton("0.15"),
        sellPayloadWithMin(261, ton("1000")),
        { value: ton("0.3"), bounce: true },
    );

    expect(walletBalance(setup.master, setup.alice.address)).toEqual(aliceTokens);
    expect(walletBalance(setup.master, setup.curve.address)).toEqual(0);
}

get fun `test low cap buy migrates and closes minting`() {
    val setup = setupFlow();

    val res = setup
        .curve
        .sendBuyTokens(
            setup.alice.address,
            300,
            0,
            { value: ton("1.2"), bounce: true },
        );
    expect(res).toHaveAllSuccessfulTxs();

    expect(setup.curve.getMigrationState()).toEqual(MIGRATION_STATE_MIGRATED);
    val data = setup.master.getJettonData();
    expect(data.totalSupply).toEqual(TOTAL_SUPPLY);
    expect(data.mintable).toEqual(false);
    expect(walletBalance(setup.master, setup.router.address) > 0).toBeTrue();
}

get fun `test stonfi swap payload is taxed after migration`() {
    val setup = setupFlow();

    val migrateRes = setup
        .curve
        .sendBuyTokens(
            setup.alice.address,
            400,
            0,
            { value: ton("1.2"), bounce: true },
        );
    expect(migrateRes).toHaveAllSuccessfulTxs();
    expect(setup.curve.getMigrationState()).toEqual(MIGRATION_STATE_MIGRATED);

    val aliceTokens = walletBalance(setup.master, setup.alice.address);
    expect(aliceTokens > 0).toBeTrue();
    val platformBefore = walletBalance(setup.master, setup.platform.address);
    val swapAmount = aliceTokens / 2;
    val expectedTax = (swapAmount * SELL_TAX_BPS) / BPS_DENOMINATOR;

    val swapRes = wallet(setup.master, setup.alice.address).sendJettonTransfer(
        setup.alice.address,
        401,
        swapAmount,
        setup.router.address,
        setup.alice.address,
        null,
        ton("0.05"),
        stonfiSwapPayload(),
        { value: ton("0.3"), bounce: true },
    );
    expect(swapRes).toHaveAllSuccessfulTxs();

    expect(walletBalance(setup.master, setup.platform.address)).toEqual(
        platformBefore + expectedTax,
    );
}
