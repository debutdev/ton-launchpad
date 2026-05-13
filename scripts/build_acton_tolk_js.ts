import { runTolkCompiler } from '@ton/tolk-js';
import * as fs from 'fs';
import * as path from 'path';

const contracts = [
  ['BondingCurve', 'contracts/acton/bonding_curve.tolk'],
  ['FeeJettonMaster', 'contracts/acton/fee_jetton_master.tolk'],
  ['FeeJettonWallet', 'contracts/acton/fee_jetton_wallet.tolk'],
  ['LaunchpadFactory', 'contracts/acton/launchpad_factory.tolk'],
] as const;

async function main() {
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'build', 'acton');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [name, entrypointFileName] of contracts) {
    const result = await runTolkCompiler({
      entrypointFileName,
      fsReadCallback: (filePath) => fs.readFileSync(path.resolve(root, filePath), 'utf8'),
      optimizationLevel: 2,
      pathMappings: {
        '@acton': '.acton',
        '@contracts': 'contracts',
        '@stdlib': '.acton/tolk-stdlib',
      },
    });

    if (result.status === 'error') {
      throw new Error(`${name} compile failed:\n${result.message}`);
    }

    fs.writeFileSync(
      path.join(outDir, `${name}.json`),
      `${JSON.stringify({
        code_boc64: result.codeBoc64,
        hash: result.codeHashHex.toUpperCase(),
      }, null, 2)}\n`,
    );
    console.log(`${name}: ${result.codeHashHex.toUpperCase()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
