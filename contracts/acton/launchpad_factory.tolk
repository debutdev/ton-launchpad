tolk 1.4

import "@contracts/acton/constants"
import "@contracts/acton/messages"

struct FactoryStonfiConfig {
    router: address
    ptonWallet: address
    lpReceiver: address
}

struct FactoryCodeConfig {
    bondingCurveCode: cell
    jettonMasterCode: cell
    jettonWalletCode: cell
}

struct FactoryStorage {
    owner: address
    platformWallet: address
    tokenCount: uint32
    migrationMarketCapTon: coins
    stonfiConfig: Cell<FactoryStonfiConfig>
    codeConfig: Cell<FactoryCodeConfig>
}

struct FactoryWalletStorageData {
    owner: address
    minter: address
    balance: coins
    platformWallet: address
}

struct MasterStorageData {
    totalSupply: coins
    owner: address
    factory: address
    platformWallet: address
    jettonContent: cell
    mintable: bool
    walletCode: cell
}

struct BondingStorageData {
    virtualTonReserves: coins
    virtualTokenReserves: coins
    realTonReserves: coins
    realTokenReserves: coins
    currentSupply: coins
    migrationState: uint8
    createdAt: uint32
    migrationMarketCapTon: coins
    identityConfig: Cell<BondingIdentityConfigData>
    stonfiConfig: Cell<BondingStonfiConfigData>
    codeConfig: Cell<BondingCodeConfigData>
}

struct BondingIdentityConfigData {
    jettonMaster: address
    creator: address
    platformWallet: address
}

struct BondingStonfiConfigData {
    routerConfig: Cell<BondingStonfiRouterConfigData>
    receiverConfig: Cell<BondingStonfiReceiverConfigData>
}

struct BondingStonfiRouterConfigData {
    router: address
    ptonWallet: address
}

struct BondingStonfiReceiverConfigData {
    routerTokenWallet: address
    lpReceiver: address
}

struct BondingCodeConfigData {
    walletCode: cell
}

fun FactoryStorage.load(): FactoryStorage {
    return FactoryStorage.fromCell(contract.getData());
}

fun FactoryStorage.save(self): void {
    contract.setData(self.toCell());
}

fun factoryWalletState(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): ContractState {
    return ContractState {
        code: walletCode,
        data: FactoryWalletStorageData {
            owner,
            minter,
            balance: 0,
            platformWallet,
        }.toCell(),
    };
}

fun factoryWalletAddress(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): address {
    return AutoDeployAddress {
        workchain: BASECHAIN,
        stateInit: factoryWalletState(owner, minter, platformWallet, walletCode),
    }.calculateAddress();
}

fun masterState(
    owner: address,
    factory: address,
    platformWallet: address,
    jettonContent: cell,
    walletCode: cell,
    masterCode: cell,
): ContractState {
    return ContractState {
        code: masterCode,
        data: MasterStorageData {
            totalSupply: 0,
            owner,
            factory,
            platformWallet,
            jettonContent,
            mintable: true,
            walletCode,
        }.toCell(),
    };
}

fun curveState(
    storage: FactoryStorage,
    jettonMaster: address,
    creator: address,
    createdAt: int,
): ContractState {
    val stonfiConfig = storage.stonfiConfig.load();
    val codeConfig = storage.codeConfig.load();
    val routerTokenWallet = stonfiConfig.router == DEAD_ADDRESS
        ? DEAD_ADDRESS
        : factoryWalletAddress(
            stonfiConfig.router,
            jettonMaster,
            storage.platformWallet,
            codeConfig.jettonWalletCode,
        );

    return ContractState {
        code: codeConfig.bondingCurveCode,
        data: BondingStorageData {
            virtualTonReserves: INITIAL_VIRTUAL_TON,
            virtualTokenReserves: INITIAL_VIRTUAL_TOKENS,
            realTonReserves: 0,
            realTokenReserves: REAL_TOKEN_SUPPLY,
            currentSupply: 0,
            migrationState: MIGRATION_STATE_ACTIVE,
            createdAt,
            migrationMarketCapTon: storage.migrationMarketCapTon,
            identityConfig: BondingIdentityConfigData {
                jettonMaster,
                creator,
                platformWallet: storage.platformWallet,
            }.toCell(),
            stonfiConfig: BondingStonfiConfigData {
                routerConfig: BondingStonfiRouterConfigData {
                    router: stonfiConfig.router,
                    ptonWallet: stonfiConfig.ptonWallet,
                }.toCell(),
                receiverConfig: BondingStonfiReceiverConfigData {
                    routerTokenWallet,
                    lpReceiver: stonfiConfig.lpReceiver,
                }.toCell(),
            }.toCell(),
            codeConfig: BondingCodeConfigData { walletCode: codeConfig.jettonWalletCode }.toCell(),
        }.toCell(),
    };
}

type FactoryAllowedMessage =
    | DeployToken
    | UpdateFactoryStonfiConfig
    | UpdateFactoryMigrationMarketCap

contract LaunchpadFactory {
    author: "Tonked"
    version: "0.1.0"
    description: "Factory for launchpad bonding curves and custom fee Jettons"
    storage: FactoryStorage
    incomingMessages: FactoryAllowedMessage
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
    }

    val msg = lazy FactoryAllowedMessage.fromSlice(in.body);

    match (msg) {
        DeployToken => {
            var storage = FactoryStorage.load();
            assert (in.valueCoins >= 500000000 + msg.initialBuyTon) throw 701;

            val creator = in.senderAddress;
            storage.tokenCount += 1;
            val codeConfig = storage.codeConfig.load();

            val jmState = masterState(
                contract.getAddress(),
                contract.getAddress(),
                storage.platformWallet,
                msg.jettonContent,
                codeConfig.jettonWalletCode,
                codeConfig.jettonMasterCode,
            );
            val jmAddress = AutoDeployAddress {
                workchain: BASECHAIN,
                stateInit: jmState,
            }.calculateAddress();

            val bcState = curveState(storage, jmAddress, creator, in.createdAt);
            val bcAddress = AutoDeployAddress {
                workchain: BASECHAIN,
                stateInit: bcState,
            }.calculateAddress();

            storage.save();

            val transferMasterOwnershipMsg = createMessage({
                bounce: BounceMode.Only256BitsOfBody,
                value: 150000000,
                dest: AutoDeployAddress {
                    workchain: BASECHAIN,
                    stateInit: jmState,
                },
                body: ChangeOwner {
                    queryId: msg.queryId,
                    newOwner: bcAddress,
                },
            });
            transferMasterOwnershipMsg.send(
                SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL,
            );

            val deployCurveMsg = createMessage({
                bounce: BounceMode.Only256BitsOfBody,
                value: 150000000,
                dest: AutoDeployAddress {
                    workchain: BASECHAIN,
                    stateInit: bcState,
                },
                body: createEmptyCell(),
            });
            deployCurveMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);

            val deployFeeMsg = createMessage({
                bounce: BounceMode.NoBounce,
                value: DEPLOY_FEE,
                dest: storage.platformWallet,
                body: createEmptyCell(),
            });
            deployFeeMsg.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_IGNORE_ERRORS);

            createExternalLogMessage({
                dest: createAddressNone(),
                body: TokenDeployed {
                    queryId: msg.queryId,
                    bondingCurveAddress: bcAddress,
                    jettonMasterAddress: jmAddress,
                    creator,
                },
            }).send(SEND_MODE_REGULAR);
        }

        UpdateFactoryStonfiConfig => {
            var storage = FactoryStorage.load();
            assert (in.senderAddress == storage.owner) throw 702;
            val config = msg.config.load();
            val routerConfig = config.routerConfig.load();
            val receiverConfig = config.receiverConfig.load();
            storage.stonfiConfig = FactoryStonfiConfig {
                router: routerConfig.router,
                ptonWallet: routerConfig.ptonWallet,
                lpReceiver: receiverConfig.lpReceiver,
            }.toCell();
            storage.save();
        }

        UpdateFactoryMigrationMarketCap => {
            var storage = FactoryStorage.load();
            assert (in.senderAddress == storage.owner) throw 703;
            assert (msg.migrationMarketCapTon > START_MARKET_CAP_TON) throw 704;
            storage.migrationMarketCapTon = msg.migrationMarketCapTon;
            storage.save();
        }

        else => {
            throw 0xffff;
        }
    }
}

fun onBouncedMessage(_in: InMessageBounced) {}

get fun getTokenCount(): int {
    return FactoryStorage.load().tokenCount;
}

get fun getOwner(): address {
    return FactoryStorage.load().owner;
}

get fun getPlatformWallet(): address {
    return FactoryStorage.load().platformWallet;
}

get fun getMigrationMarketCapTon(): coins {
    return FactoryStorage.load().migrationMarketCapTon;
}
