tolk 1.4

import "@contracts/acton/messages"

struct MasterStorage {
    totalSupply: coins
    owner: address
    factory: address
    tokenId: uint32
    platformWallet: address
    jettonContent: cell
    mintable: bool
    walletCode: cell
}

fun MasterStorage.load(): MasterStorage {
    return MasterStorage.fromCell(contract.getData());
}

fun MasterStorage.save(self): void {
    contract.setData(self.toCell());
}

fun masterWalletState(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): ContractState {
    return ContractState {
        code: walletCode,
        data: MasterWalletStorageData {
            owner,
            minter,
            balance: 0,
            platformWallet,
        }.toCell(),
    };
}

struct MasterWalletStorageData {
    owner: address
    minter: address
    balance: coins
    platformWallet: address
}

fun getWalletAddressFor(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): address {
    return AutoDeployAddress {
        workchain: BASECHAIN,
        stateInit: masterWalletState(owner, minter, platformWallet, walletCode),
    }.calculateAddress();
}

type MasterAllowedMessage =
    | ProvideWalletAddress
    | Mint
    | ChangeOwner
    | JettonBurnNotification
    | CloseMint

contract FeeJettonMaster {
    author: "Tonked"
    version: "0.1.0"
    description: "TEP-74 compatible custom Jetton master with curve-controlled minting"
    storage: MasterStorage
    incomingMessages: MasterAllowedMessage
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
    }

    val msg = lazy MasterAllowedMessage.fromSlice(in.body);

    match (msg) {
        ProvideWalletAddress => {
            val storage = MasterStorage.load();
            val walletAddress = getWalletAddressFor(
                msg.ownerAddress,
                contract.getAddress(),
                storage.platformWallet,
                storage.walletCode,
            );
            val ownerAddressCell = msg.includeAddress
                ? beginCell().storeAddress(msg.ownerAddress).endCell()
                : null;

            val walletAddressMsg = createMessage({
                bounce: BounceMode.NoBounce,
                value: 0,
                dest: in.senderAddress,
                body: TakeWalletAddress {
                    queryId: msg.queryId,
                    walletAddress,
                    ownerAddress: ownerAddressCell,
                },
            });
            walletAddressMsg.send(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
        }

        Mint => {
            var storage = MasterStorage.load();
            assert (in.senderAddress == storage.owner) throw 501;
            assert (storage.mintable) throw 502;

            val mintMessage = msg.mintMessage.load();
            storage.totalSupply += mintMessage.amount;
            storage.save();

            val mintTransferMsg = createMessage({
                bounce: BounceMode.Only256BitsOfBody,
                value: 0,
                dest: AutoDeployAddress {
                    workchain: BASECHAIN,
                    stateInit: masterWalletState(
                        msg.receiver,
                        contract.getAddress(),
                        storage.platformWallet,
                        storage.walletCode,
                    ),
                },
                body: mintMessage,
            });
            mintTransferMsg.send(
                SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_BOUNCE_ON_ACTION_FAIL,
            );
        }

        ChangeOwner => {
            var storage = MasterStorage.load();
            assert (
                in.senderAddress == storage.factory || in.senderAddress == storage.owner
            ) throw 503;
            storage.owner = msg.newOwner;
            storage.save();
        }

        JettonBurnNotification => {
            var storage = MasterStorage.load();
            val expectedWallet = getWalletAddressFor(
                msg.sender,
                contract.getAddress(),
                storage.platformWallet,
                storage.walletCode,
            );
            assert (in.senderAddress == expectedWallet) throw 504;

            storage.totalSupply -= msg.amount;
            assert (storage.totalSupply >= 0) throw 505;
            storage.save();

            if (msg.responseDestination != null) {
                val excessesMsg = createMessage({
                    bounce: BounceMode.NoBounce,
                    value: 0,
                    dest: msg.responseDestination,
                    body: JettonExcesses { queryId: msg.queryId },
                });
                excessesMsg.send(
                    SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_IGNORE_ERRORS,
                );
            }
        }

        CloseMint => {
            var storage = MasterStorage.load();
            assert (in.senderAddress == storage.owner) throw 506;
            storage.mintable = false;
            storage.save();
        }

        else => {
            throw 0xffff;
        }
    }
}

fun onBouncedMessage(in: InMessageBounced) {
    var storage = MasterStorage.load();
    var body = in.bouncedBody;
    body.skipBits(32);
    if (body.remainingBitsCount() >= 32) {
        val op = body.loadUint(32);
        if (op == 0x178d4519) {
            body.skipBits(64);
            val amount = body.loadCoins();
            storage.totalSupply -= amount;
            if (storage.totalSupply < 0) {
                storage.totalSupply = 0;
            }
            storage.save();
        }
    }
}

get fun get_jetton_data(): JettonMinterState {
    val storage = MasterStorage.load();
    return JettonMinterState {
        totalSupply: storage.totalSupply,
        mintable: storage.mintable,
        adminAddress: storage.owner,
        jettonContent: storage.jettonContent,
        jettonWalletCode: storage.walletCode,
    };
}

get fun get_wallet_address(ownerAddress: address): address {
    val storage = MasterStorage.load();
    return getWalletAddressFor(
        ownerAddress,
        contract.getAddress(),
        storage.platformWallet,
        storage.walletCode,
    );
}
