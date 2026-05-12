// Tonked.io — Jetton Wallet (TEP-74 compliant)
// Based on tact-lang/jetton base implementation
// Handles individual user jetton balances and transfers

import "./messages";
import "./constants";

contract JettonWallet(
    owner: Address,
    minter: Address,
    balance: Int as coins,
    platformWallet: Address,
) {
    // Standard jetton transfer
    receive(msg: JettonTransfer) {
        require(sender() == self.owner, "Incorrect sender");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");

        let ctx = context();
        let fwdCount = 1 + sign(msg.forwardTonAmount);
        require(
            ctx.value >
            msg.forwardTonAmount +
            fwdCount * ctx.readForwardFee() +
            getForwardFee(WALLET_STATE_INIT_CELLS, WALLET_STATE_INIT_BITS, false) +
            (2 * getComputeFee(GAS_FOR_TRANSFER, false) + MIN_TONS_FOR_STORAGE),
            "Insufficient amount of TON attached",
        );

        deploy(DeployParameters {
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            init: initOf JettonWallet(msg.destination, self.minter, 0, self.platformWallet),
        });
    }

    // Receive tokens from another wallet or minter
    receive(msg: JettonTransferInternal) {
        // Verify sender is either another JettonWallet of same minter, or the minter itself
        let wallet: StateInit = initOf JettonWallet(msg.sender, self.minter, 0, self.platformWallet);
        if (!wallet.hasSameBasechainAddress(sender())) {
            require(self.minter == sender(), "Incorrect sender");
        }

        let taxAmount = self.getSellTaxAmount(msg.amount, msg.sender, self.owner, msg.forwardPayload);
        let receivedAmount = msg.amount - taxAmount;
        require(receivedAmount > 0, "Amount too small after tax");
        self.balance += receivedAmount;

        let ctx: Context = context();
        let msgValue: Int = ctx.value;
        let tonBalanceBeforeMsg = myBalance() - msgValue;

        if (taxAmount > 0) {
            require(msgValue > TAX_TRANSFER_GAS, "Insufficient tax gas");
            msgValue -= TAX_TRANSFER_GAS;
            deploy(DeployParameters {
                value: TAX_TRANSFER_GAS,
                mode: SendPayGasSeparately,
                bounce: true,
                body: JettonTransferInternal {
                    queryId: msg.queryId,
                    amount: taxAmount,
                    sender: self.owner,
                    responseDestination: null,
                    forwardTonAmount: 0,
                    forwardPayload: emptySlice(),
                }.toCell(),
                init: initOf JettonWallet(self.platformWallet, self.minter, 0, self.platformWallet),
            });
        }

        // Forward notification to owner if requested
        if (msg.forwardTonAmount > 0) {
            let fwdFee: Int = ctx.readForwardFee();
            msgValue -= msg.forwardTonAmount + fwdFee;
            message(MessageParameters {
                to: self.owner,
                value: msg.forwardTonAmount,
                mode: SendPayGasSeparately,
                bounce: false,
                body: JettonNotification {
                    queryId: msg.queryId,
                    amount: receivedAmount,
                    sender: msg.sender,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }

        nativeReserve(max(tonBalanceBeforeMsg, MIN_TONS_FOR_STORAGE), ReserveAtMost);

        // Cashback excess to response destination
        if (msg.responseDestination != null && msgValue > 0) {
            message(MessageParameters {
                to: msg.responseDestination!!,
                value: msgValue,
                mode: SendRemainingBalance + SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    // Burn tokens (sends notification to minter)
    receive(msg: JettonBurn) {
        require(sender() == self.owner, "Incorrect sender");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");

        let ctx = context();
        let fwdFee: Int = ctx.readForwardFee();
        require(ctx.value > (fwdFee + 2 * getComputeFee(GAS_FOR_BURN, false)), "Insufficient amount of TON attached");

        message(MessageParameters {
            to: self.minter,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonBurnNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    // Handle bounced transfers — restore balance
    bounced(msg: bounced<JettonTransferInternal>) {
        self.balance += msg.amount;
    }

    // Handle bounced burns — restore balance
    bounced(msg: bounced<JettonBurnNotification>) {
        self.balance += msg.amount;
    }

    fun getSellTaxAmount(amount: Int, senderOwner: Address, receiverOwner: Address, forwardPayload: Slice): Int {
        if (senderOwner == self.platformWallet || receiverOwner == self.platformWallet || receiverOwner == DEAD_ADDRESS) {
            return 0;
        }

        if (forwardPayload.bits() < 32) {
            if (forwardPayload.bits() >= 1) {
                let payloadRef = forwardPayload.preloadMaybeRef();
                if (payloadRef != null) {
                    let refPayload = payloadRef!!.asSlice();
                    if (refPayload.bits() >= 32) {
                        let refOp = refPayload.preloadUint(32);
                        if (refOp == OP_DEDUST_JETTON_SWAP) {
                            return (amount * SELL_TAX_BPS) / BPS_DENOMINATOR;
                        }
                    }
                }
            }
            return 0;
        }

        let op = forwardPayload.preloadUint(32);
        if (op == OP_DEDUST_JETTON_SWAP) {
            return (amount * SELL_TAX_BPS) / BPS_DENOMINATOR;
        }

        return 0;
    }

    // TEP-74 get method
    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData {
            balance: self.balance,
            owner: self.owner,
            minter: self.minter,
            code: myCode(),
        };
    }
}
