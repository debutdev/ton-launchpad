import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const sender = provider.sender().address?.toString() ?? 'unknown sender';
    throw new Error(
        `Standalone BondingCurve deployment is not supported for ${sender}. Deploy LaunchpadFactory and launch tokens through the factory so the JettonMaster, tax wallet, and DeDust config are wired correctly.`,
    );
}
