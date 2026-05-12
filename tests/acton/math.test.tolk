tolk 1.4

import "@acton/testing/expect"
import "@contracts/acton/constants"
import "@contracts/acton/helpers"

fun marketCapTon(virtualTonReserves: coins, virtualTokenReserves: coins): coins {
    return (virtualTonReserves * TOTAL_SUPPLY) / virtualTokenReserves;
}

fun quoteBuyTokens(tonIn: coins, virtualTonReserves: coins, virtualTokenReserves: coins): coins {
    val k = virtualTonReserves * virtualTokenReserves;
    val newVirtualTonReserves = virtualTonReserves + tonIn;
    val newVirtualTokenReserves = ceilDiv(k, newVirtualTonReserves);
    return virtualTokenReserves - newVirtualTokenReserves;
}

fun quoteSellTon(
    tokensInNet: coins,
    virtualTonReserves: coins,
    virtualTokenReserves: coins,
): coins {
    val k = virtualTonReserves * virtualTokenReserves;
    val newVirtualTokenReserves = virtualTokenReserves + tokensInNet;
    val newVirtualTonReserves = ceilDiv(k, newVirtualTokenReserves);
    return virtualTonReserves - newVirtualTonReserves;
}

get fun `test initial market cap equals launch target`() {
    val initialMarketCap = marketCapTon(INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
    expect(initialMarketCap).toEqual(START_MARKET_CAP_TON);
}

get fun `test migration market cap target is higher than launch target`() {
    expect(MIGRATION_MARKET_CAP_TON > START_MARKET_CAP_TON).toBeTrue();
}

get fun `test buy increases market cap`() {
    val tokensOut = quoteBuyTokens(ton("10"), INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
    val nextMarketCap = marketCapTon(
        INITIAL_VIRTUAL_TON + ton("10"),
        INITIAL_VIRTUAL_TOKENS - tokensOut,
    );

    expect(nextMarketCap > START_MARKET_CAP_TON).toBeTrue();
}

get fun `test sell decreases market cap after a buy`() {
    val tokensOut = quoteBuyTokens(ton("10"), INITIAL_VIRTUAL_TON, INITIAL_VIRTUAL_TOKENS);
    val boughtVirtualTon = INITIAL_VIRTUAL_TON + ton("10");
    val boughtVirtualTokens = INITIAL_VIRTUAL_TOKENS - tokensOut;
    val boughtMarketCap = marketCapTon(boughtVirtualTon, boughtVirtualTokens);

    val tonOut = quoteSellTon(tokensOut, boughtVirtualTon, boughtVirtualTokens);
    val soldMarketCap = marketCapTon(boughtVirtualTon - tonOut, boughtVirtualTokens + tokensOut);

    expect(soldMarketCap < boughtMarketCap).toBeTrue();
}
