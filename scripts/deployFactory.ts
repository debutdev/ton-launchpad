import { toNano, Cell } from '@ton/core';
import { LaunchpadFactory } from '../wrappers/LaunchpadFactory';
import { NetworkProvider, sleep } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const deployer = provider.sender();
    console.log('Deploying LaunchpadFactory with address:', deployer.address);

    const platformWallet = deployer.address!; // Receives fees

    const factory = provider.open(
        await LaunchpadFactory.fromInit(
            deployer.address!, // Owner
            platformWallet,    // Platform Wallet
            0n,                // tokenCount
        )
    );

    await provider.deploy(factory, toNano('0.1'));

    console.log('Waiting for deployment at:', factory.address.toString());
    
    // Custom wait loop since waitForDeploy versioning can vary
    let attempt = 0;
    while (attempt < 10) {
        const isDeployed = await provider.isContractDeployed(factory.address);
        if (isDeployed) {
            break;
        }
        attempt++;
        await sleep(2000);
    }

    console.log('Success! LaunchpadFactory deployed at:', factory.address.toString());
}
