import { Address, Cell, Slice, beginCell } from '@ton/core';

export const OP_JETTON_NOTIFICATION = 0x7362d09c;
export const OP_DEDUST_JETTON_SWAP = 0xe3a0d482;
export const OP_DEDUST_NATIVE_SWAP = 0xea06185d;
export const OP_DEDUST_POOL_SWAP = 0x61ee542d;
export const OP_DEDUST_SWAP_EVENT = 0x9c610de3;

export type DedustAsset =
  | { type: 'native' }
  | { type: 'jetton'; address: Address };

export type DedustSwapEvent = {
  assetIn: DedustAsset;
  assetOut: DedustAsset;
  amountIn: bigint;
  amountOut: bigint;
  sender: Address;
  reserve0: bigint;
  reserve1: bigint;
};

export function dedustAssetIsNative(asset: DedustAsset): boolean {
  return asset.type === 'native';
}

export function dedustAssetIsJetton(asset: DedustAsset, jetton: Address): boolean {
  return asset.type === 'jetton' && asset.address.equals(jetton);
}

function parseDedustAsset(slice: Slice): DedustAsset | null {
  try {
    const tag = slice.loadUint(4);
    if (tag === 0) return { type: 'native' };
    if (tag !== 1) return null;
    const workchain = slice.loadInt(8);
    const hash = slice.loadBuffer(32);
    return { type: 'jetton', address: new Address(workchain, hash) };
  } catch {
    return null;
  }
}

export function parseForwardPayload(slice: Slice, directOps: number[] = [OP_DEDUST_JETTON_SWAP]): Slice | null {
  const payloadCell = beginCell().storeSlice(slice).endCell();

  try {
    const direct = payloadCell.beginParse();
    if (direct.remainingBits >= 32 && directOps.includes(direct.preloadUint(32))) return direct;
  } catch {
    // Fall through to TEP-74 Either<Cell, ^Cell> parsing.
  }

  try {
    const either = payloadCell.beginParse();
    if (either.remainingBits < 1) return null;
    const byRef = either.loadBit();
    return byRef ? either.loadRef().beginParse() : either;
  } catch {
    return null;
  }
}

export function readBodyOp(body: Cell | null | undefined): number | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.remainingBits < 32) return null;
    return slice.preloadUint(32);
  } catch {
    return null;
  }
}

export function parseDedustPoolSwapBody(body: Cell | null | undefined): { sender: Address; amountIn: bigint } | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_DEDUST_POOL_SWAP) return null;
    slice.loadUintBig(64);
    slice.loadRef();
    const amountIn = slice.loadCoins();
    const sender = slice.loadAddress();
    return { sender, amountIn };
  } catch {
    return null;
  }
}

export function parseDedustSwapEvent(body: Cell | null | undefined): DedustSwapEvent | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_DEDUST_SWAP_EVENT) return null;
    const assetIn = parseDedustAsset(slice);
    const assetOut = parseDedustAsset(slice);
    if (!assetIn || !assetOut) return null;
    const amountIn = slice.loadCoins();
    const amountOut = slice.loadCoins();
    const details = slice.loadRef().beginParse();
    const sender = details.loadAddress();
    details.loadAddressAny();
    const reserve0 = details.loadCoins();
    const reserve1 = details.loadCoins();
    return { assetIn, assetOut, amountIn, amountOut, sender, reserve0, reserve1 };
  } catch {
    return null;
  }
}

export function parseDedustNativeSwapPool(body: Cell | null | undefined): Address | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_DEDUST_NATIVE_SWAP) return null;
    slice.loadUintBig(64);
    slice.loadCoins();
    return slice.loadAddress();
  } catch {
    return null;
  }
}

export function parseDedustJettonSwapPool(forwardPayload: Slice): Address | null {
  try {
    const payload = parseForwardPayload(forwardPayload);
    if (!payload || payload.loadUint(32) !== OP_DEDUST_JETTON_SWAP) return null;
    return payload.loadAddress();
  } catch {
    return null;
  }
}

export function parseDedustJettonVaultSender(body: Cell | null | undefined, poolAddress: Address): Address | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== OP_JETTON_NOTIFICATION) return null;
    slice.loadUintBig(64);
    slice.loadCoins();
    const sender = slice.loadAddress();
    const pool = parseDedustJettonSwapPool(slice);
    return pool?.equals(poolAddress) ? sender : null;
  } catch {
    return null;
  }
}
