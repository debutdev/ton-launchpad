import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tolk',
    entrypoint: 'contracts/acton/fee_jetton_master.tolk',
    withStackComments: true,
    withSrcLineComments: true,
    experimentalOptions: '',
};
