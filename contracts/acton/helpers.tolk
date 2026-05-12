tolk 1.4

fun ceilDiv(a: int, b: int): int {
    return (a + b - 1) / b;
}

fun minInt(a: int, b: int): int {
    if (a < b) {
        return a;
    }

    return b;
}

fun maxInt(a: int, b: int): int {
    if (a > b) {
        return a;
    }

    return b;
}

fun inlineForwardPayload(payload: slice): RemainingBitsAndRefs {
    return beginCell().storeUint(0, 1).storeSlice(payload).endCell().beginParse();
}

fun refForwardPayload(payload: cell): RemainingBitsAndRefs {
    return beginCell().storeUint(1, 1).storeRef(payload).endCell().beginParse();
}

fun emptyForwardPayload(): RemainingBitsAndRefs {
    return inlineForwardPayload(createEmptySlice());
}

fun forwardPayloadSlice(payload: RemainingBitsAndRefs): slice {
    var cursor = payload;
    if (cursor.remainingBitsCount() < 1) {
        return createEmptySlice();
    }

    val eitherTag = cursor.loadUint(1);
    if (eitherTag == 0) {
        return cursor;
    }

    if (cursor.remainingRefsCount() > 0) {
        return cursor.loadRef().beginParse();
    }

    return createEmptySlice();
}

fun opFromPayloadSlice(payload: slice): int {
    if (payload.remainingBitsCount() >= 32) {
        return payload.preloadUint(32);
    }

    if (payload.remainingRefsCount() > 0 && payload.remainingBitsCount() >= 1) {
        val ref = payload.preloadMaybeRef();
        if (ref != null) {
            val refPayload = ref.beginParse();
            if (refPayload.remainingBitsCount() >= 32) {
                return refPayload.preloadUint(32);
            }
        }
    }

    return 0;
}

fun opFromForwardPayload(payload: RemainingBitsAndRefs): int {
    return opFromPayloadSlice(forwardPayloadSlice(payload));
}
