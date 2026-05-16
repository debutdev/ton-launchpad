import { Address, Cell, beginCell } from '@ton/core';
import {
  OP_DEDUST_SWAP_EVENT,
  OP_DEDUST_JETTON_SWAP,
  OP_DEDUST_NATIVE_SWAP,
  OP_DEDUST_POOL_SWAP,
  OP_JETTON_NOTIFICATION,
  dedustAssetIsJetton,
  dedustAssetIsNative,
  parseDedustJettonVaultSender,
  parseDedustNativeSwapPool,
  parseDedustPoolSwapBody,
  parseDedustSwapEvent,
  parseForwardPayload,
} from '../scripts/dedust_attribution';

function address(seed: string): Address {
  return Address.parseRaw(`0:${seed.repeat(64).slice(0, 64)}`);
}

function refForwardPayload(payload: Cell) {
  return beginCell().storeBit(1).storeRef(payload).endCell();
}

function storeDedustNativeAsset() {
  return beginCell().storeUint(0, 4);
}

function storeDedustJettonAsset(jetton: Address) {
  return beginCell().storeUint(1, 4).storeInt(jetton.workChain, 8).storeBuffer(jetton.hash);
}

describe('DeDust attribution parsers', () => {
  const sender = address('1');
  const pool = address('2');

  it('parses the original sender from a DeDust pool swap message', () => {
    const body = beginCell()
      .storeUint(OP_DEDUST_POOL_SWAP, 32)
      .storeUint(123n, 64)
      .storeRef(beginCell().endCell())
      .storeCoins(456n)
      .storeAddress(sender)
      .endCell();

    const parsed = parseDedustPoolSwapBody(body);

    expect(parsed?.sender.equals(sender)).toBe(true);
    expect(parsed?.amountIn).toBe(456n);
  });

  it('parses the target pool from a native-vault swap request', () => {
    const body = beginCell()
      .storeUint(OP_DEDUST_NATIVE_SWAP, 32)
      .storeUint(123n, 64)
      .storeCoins(456n)
      .storeAddress(pool)
      .storeUint(0, 1)
      .storeCoins(0n)
      .storeMaybeRef(null)
      .storeRef(beginCell().endCell())
      .endCell();

    expect(parseDedustNativeSwapPool(body)?.equals(pool)).toBe(true);
  });

  it('parses DeDust swap events with sender, amounts, and reserves', () => {
    const jetton = address('3');
    const body = beginCell()
      .storeUint(OP_DEDUST_SWAP_EVENT, 32)
      .storeBuilder(storeDedustNativeAsset())
      .storeBuilder(storeDedustJettonAsset(jetton))
      .storeCoins(111n)
      .storeCoins(222n)
      .storeRef(
        beginCell()
          .storeAddress(sender)
          .storeAddress(null)
          .storeCoins(333n)
          .storeCoins(444n)
          .endCell(),
      )
      .endCell();

    const parsed = parseDedustSwapEvent(body);

    expect(parsed).not.toBeNull();
    expect(dedustAssetIsNative(parsed!.assetIn)).toBe(true);
    expect(dedustAssetIsJetton(parsed!.assetOut, jetton)).toBe(true);
    expect(parsed!.sender.equals(sender)).toBe(true);
    expect(parsed!.amountIn).toBe(111n);
    expect(parsed!.amountOut).toBe(222n);
    expect(parsed!.reserve0).toBe(333n);
    expect(parsed!.reserve1).toBe(444n);
  });

  it('parses the original sender from a jetton-vault notification with DeDust swap payload', () => {
    const swapPayload = beginCell()
      .storeUint(OP_DEDUST_JETTON_SWAP, 32)
      .storeAddress(pool)
      .storeUint(0, 1)
      .storeCoins(0n)
      .storeMaybeRef(null)
      .storeRef(beginCell().endCell())
      .endCell();
    const notification = beginCell()
      .storeUint(OP_JETTON_NOTIFICATION, 32)
      .storeUint(123n, 64)
      .storeCoins(456n)
      .storeAddress(sender)
      .storeSlice(refForwardPayload(swapPayload).beginParse())
      .endCell();

    expect(parseDedustJettonVaultSender(notification, pool)?.equals(sender)).toBe(true);
  });

  it('can parse direct forward payloads when the expected direct op is supplied', () => {
    const directPayload = beginCell().storeUint(0x10002, 32).storeUint(1n, 64).storeCoins(0n).endCell();
    const parsed = parseForwardPayload(directPayload.beginParse(), [0x10002]);

    expect(parsed?.loadUint(32)).toBe(0x10002);
  });
});
