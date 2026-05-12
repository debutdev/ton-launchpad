// Tonked.io — Launchpad Factory
// Deploys BondingCurve + JettonMaster per token
// Charges 0.2 TON deploy fee

import "./messages";
import "./constants";
import "./bonding_curve";
import "./jetton_master";

contract LaunchpadFactory(
    owner: Address,
    platformWallet: Address,
    tokenCount: Int as uint32,
) {
    // Deploy a new token with bonding curve
    receive(msg: DeployToken) {
        let ctx = context();
        require(ctx.value >= ton("0.5"), "Insufficient TON for deployment"); // Need gas for deploying 2 contracts

        let creator = sender();
        let tokenIndex = self.tokenCount;
        self.tokenCount += 1;

        // 1. Compute JettonMaster init with owner = myAddress()
        let jmInit = initOf JettonMaster(
            0,                  // totalSupply starts at 0
            myAddress(),        // Factory owns it initially
            myAddress(),        // Factory address for ChangeOwner permission
            self.platformWallet,
            msg.jettonContent,
            true                // mintable
        );
        let jmAddress = contractAddress(jmInit);

        // 2. Compute BondingCurve init with correct JettonMaster address
        let bcInit = initOf BondingCurve(
            INITIAL_VIRTUAL_TON,
            INITIAL_VIRTUAL_TOKENS,
            0,                      // realTonReserves starts at 0
            REAL_TOKEN_SUPPLY,
            false,                  // not migrated
            jmAddress,              // correct JettonMaster address
            creator,
            self.platformWallet,
            now(),
            DEAD_ADDRESS,           // DeDust native vault configured after deploy
            DEAD_ADDRESS,           // DeDust jetton vault configured after deploy
            DEAD_ADDRESS,           // DeDust pool configured after deploy
        );
        let bcAddress = contractAddress(bcInit);

        // 3. Deploy JettonMaster and change owner in the deployment transaction.
        // Sending ChangeOwner as a separate message can race the deployment of the
        // same address and leave the master owned by the factory.
        deploy(DeployParameters {
            value: ton("0.15"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: ChangeOwner {
                queryId: msg.queryId,
                newOwner: bcAddress
            }.toCell(),
            init: jmInit,
        });

        // 4. Deploy BondingCurve
        deploy(DeployParameters {
            value: ton("0.15"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: null,
            init: bcInit,
        });

        // Send deploy fee to platform wallet
        message(MessageParameters {
            to: self.platformWallet,
            value: DEPLOY_FEE,
            mode: SendPayGasSeparately | SendIgnoreErrors,
            bounce: false,
            body: "deploy_fee".asComment(),
        });

        // Emit event
        emit(TokenDeployed {
            queryId: msg.queryId,
            bondingCurveAddress: bcAddress,
            jettonMasterAddress: jmAddress,
            creator: creator,
        }.toCell());

        // Return excess gas to creator
        cashback(sender());
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    receive("withdraw") {
        require(sender() == self.owner, "Only owner");
        message(MessageParameters {
            to: self.owner,
            value: 0,
            mode: SendRemainingBalance,
        });
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    get fun getTokenCount(): Int {
        return self.tokenCount;
    }

    get fun getOwner(): Address {
        return self.owner;
    }

    get fun getPlatformWallet(): Address {
        return self.platformWallet;
    }
}
