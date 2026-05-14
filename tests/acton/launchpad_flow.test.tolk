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
    nativeVault: Treasury
    jettonVault: Treasury
    pool: Treasury
}

fun testContent(): cell {
    return beginCell().storeUint(1, 8).storeString("ipfs://acton-test-token").endCell();
}

fun factoryStorage(
    owner: address,
    platformWallet: address,
    migrationMarketCapTon: coins,
    nativeVault: address,
): FactoryStorage {
    return FactoryStorage {
        owner,
        platformWallet,
        tokenCount: 0,
        migrationMarketCapTon,
        dedustConfig: FactoryDedustConfig { nativeVault }.toCell(),
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
    nativeVault: Treasury,
): LaunchpadFactory {
    val factory = LaunchpadFactory.fromStorage(
        factoryStorage(
            owner.address,
            platform.address,
            migrationMarketCapTon,
            nativeVault.address,
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
    expectedMigrationMarketCapTon: coins,
    expectedTokenCount: int,
): (BondingCurve, FeeJettonMaster) {
    val res = factory.sendDeployToken(
        owner.address,
        queryId,
        testContent(),
        0,
        { value: ton("0.7"), bounce: true },
    );
    expect(res).toHaveAllSuccessfulTxs();
    expect(factory.getTokenCount()).toEqual(expectedTokenCount);

    val eventMsg = res.findExternalOutMessage<TokenDeployed>({ from: factory.address });
    expect(eventMsg).toBeNotNull();
    val event = eventMsg!.loadBody();

    val curve = BondingCurve.fromAddress(event.bondingCurveAddress);
    val master = FeeJettonMaster.fromAddress(event.jettonMasterAddress);
    expect(master.getJettonData().adminAddress).toEqual(curve.address);
    expect(curve.getMarketData().migrationMarketCapTon).toEqual(expectedMigrationMarketCapTon);

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
    val nativeVault = testing.treasury("dedust-native-vault");
    val jettonVault = testing.treasury("dedust-jetton-vault");
    val pool = testing.treasury("dedust-pool");

    val factory = deployFactory(
        owner,
        platform,
        migrationMarketCapTon,
        nativeVault,
    );
    val (curve, master) = launchToken(factory, owner, 100, migrationMarketCapTon, 1);
    val configureRes = curve.sendConfigureDedustMigration(
        owner.address,
        101,
        nativeVault.address,
        jettonVault.address,
        pool.address,
        { value: ton("0.05"), bounce: true },
    );
    expect(configureRes).toHaveAllSuccessfulTxs();

    return FlowSetup { factory, curve, master, owner, alice, platform, nativeVault, jettonVault, pool };
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

fun dedustSwapPayload(): RemainingBitsAndRefs {
    return inlineForwardPayload(beginCell().storeUint(OP_DEDUST_JETTON_SWAP, 32).endCell().beginParse());
}

get fun `test factory launches low cap token`() {
    val owner = testing.treasury("factory-owner");
    val platform = testing.treasury("factory-platform");
    val nativeVault = testing.treasury("factory-dedust-native-vault");

    val factory = deployFactory(
        owner,
        platform,
        LOW_TEST_MIGRATION_CAP,
        nativeVault,
    );
    val (curve, master) = launchToken(factory, owner, 1, LOW_TEST_MIGRATION_CAP, 1);

    expect(curve.getJettonMaster()).toEqual(master.address);
    expect(factory.getMigrationMarketCapTon()).toEqual(LOW_TEST_MIGRATION_CAP);
}

get fun `test duplicate metadata launches unique jetton masters`() {
    val owner = testing.treasury("duplicate-owner");
    val platform = testing.treasury("duplicate-platform");
    val nativeVault = testing.treasury("duplicate-dedust-native-vault");

    val factory = deployFactory(
        owner,
        platform,
        LOW_TEST_MIGRATION_CAP,
        nativeVault,
    );
    val (curveA, masterA) = launchToken(factory, owner, 11, LOW_TEST_MIGRATION_CAP, 1);
    val (curveB, masterB) = launchToken(factory, owner, 12, LOW_TEST_MIGRATION_CAP, 2);

    expect(curveA.address != curveB.address).toBeTrue();
    expect(masterA.address != masterB.address).toBeTrue();
    expect(masterA.getJettonData().adminAddress).toEqual(curveA.address);
    expect(masterB.getJettonData().adminAddress).toEqual(curveB.address);
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
            { value: ton("1.8"), bounce: true },
        );
    expect(res).toHaveAllSuccessfulTxs();

    expect(setup.curve.getMigrationState()).toEqual(MIGRATION_STATE_MIGRATED);
    val data = setup.master.getJettonData();
    expect(data.totalSupply).toEqual(TOTAL_SUPPLY);
    expect(data.mintable).toEqual(false);
    expect(walletBalance(setup.master, setup.jettonVault.address) > 0).toBeTrue();
}

get fun `test dedust swap payload is taxed after migration`() {
    val setup = setupFlow();

    val migrateRes = setup
        .curve
        .sendBuyTokens(
            setup.alice.address,
            400,
            0,
            { value: ton("1.8"), bounce: true },
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
        setup.jettonVault.address,
        setup.alice.address,
        null,
        ton("0.05"),
        dedustSwapPayload(),
        { value: ton("0.3"), bounce: true },
    );
    expect(swapRes).toHaveAllSuccessfulTxs();

    expect(walletBalance(setup.master, setup.platform.address)).toEqual(
        platformBefore + expectedTax,
    );
}
