import type { Address } from '@ton/core';

export type TonNetwork = 'mainnet' | 'testnet';

function clean(value: string | undefined) {
  return (value || '').replace(/[\r\n\t]/g, '').trim().toLowerCase();
}

export const TON_NETWORK: TonNetwork = clean(process.env.NEXT_PUBLIC_TON_NETWORK) === 'testnet'
  ? 'testnet'
  : 'mainnet';

export const IS_TON_TESTNET = TON_NETWORK === 'testnet';
export const TON_NETWORK_LABEL = IS_TON_TESTNET ? 'TON testnet' : 'TON mainnet';
export const TONCONNECT_CHAIN = IS_TON_TESTNET ? '-3' : '-239';

export const DEFAULT_TONCENTER_ENDPOINT = IS_TON_TESTNET
  ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
  : 'https://toncenter.com/api/v2/jsonRPC';

export const DEFAULT_TONAPI_ENDPOINT = IS_TON_TESTNET
  ? 'https://testnet.tonapi.io'
  : 'https://tonapi.io';

export function formatTonAddress(address: Address, options: { bounceable?: boolean } = {}) {
  return address.toString({
    ...options,
    testOnly: IS_TON_TESTNET,
  });
}

export function tonAddressVariants(address: Address) {
  return Array.from(new Set([
    address.toRawString(),
    formatTonAddress(address),
    formatTonAddress(address, { bounceable: false }),
    address.toString(),
    address.toString({ bounceable: false }),
    address.toString({ testOnly: true }),
    address.toString({ bounceable: false, testOnly: true }),
  ]));
}
