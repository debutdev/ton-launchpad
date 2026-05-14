tolk 1.4

import "@contracts/acton/constants"
import "@contracts/acton/helpers"
import "@contracts/acton/messages"

struct WalletStorage {
    owner: address
    minter: address
    balance: coins
    platformWallet: address
}

fun WalletStorage.load(): WalletStorage {
    return WalletStorage.fromCell(contract.getData());
}

fun WalletStorage.save(self): void {
    contract.setData(self.toCell());
}

fun feeWalletState(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): ContractState {
    return ContractState {
        code: walletCode,
        data: WalletStorage {
            owner,
            minter,
            balance: 0,
            platformWallet,
        }.toCell(),
    };
}

fun feeWalletAddress(
    owner: address,
    minter: address,
    platformWallet: address,
    walletCode: cell,
): address {
    return AutoDeployAddress {
        workchain: BASECHAIN,
        stateInit: feeWalletState(owner, minter, platformWallet, walletCode),
    }.calculateAddress();
}

fun getSellTaxAmount(
    amount: coins,
    senderOwner: address,
    receiverOwner: address,
    forwardPayload: RemainingBitsAndRefs,
): coins {
    if (senderOwner == receiverOwner) {
        return 0;
    }

    if (senderOwner == DEAD_ADDRESS || receiverOwner == DEAD_ADDRESS) {
        return 0;
    }

    if (
        senderOwner == WalletStorage.load().platformWallet ||
        receiverOwner == WalletStorage.load().platformWallet
    ) {
        return 0;
    }

    val op = opFromForwardPayload(forwardPayload);
    if (op == OP_DEDUST_JETTON_SWAP) {
        return (amount * SELL_TAX_BPS) / BPS_DENOMINATOR;
    }

    return 0;
}

fun sendExcesses(queryId: int, responseDestination: address?): void {
    if (responseDestination != null) {
        val excessesMsg = createMessage({
            bounce: BounceMode.NoBounce,
            value: 0,
            dest: responseDestination,
            body: JettonExcesses { queryId },
        });
        excessesMsg.send(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_IGNORE_ERRORS);
    }
}

type FeeWalletAllowedMessage = JettonTransfer | JettonTransferInternal | JettonBurn

contract FeeJettonWallet {
    author: "Tonked"
    version: "0.1.0"
    description: "TEP-74 compatible Jetton wallet with sell-only transfer tax"
    storage: WalletStorage
    incomingMessages: FeeWalletAllowedMessage
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
    }

    val msg = lazy FeeWalletAllowedMessage.fromSlice(in.body);

    match (msg) {
        JettonTransfer => {
            var storage = WalletStorage.load();
            assert (in.senderAddress == storage.owner) throw 401;
            assert (msg.amount > 0) throw 402;

            storage.balance -= msg.amount;
            assert (storage.balance >= 0) throw 403;
            storage.save();

            val transfer = JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: storage.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            };

            val transferMsg = createMessage({
                bounce: BounceMode.Only256BitsOfBody,
                value: 0,
                dest: AutoDeployAddress {
                    workchain: BASECHAIN,
                    stateInit: feeWalletState(
                        msg.destination,
                        storage.minter,
                        storage.platformWallet,
                        contract.getCode(),
                    ),
                },
                body: transfer,
            });
            transferMsg.send(
                SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_BOUNCE_ON_ACTION_FAIL,
            );
        }

        JettonTransferInternal => {
            var storage = WalletStorage.load();
            val expectedSenderWallet = feeWalletAddress(
                msg.sender,
                storage.minter,
                storage.platformWallet,
                contract.getCode(),
            );
            assert (
                in.senderAddress == expectedSenderWallet || in.senderAddress == storage.minter
            ) throw 404;

            val forwardPayloadCell = beginCell().storeSlice(msg.forwardPayload).endCell();
            val taxAmount = getSellTaxAmount(
                msg.amount,
                msg.sender,
                storage.owner,
                forwardPayloadCell.beginParse(),
            );
            val receivedAmount = msg.amount - taxAmount;
            assert (receivedAmount > 0) throw 405;

            storage.balance += receivedAmount;
            storage.save();

            if (taxAmount > 0) {
                assert (in.valueCoins > TAX_TRANSFER_GAS) throw 406;
                val taxTransferMsg = createMessage({
                    bounce: BounceMode.Only256BitsOfBody,
                    value: TAX_TRANSFER_GAS,
                    dest: AutoDeployAddress {
                        workchain: BASECHAIN,
                        stateInit: feeWalletState(
                            storage.platformWallet,
                            storage.minter,
                            storage.platformWallet,
                            contract.getCode(),
                        ),
                    },
                    body: JettonTransferInternal {
                        queryId: msg.queryId,
                        amount: taxAmount,
                        sender: storage.owner,
                        responseDestination: null,
                        forwardTonAmount: 0,
                        forwardPayload: emptyForwardPayload(),
                    },
                });
                taxTransferMsg.send(
                    SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL,
                );
            }

            if (msg.forwardTonAmount > 0) {
                val notificationMsg = createMessage({
                    bounce: BounceMode.RichBounce,
                    value: msg.forwardTonAmount,
                    dest: storage.owner,
                    body: JettonNotification {
                        queryId: msg.queryId,
                        amount: receivedAmount,
                        sender: msg.sender,
                        forwardPayload: forwardPayloadCell.beginParse(),
                    },
                });
                notificationMsg.send(SEND_MODE_PAY_FEES_SEPARATELY);
            }

            sendExcesses(msg.queryId, msg.responseDestination);
        }

        JettonBurn => {
            var storage = WalletStorage.load();
            assert (in.senderAddress == storage.owner) throw 407;
            assert (msg.amount > 0) throw 408;

            storage.balance -= msg.amount;
            assert (storage.balance >= 0) throw 409;
            storage.save();

            val burnMsg = createMessage({
                bounce: BounceMode.Only256BitsOfBody,
                value: 0,
                dest: storage.minter,
                body: JettonBurnNotification {
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: storage.owner,
                    responseDestination: msg.responseDestination,
                },
            });
            burnMsg.send(
                SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_BOUNCE_ON_ACTION_FAIL,
            );
        }

        else => {
            throw 0xffff;
        }
    }
}

fun onBouncedMessage(in: InMessageBounced) {
    var storage = WalletStorage.load();
    var body = in.bouncedBody;

    if (body.remainingBitsCount() >= 32 && body.preloadUint(32) == 0xfffffffe) {
        val rich = RichBounceBody.fromSlice(body);
        val notification = JettonNotification.fromCell(rich.originalBody);

        storage.balance -= notification.amount;
        assert (storage.balance >= 0) throw 410;
        storage.save();

        val refundMsg = createMessage({
            bounce: BounceMode.Only256BitsOfBody,
            value: 0,
            dest: AutoDeployAddress {
                workchain: BASECHAIN,
                stateInit: feeWalletState(
                    notification.sender,
                    storage.minter,
                    storage.platformWallet,
                    contract.getCode(),
                ),
            },
            body: JettonTransferInternal {
                queryId: notification.queryId,
                amount: notification.amount,
                sender: storage.owner,
                responseDestination: notification.sender,
                forwardTonAmount: 0,
                forwardPayload: emptyForwardPayload(),
            },
        });
        refundMsg.send(
            SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_BOUNCE_ON_ACTION_FAIL,
        );
        return;
    }

    body.skipBits(32);

    if (body.remainingBitsCount() >= 32) {
        val op = body.loadUint(32);
        if (op == 0x178d4519 || op == 0x7bdd97de) {
            body.skipBits(64);
            val amount = body.loadCoins();
            storage.balance += amount;
            storage.save();
        }
    }
}

get fun get_wallet_data(): JettonWalletData {
    val storage = WalletStorage.load();
    return JettonWalletData {
        balance: storage.balance,
        owner: storage.owner,
        minter: storage.minter,
        code: contract.getCode(),
    };
}
