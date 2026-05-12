// Tonked.io — Jetton Master (TEP-74 + TEP-89 compliant)
// Based on tact-lang/jetton base implementation
// Only the BondingCurve contract (owner) can mint tokens

import "./jetton_wallet";
import "./messages";
import "./constants";

contract JettonMaster(
    totalSupply: Int as coins,
    owner: Address,             // BondingCurve contract address (only minter)
    factory: Address,           // The Factory that deployed this master
    platformWallet: Address,    // Receives token-level sell tax
    jettonContent: Cell,        // TEP-64 metadata (IPFS URL)
    mintable: Bool,
) {
    // TEP-89: Provide wallet address discovery
    receive(msg: ProvideWalletAddress) {
        let ownerWorkchain: Int = parseStdAddress(msg.ownerAddress.asSlice()).workchain;

        let targetJettonWallet: BasechainAddress = (ownerWorkchain == BASECHAIN)
            ? contractBasechainAddress(self.getJettonWalletInit(msg.ownerAddress))
            : emptyBasechainAddress();

        message(MessageParameters {
            body: TakeWalletAddress {
                queryId: msg.queryId,
                walletAddress: contractAddress(self.getJettonWalletInit(msg.ownerAddress)),
                ownerAddress: msg.includeAddress
                    ? beginCell().storeAddress(msg.ownerAddress).endCell()
                    : null,
            }.toCell(),
            to: sender(),
            value: 0,
            mode: SendRemainingValue,
        });
    }

    // Mint new tokens — only owner (BondingCurve) can call
    receive(msg: Mint) {
        require(sender() == self.owner, "Only owner can mint");
        require(self.mintable, "Minting is closed");

        self.totalSupply += msg.mintMessage.amount;

        let fwdFee = context().readForwardFee();
        let msgValue = context().value;

        // Deploy wallet and forward internal transfer
        deploy(DeployParameters {
            value: 0,
            bounce: true,
            mode: SendRemainingValue | SendBounceIfActionFail,
            body: msg.mintMessage.toCell(),
            init: self.getJettonWalletInit(msg.receiver),
        });
    }

    // Change ownership (used by factory to break circular dependency)
    receive(msg: ChangeOwner) {
        require(sender() == self.factory || sender() == self.owner, "Only factory or owner can change ownership");
        self.owner = msg.newOwner;
    }

    // Process burn notifications from jetton wallets
    receive(msg: JettonBurnNotification) {
        let senderAddr = parseStdAddress(sender().asSlice());
        let wallet = contractBasechainAddress(self.getJettonWalletInit(msg.sender));

        require(senderAddr.workchain == BASECHAIN && senderAddr.address == wallet.hash!!, "Unauthorized burn");

        self.totalSupply -= msg.amount;

        if (msg.responseDestination != null) {
            message(MessageParameters {
                to: msg.responseDestination!!,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
                value: 0,
                bounce: false,
                mode: SendRemainingValue | SendIgnoreErrors,
            });
        }
    }

    // Close minting permanently (called after migration)
    receive("close_mint") {
        require(sender() == self.owner, "Only owner can close minting");
        self.mintable = false;
        cashback(sender());
    }

    // Handle bounced mint — reduce total supply
    bounced(msg: bounced<JettonTransferInternal>) {
        self.totalSupply -= msg.amount;
    }

    // TEP-74 get method
    get fun get_jetton_data(): JettonMinterState {
        return JettonMinterState {
            totalSupply: self.totalSupply,
            mintable: self.mintable,
            adminAddress: self.owner,
            jettonContent: self.jettonContent,
            jettonWalletCode: codeOf JettonWallet,
        };
    }

    // TEP-89 get method
    get fun get_wallet_address(ownerAddress: Address): Address {
        return contractAddress(self.getJettonWalletInit(ownerAddress));
    }

    fun getJettonWalletInit(owner: Address): StateInit {
        return initOf JettonWallet(owner, myAddress(), 0, self.platformWallet);
    }
}
