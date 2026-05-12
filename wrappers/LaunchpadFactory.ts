import {
    Cell,
    Slice,
    Address,
    Builder,
    beginCell,
    ComputeError,
    TupleItem,
    TupleReader,
    Dictionary,
    contractAddress,
    address,
    ContractProvider,
    Sender,
    Contract,
    ContractABI,
    ABIType,
    ABIGetter,
    ABIReceiver,
    TupleBuilder,
    DictionaryValue
} from '@ton/core';

export type DataSize = {
    $$type: 'DataSize';
    cells: bigint;
    bits: bigint;
    refs: bigint;
}

export function storeDataSize(src: DataSize) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.cells, 257);
        b_0.storeInt(src.bits, 257);
        b_0.storeInt(src.refs, 257);
    };
}

export function loadDataSize(slice: Slice) {
    const sc_0 = slice;
    const _cells = sc_0.loadIntBig(257);
    const _bits = sc_0.loadIntBig(257);
    const _refs = sc_0.loadIntBig(257);
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadGetterTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function storeTupleDataSize(source: DataSize) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.cells);
    builder.writeNumber(source.bits);
    builder.writeNumber(source.refs);
    return builder.build();
}

export function dictValueParserDataSize(): DictionaryValue<DataSize> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDataSize(src)).endCell());
        },
        parse: (src) => {
            return loadDataSize(src.loadRef().beginParse());
        }
    }
}

export type SignedBundle = {
    $$type: 'SignedBundle';
    signature: Buffer;
    signedData: Slice;
}

export function storeSignedBundle(src: SignedBundle) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBuffer(src.signature);
        b_0.storeBuilder(src.signedData.asBuilder());
    };
}

export function loadSignedBundle(slice: Slice) {
    const sc_0 = slice;
    const _signature = sc_0.loadBuffer(64);
    const _signedData = sc_0;
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadGetterTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function storeTupleSignedBundle(source: SignedBundle) {
    const builder = new TupleBuilder();
    builder.writeBuffer(source.signature);
    builder.writeSlice(source.signedData.asCell());
    return builder.build();
}

export function dictValueParserSignedBundle(): DictionaryValue<SignedBundle> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSignedBundle(src)).endCell());
        },
        parse: (src) => {
            return loadSignedBundle(src.loadRef().beginParse());
        }
    }
}

export type StateInit = {
    $$type: 'StateInit';
    code: Cell;
    data: Cell;
}

export function storeStateInit(src: StateInit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeRef(src.code);
        b_0.storeRef(src.data);
    };
}

export function loadStateInit(slice: Slice) {
    const sc_0 = slice;
    const _code = sc_0.loadRef();
    const _data = sc_0.loadRef();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadGetterTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function storeTupleStateInit(source: StateInit) {
    const builder = new TupleBuilder();
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    return builder.build();
}

export function dictValueParserStateInit(): DictionaryValue<StateInit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStateInit(src)).endCell());
        },
        parse: (src) => {
            return loadStateInit(src.loadRef().beginParse());
        }
    }
}

export type Context = {
    $$type: 'Context';
    bounceable: boolean;
    sender: Address;
    value: bigint;
    raw: Slice;
}

export function storeContext(src: Context) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.bounceable);
        b_0.storeAddress(src.sender);
        b_0.storeInt(src.value, 257);
        b_0.storeRef(src.raw.asCell());
    };
}

export function loadContext(slice: Slice) {
    const sc_0 = slice;
    const _bounceable = sc_0.loadBit();
    const _sender = sc_0.loadAddress();
    const _value = sc_0.loadIntBig(257);
    const _raw = sc_0.loadRef().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadGetterTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function storeTupleContext(source: Context) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.bounceable);
    builder.writeAddress(source.sender);
    builder.writeNumber(source.value);
    builder.writeSlice(source.raw.asCell());
    return builder.build();
}

export function dictValueParserContext(): DictionaryValue<Context> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeContext(src)).endCell());
        },
        parse: (src) => {
            return loadContext(src.loadRef().beginParse());
        }
    }
}

export type SendParameters = {
    $$type: 'SendParameters';
    mode: bigint;
    body: Cell | null;
    code: Cell | null;
    data: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeSendParameters(src: SendParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        if (src.code !== null && src.code !== undefined) { b_0.storeBit(true).storeRef(src.code); } else { b_0.storeBit(false); }
        if (src.data !== null && src.data !== undefined) { b_0.storeBit(true).storeRef(src.data); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadSendParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _code = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _data = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleSendParameters(source: SendParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserSendParameters(): DictionaryValue<SendParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSendParameters(src)).endCell());
        },
        parse: (src) => {
            return loadSendParameters(src.loadRef().beginParse());
        }
    }
}

export type MessageParameters = {
    $$type: 'MessageParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeMessageParameters(src: MessageParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadMessageParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleMessageParameters(source: MessageParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserMessageParameters(): DictionaryValue<MessageParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMessageParameters(src)).endCell());
        },
        parse: (src) => {
            return loadMessageParameters(src.loadRef().beginParse());
        }
    }
}

export type DeployParameters = {
    $$type: 'DeployParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    bounce: boolean;
    init: StateInit;
}

export function storeDeployParameters(src: DeployParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeBit(src.bounce);
        b_0.store(storeStateInit(src.init));
    };
}

export function loadDeployParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _bounce = sc_0.loadBit();
    const _init = loadStateInit(sc_0);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadGetterTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadGetterTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function storeTupleDeployParameters(source: DeployParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeBoolean(source.bounce);
    builder.writeTuple(storeTupleStateInit(source.init));
    return builder.build();
}

export function dictValueParserDeployParameters(): DictionaryValue<DeployParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployParameters(src)).endCell());
        },
        parse: (src) => {
            return loadDeployParameters(src.loadRef().beginParse());
        }
    }
}

export type StdAddress = {
    $$type: 'StdAddress';
    workchain: bigint;
    address: bigint;
}

export function storeStdAddress(src: StdAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 8);
        b_0.storeUint(src.address, 256);
    };
}

export function loadStdAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(8);
    const _address = sc_0.loadUintBig(256);
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleStdAddress(source: StdAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeNumber(source.address);
    return builder.build();
}

export function dictValueParserStdAddress(): DictionaryValue<StdAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStdAddress(src)).endCell());
        },
        parse: (src) => {
            return loadStdAddress(src.loadRef().beginParse());
        }
    }
}

export type VarAddress = {
    $$type: 'VarAddress';
    workchain: bigint;
    address: Slice;
}

export function storeVarAddress(src: VarAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 32);
        b_0.storeRef(src.address.asCell());
    };
}

export function loadVarAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(32);
    const _address = sc_0.loadRef().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleVarAddress(source: VarAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeSlice(source.address.asCell());
    return builder.build();
}

export function dictValueParserVarAddress(): DictionaryValue<VarAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeVarAddress(src)).endCell());
        },
        parse: (src) => {
            return loadVarAddress(src.loadRef().beginParse());
        }
    }
}

export type BasechainAddress = {
    $$type: 'BasechainAddress';
    hash: bigint | null;
}

export function storeBasechainAddress(src: BasechainAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        if (src.hash !== null && src.hash !== undefined) { b_0.storeBit(true).storeInt(src.hash, 257); } else { b_0.storeBit(false); }
    };
}

export function loadBasechainAddress(slice: Slice) {
    const sc_0 = slice;
    const _hash = sc_0.loadBit() ? sc_0.loadIntBig(257) : null;
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadGetterTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function storeTupleBasechainAddress(source: BasechainAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.hash);
    return builder.build();
}

export function dictValueParserBasechainAddress(): DictionaryValue<BasechainAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBasechainAddress(src)).endCell());
        },
        parse: (src) => {
            return loadBasechainAddress(src.loadRef().beginParse());
        }
    }
}

export type JettonWalletData = {
    $$type: 'JettonWalletData';
    balance: bigint;
    owner: Address;
    minter: Address;
    code: Cell;
}

export function storeJettonWalletData(src: JettonWalletData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.balance, 257);
        b_0.storeAddress(src.owner);
        b_0.storeAddress(src.minter);
        b_0.storeRef(src.code);
    };
}

export function loadJettonWalletData(slice: Slice) {
    const sc_0 = slice;
    const _balance = sc_0.loadIntBig(257);
    const _owner = sc_0.loadAddress();
    const _minter = sc_0.loadAddress();
    const _code = sc_0.loadRef();
    return { $$type: 'JettonWalletData' as const, balance: _balance, owner: _owner, minter: _minter, code: _code };
}

export function loadTupleJettonWalletData(source: TupleReader) {
    const _balance = source.readBigNumber();
    const _owner = source.readAddress();
    const _minter = source.readAddress();
    const _code = source.readCell();
    return { $$type: 'JettonWalletData' as const, balance: _balance, owner: _owner, minter: _minter, code: _code };
}

export function loadGetterTupleJettonWalletData(source: TupleReader) {
    const _balance = source.readBigNumber();
    const _owner = source.readAddress();
    const _minter = source.readAddress();
    const _code = source.readCell();
    return { $$type: 'JettonWalletData' as const, balance: _balance, owner: _owner, minter: _minter, code: _code };
}

export function storeTupleJettonWalletData(source: JettonWalletData) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.balance);
    builder.writeAddress(source.owner);
    builder.writeAddress(source.minter);
    builder.writeCell(source.code);
    return builder.build();
}

export function dictValueParserJettonWalletData(): DictionaryValue<JettonWalletData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonWalletData(src)).endCell());
        },
        parse: (src) => {
            return loadJettonWalletData(src.loadRef().beginParse());
        }
    }
}

export type JettonMinterState = {
    $$type: 'JettonMinterState';
    totalSupply: bigint;
    mintable: boolean;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

export function storeJettonMinterState(src: JettonMinterState) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.totalSupply);
        b_0.storeBit(src.mintable);
        b_0.storeAddress(src.adminAddress);
        b_0.storeRef(src.jettonContent);
        b_0.storeRef(src.jettonWalletCode);
    };
}

export function loadJettonMinterState(slice: Slice) {
    const sc_0 = slice;
    const _totalSupply = sc_0.loadCoins();
    const _mintable = sc_0.loadBit();
    const _adminAddress = sc_0.loadAddress();
    const _jettonContent = sc_0.loadRef();
    const _jettonWalletCode = sc_0.loadRef();
    return { $$type: 'JettonMinterState' as const, totalSupply: _totalSupply, mintable: _mintable, adminAddress: _adminAddress, jettonContent: _jettonContent, jettonWalletCode: _jettonWalletCode };
}

export function loadTupleJettonMinterState(source: TupleReader) {
    const _totalSupply = source.readBigNumber();
    const _mintable = source.readBoolean();
    const _adminAddress = source.readAddress();
    const _jettonContent = source.readCell();
    const _jettonWalletCode = source.readCell();
    return { $$type: 'JettonMinterState' as const, totalSupply: _totalSupply, mintable: _mintable, adminAddress: _adminAddress, jettonContent: _jettonContent, jettonWalletCode: _jettonWalletCode };
}

export function loadGetterTupleJettonMinterState(source: TupleReader) {
    const _totalSupply = source.readBigNumber();
    const _mintable = source.readBoolean();
    const _adminAddress = source.readAddress();
    const _jettonContent = source.readCell();
    const _jettonWalletCode = source.readCell();
    return { $$type: 'JettonMinterState' as const, totalSupply: _totalSupply, mintable: _mintable, adminAddress: _adminAddress, jettonContent: _jettonContent, jettonWalletCode: _jettonWalletCode };
}

export function storeTupleJettonMinterState(source: JettonMinterState) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.totalSupply);
    builder.writeBoolean(source.mintable);
    builder.writeAddress(source.adminAddress);
    builder.writeCell(source.jettonContent);
    builder.writeCell(source.jettonWalletCode);
    return builder.build();
}

export function dictValueParserJettonMinterState(): DictionaryValue<JettonMinterState> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonMinterState(src)).endCell());
        },
        parse: (src) => {
            return loadJettonMinterState(src.loadRef().beginParse());
        }
    }
}

export type JettonTransfer = {
    $$type: 'JettonTransfer';
    queryId: bigint;
    amount: bigint;
    destination: Address;
    responseDestination: Address | null;
    customPayload: Cell | null;
    forwardTonAmount: bigint;
    forwardPayload: Slice;
}

export function storeJettonTransfer(src: JettonTransfer) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(260734629, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.destination);
        b_0.storeAddress(src.responseDestination);
        if (src.customPayload !== null && src.customPayload !== undefined) { b_0.storeBit(true).storeRef(src.customPayload); } else { b_0.storeBit(false); }
        b_0.storeCoins(src.forwardTonAmount);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadJettonTransfer(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 260734629) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _destination = sc_0.loadAddress();
    const _responseDestination = sc_0.loadMaybeAddress();
    const _customPayload = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _forwardTonAmount = sc_0.loadCoins();
    const _forwardPayload = sc_0;
    return { $$type: 'JettonTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadTupleJettonTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _destination = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    const _customPayload = source.readCellOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'JettonTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadGetterTupleJettonTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _destination = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    const _customPayload = source.readCellOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'JettonTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function storeTupleJettonTransfer(source: JettonTransfer) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.destination);
    builder.writeAddress(source.responseDestination);
    builder.writeCell(source.customPayload);
    builder.writeNumber(source.forwardTonAmount);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserJettonTransfer(): DictionaryValue<JettonTransfer> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonTransfer(src)).endCell());
        },
        parse: (src) => {
            return loadJettonTransfer(src.loadRef().beginParse());
        }
    }
}

export type JettonTransferInternal = {
    $$type: 'JettonTransferInternal';
    queryId: bigint;
    amount: bigint;
    sender: Address;
    responseDestination: Address | null;
    forwardTonAmount: bigint;
    forwardPayload: Slice;
}

export function storeJettonTransferInternal(src: JettonTransferInternal) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(395134233, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.sender);
        b_0.storeAddress(src.responseDestination);
        b_0.storeCoins(src.forwardTonAmount);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadJettonTransferInternal(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 395134233) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _sender = sc_0.loadAddress();
    const _responseDestination = sc_0.loadMaybeAddress();
    const _forwardTonAmount = sc_0.loadCoins();
    const _forwardPayload = sc_0;
    return { $$type: 'JettonTransferInternal' as const, queryId: _queryId, amount: _amount, sender: _sender, responseDestination: _responseDestination, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadTupleJettonTransferInternal(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _sender = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'JettonTransferInternal' as const, queryId: _queryId, amount: _amount, sender: _sender, responseDestination: _responseDestination, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadGetterTupleJettonTransferInternal(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _sender = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'JettonTransferInternal' as const, queryId: _queryId, amount: _amount, sender: _sender, responseDestination: _responseDestination, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function storeTupleJettonTransferInternal(source: JettonTransferInternal) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.sender);
    builder.writeAddress(source.responseDestination);
    builder.writeNumber(source.forwardTonAmount);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserJettonTransferInternal(): DictionaryValue<JettonTransferInternal> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonTransferInternal(src)).endCell());
        },
        parse: (src) => {
            return loadJettonTransferInternal(src.loadRef().beginParse());
        }
    }
}

export type JettonNotification = {
    $$type: 'JettonNotification';
    queryId: bigint;
    amount: bigint;
    sender: Address;
    forwardPayload: Slice;
}

export function storeJettonNotification(src: JettonNotification) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1935855772, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.sender);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadJettonNotification(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1935855772) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _sender = sc_0.loadAddress();
    const _forwardPayload = sc_0;
    return { $$type: 'JettonNotification' as const, queryId: _queryId, amount: _amount, sender: _sender, forwardPayload: _forwardPayload };
}

export function loadTupleJettonNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _sender = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'JettonNotification' as const, queryId: _queryId, amount: _amount, sender: _sender, forwardPayload: _forwardPayload };
}

export function loadGetterTupleJettonNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _sender = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'JettonNotification' as const, queryId: _queryId, amount: _amount, sender: _sender, forwardPayload: _forwardPayload };
}

export function storeTupleJettonNotification(source: JettonNotification) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.sender);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserJettonNotification(): DictionaryValue<JettonNotification> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonNotification(src)).endCell());
        },
        parse: (src) => {
            return loadJettonNotification(src.loadRef().beginParse());
        }
    }
}

export type JettonBurn = {
    $$type: 'JettonBurn';
    queryId: bigint;
    amount: bigint;
    responseDestination: Address | null;
    customPayload: Cell | null;
}

export function storeJettonBurn(src: JettonBurn) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1499400124, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.responseDestination);
        if (src.customPayload !== null && src.customPayload !== undefined) { b_0.storeBit(true).storeRef(src.customPayload); } else { b_0.storeBit(false); }
    };
}

export function loadJettonBurn(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1499400124) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _responseDestination = sc_0.loadMaybeAddress();
    const _customPayload = sc_0.loadBit() ? sc_0.loadRef() : null;
    return { $$type: 'JettonBurn' as const, queryId: _queryId, amount: _amount, responseDestination: _responseDestination, customPayload: _customPayload };
}

export function loadTupleJettonBurn(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _responseDestination = source.readAddressOpt();
    const _customPayload = source.readCellOpt();
    return { $$type: 'JettonBurn' as const, queryId: _queryId, amount: _amount, responseDestination: _responseDestination, customPayload: _customPayload };
}

export function loadGetterTupleJettonBurn(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _responseDestination = source.readAddressOpt();
    const _customPayload = source.readCellOpt();
    return { $$type: 'JettonBurn' as const, queryId: _queryId, amount: _amount, responseDestination: _responseDestination, customPayload: _customPayload };
}

export function storeTupleJettonBurn(source: JettonBurn) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.responseDestination);
    builder.writeCell(source.customPayload);
    return builder.build();
}

export function dictValueParserJettonBurn(): DictionaryValue<JettonBurn> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonBurn(src)).endCell());
        },
        parse: (src) => {
            return loadJettonBurn(src.loadRef().beginParse());
        }
    }
}

export type JettonBurnNotification = {
    $$type: 'JettonBurnNotification';
    queryId: bigint;
    amount: bigint;
    sender: Address;
    responseDestination: Address | null;
}

export function storeJettonBurnNotification(src: JettonBurnNotification) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2078119902, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.sender);
        b_0.storeAddress(src.responseDestination);
    };
}

export function loadJettonBurnNotification(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2078119902) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _sender = sc_0.loadAddress();
    const _responseDestination = sc_0.loadMaybeAddress();
    return { $$type: 'JettonBurnNotification' as const, queryId: _queryId, amount: _amount, sender: _sender, responseDestination: _responseDestination };
}

export function loadTupleJettonBurnNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _sender = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    return { $$type: 'JettonBurnNotification' as const, queryId: _queryId, amount: _amount, sender: _sender, responseDestination: _responseDestination };
}

export function loadGetterTupleJettonBurnNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _sender = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    return { $$type: 'JettonBurnNotification' as const, queryId: _queryId, amount: _amount, sender: _sender, responseDestination: _responseDestination };
}

export function storeTupleJettonBurnNotification(source: JettonBurnNotification) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.sender);
    builder.writeAddress(source.responseDestination);
    return builder.build();
}

export function dictValueParserJettonBurnNotification(): DictionaryValue<JettonBurnNotification> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonBurnNotification(src)).endCell());
        },
        parse: (src) => {
            return loadJettonBurnNotification(src.loadRef().beginParse());
        }
    }
}

export type JettonExcesses = {
    $$type: 'JettonExcesses';
    queryId: bigint;
}

export function storeJettonExcesses(src: JettonExcesses) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(3576854235, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadJettonExcesses(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 3576854235) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'JettonExcesses' as const, queryId: _queryId };
}

export function loadTupleJettonExcesses(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'JettonExcesses' as const, queryId: _queryId };
}

export function loadGetterTupleJettonExcesses(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'JettonExcesses' as const, queryId: _queryId };
}

export function storeTupleJettonExcesses(source: JettonExcesses) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserJettonExcesses(): DictionaryValue<JettonExcesses> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonExcesses(src)).endCell());
        },
        parse: (src) => {
            return loadJettonExcesses(src.loadRef().beginParse());
        }
    }
}

export type ProvideWalletAddress = {
    $$type: 'ProvideWalletAddress';
    queryId: bigint;
    ownerAddress: Address;
    includeAddress: boolean;
}

export function storeProvideWalletAddress(src: ProvideWalletAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(745978227, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.ownerAddress);
        b_0.storeBit(src.includeAddress);
    };
}

export function loadProvideWalletAddress(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 745978227) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _ownerAddress = sc_0.loadAddress();
    const _includeAddress = sc_0.loadBit();
    return { $$type: 'ProvideWalletAddress' as const, queryId: _queryId, ownerAddress: _ownerAddress, includeAddress: _includeAddress };
}

export function loadTupleProvideWalletAddress(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _ownerAddress = source.readAddress();
    const _includeAddress = source.readBoolean();
    return { $$type: 'ProvideWalletAddress' as const, queryId: _queryId, ownerAddress: _ownerAddress, includeAddress: _includeAddress };
}

export function loadGetterTupleProvideWalletAddress(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _ownerAddress = source.readAddress();
    const _includeAddress = source.readBoolean();
    return { $$type: 'ProvideWalletAddress' as const, queryId: _queryId, ownerAddress: _ownerAddress, includeAddress: _includeAddress };
}

export function storeTupleProvideWalletAddress(source: ProvideWalletAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.ownerAddress);
    builder.writeBoolean(source.includeAddress);
    return builder.build();
}

export function dictValueParserProvideWalletAddress(): DictionaryValue<ProvideWalletAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeProvideWalletAddress(src)).endCell());
        },
        parse: (src) => {
            return loadProvideWalletAddress(src.loadRef().beginParse());
        }
    }
}

export type TakeWalletAddress = {
    $$type: 'TakeWalletAddress';
    queryId: bigint;
    walletAddress: Address;
    ownerAddress: Cell | null;
}

export function storeTakeWalletAddress(src: TakeWalletAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(3513996288, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.walletAddress);
        if (src.ownerAddress !== null && src.ownerAddress !== undefined) { b_0.storeBit(true).storeRef(src.ownerAddress); } else { b_0.storeBit(false); }
    };
}

export function loadTakeWalletAddress(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 3513996288) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _walletAddress = sc_0.loadAddress();
    const _ownerAddress = sc_0.loadBit() ? sc_0.loadRef() : null;
    return { $$type: 'TakeWalletAddress' as const, queryId: _queryId, walletAddress: _walletAddress, ownerAddress: _ownerAddress };
}

export function loadTupleTakeWalletAddress(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _walletAddress = source.readAddress();
    const _ownerAddress = source.readCellOpt();
    return { $$type: 'TakeWalletAddress' as const, queryId: _queryId, walletAddress: _walletAddress, ownerAddress: _ownerAddress };
}

export function loadGetterTupleTakeWalletAddress(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _walletAddress = source.readAddress();
    const _ownerAddress = source.readCellOpt();
    return { $$type: 'TakeWalletAddress' as const, queryId: _queryId, walletAddress: _walletAddress, ownerAddress: _ownerAddress };
}

export function storeTupleTakeWalletAddress(source: TakeWalletAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.walletAddress);
    builder.writeCell(source.ownerAddress);
    return builder.build();
}

export function dictValueParserTakeWalletAddress(): DictionaryValue<TakeWalletAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTakeWalletAddress(src)).endCell());
        },
        parse: (src) => {
            return loadTakeWalletAddress(src.loadRef().beginParse());
        }
    }
}

export type Mint = {
    $$type: 'Mint';
    queryId: bigint;
    receiver: Address;
    mintMessage: JettonTransferInternal;
}

export function storeMint(src: Mint) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1680571655, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.receiver);
        const b_1 = new Builder();
        b_1.store(storeJettonTransferInternal(src.mintMessage));
        b_0.storeRef(b_1.endCell());
    };
}

export function loadMint(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1680571655) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _receiver = sc_0.loadAddress();
    const sc_1 = sc_0.loadRef().beginParse();
    const _mintMessage = loadJettonTransferInternal(sc_1);
    return { $$type: 'Mint' as const, queryId: _queryId, receiver: _receiver, mintMessage: _mintMessage };
}

export function loadTupleMint(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _receiver = source.readAddress();
    const _mintMessage = loadTupleJettonTransferInternal(source);
    return { $$type: 'Mint' as const, queryId: _queryId, receiver: _receiver, mintMessage: _mintMessage };
}

export function loadGetterTupleMint(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _receiver = source.readAddress();
    const _mintMessage = loadGetterTupleJettonTransferInternal(source);
    return { $$type: 'Mint' as const, queryId: _queryId, receiver: _receiver, mintMessage: _mintMessage };
}

export function storeTupleMint(source: Mint) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.receiver);
    builder.writeTuple(storeTupleJettonTransferInternal(source.mintMessage));
    return builder.build();
}

export function dictValueParserMint(): DictionaryValue<Mint> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMint(src)).endCell());
        },
        parse: (src) => {
            return loadMint(src.loadRef().beginParse());
        }
    }
}

export type ChangeOwner = {
    $$type: 'ChangeOwner';
    queryId: bigint;
    newOwner: Address;
}

export function storeChangeOwner(src: ChangeOwner) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(305419896, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.newOwner);
    };
}

export function loadChangeOwner(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 305419896) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _newOwner = sc_0.loadAddress();
    return { $$type: 'ChangeOwner' as const, queryId: _queryId, newOwner: _newOwner };
}

export function loadTupleChangeOwner(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'ChangeOwner' as const, queryId: _queryId, newOwner: _newOwner };
}

export function loadGetterTupleChangeOwner(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'ChangeOwner' as const, queryId: _queryId, newOwner: _newOwner };
}

export function storeTupleChangeOwner(source: ChangeOwner) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.newOwner);
    return builder.build();
}

export function dictValueParserChangeOwner(): DictionaryValue<ChangeOwner> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeChangeOwner(src)).endCell());
        },
        parse: (src) => {
            return loadChangeOwner(src.loadRef().beginParse());
        }
    }
}

export type BuyTokens = {
    $$type: 'BuyTokens';
    queryId: bigint;
    minTokensOut: bigint;
}

export function storeBuyTokens(src: BuyTokens) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(65537, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.minTokensOut);
    };
}

export function loadBuyTokens(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 65537) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _minTokensOut = sc_0.loadCoins();
    return { $$type: 'BuyTokens' as const, queryId: _queryId, minTokensOut: _minTokensOut };
}

export function loadTupleBuyTokens(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _minTokensOut = source.readBigNumber();
    return { $$type: 'BuyTokens' as const, queryId: _queryId, minTokensOut: _minTokensOut };
}

export function loadGetterTupleBuyTokens(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _minTokensOut = source.readBigNumber();
    return { $$type: 'BuyTokens' as const, queryId: _queryId, minTokensOut: _minTokensOut };
}

export function storeTupleBuyTokens(source: BuyTokens) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.minTokensOut);
    return builder.build();
}

export function dictValueParserBuyTokens(): DictionaryValue<BuyTokens> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBuyTokens(src)).endCell());
        },
        parse: (src) => {
            return loadBuyTokens(src.loadRef().beginParse());
        }
    }
}

export type SellTokens = {
    $$type: 'SellTokens';
    queryId: bigint;
    minTonOut: bigint;
}

export function storeSellTokens(src: SellTokens) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(65538, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.minTonOut);
    };
}

export function loadSellTokens(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 65538) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _minTonOut = sc_0.loadCoins();
    return { $$type: 'SellTokens' as const, queryId: _queryId, minTonOut: _minTonOut };
}

export function loadTupleSellTokens(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _minTonOut = source.readBigNumber();
    return { $$type: 'SellTokens' as const, queryId: _queryId, minTonOut: _minTonOut };
}

export function loadGetterTupleSellTokens(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _minTonOut = source.readBigNumber();
    return { $$type: 'SellTokens' as const, queryId: _queryId, minTonOut: _minTonOut };
}

export function storeTupleSellTokens(source: SellTokens) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.minTonOut);
    return builder.build();
}

export function dictValueParserSellTokens(): DictionaryValue<SellTokens> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSellTokens(src)).endCell());
        },
        parse: (src) => {
            return loadSellTokens(src.loadRef().beginParse());
        }
    }
}

export type MigrateToStonfi = {
    $$type: 'MigrateToStonfi';
    queryId: bigint;
}

export function storeMigrateToStonfi(src: MigrateToStonfi) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(65539, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadMigrateToStonfi(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 65539) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'MigrateToStonfi' as const, queryId: _queryId };
}

export function loadTupleMigrateToStonfi(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'MigrateToStonfi' as const, queryId: _queryId };
}

export function loadGetterTupleMigrateToStonfi(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'MigrateToStonfi' as const, queryId: _queryId };
}

export function storeTupleMigrateToStonfi(source: MigrateToStonfi) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserMigrateToStonfi(): DictionaryValue<MigrateToStonfi> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMigrateToStonfi(src)).endCell());
        },
        parse: (src) => {
            return loadMigrateToStonfi(src.loadRef().beginParse());
        }
    }
}

export type ConfigureDedustMigration = {
    $$type: 'ConfigureDedustMigration';
    queryId: bigint;
    nativeVault: Address;
    jettonVault: Address;
    pool: Address;
}

export function storeConfigureDedustMigration(src: ConfigureDedustMigration) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(65541, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.nativeVault);
        b_0.storeAddress(src.jettonVault);
        b_0.storeAddress(src.pool);
    };
}

export function loadConfigureDedustMigration(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 65541) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _nativeVault = sc_0.loadAddress();
    const _jettonVault = sc_0.loadAddress();
    const _pool = sc_0.loadAddress();
    return { $$type: 'ConfigureDedustMigration' as const, queryId: _queryId, nativeVault: _nativeVault, jettonVault: _jettonVault, pool: _pool };
}

export function loadTupleConfigureDedustMigration(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _nativeVault = source.readAddress();
    const _jettonVault = source.readAddress();
    const _pool = source.readAddress();
    return { $$type: 'ConfigureDedustMigration' as const, queryId: _queryId, nativeVault: _nativeVault, jettonVault: _jettonVault, pool: _pool };
}

export function loadGetterTupleConfigureDedustMigration(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _nativeVault = source.readAddress();
    const _jettonVault = source.readAddress();
    const _pool = source.readAddress();
    return { $$type: 'ConfigureDedustMigration' as const, queryId: _queryId, nativeVault: _nativeVault, jettonVault: _jettonVault, pool: _pool };
}

export function storeTupleConfigureDedustMigration(source: ConfigureDedustMigration) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.nativeVault);
    builder.writeAddress(source.jettonVault);
    builder.writeAddress(source.pool);
    return builder.build();
}

export function dictValueParserConfigureDedustMigration(): DictionaryValue<ConfigureDedustMigration> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeConfigureDedustMigration(src)).endCell());
        },
        parse: (src) => {
            return loadConfigureDedustMigration(src.loadRef().beginParse());
        }
    }
}

export type DeployToken = {
    $$type: 'DeployToken';
    queryId: bigint;
    jettonContent: Cell;
}

export function storeDeployToken(src: DeployToken) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(131073, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeRef(src.jettonContent);
    };
}

export function loadDeployToken(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 131073) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _jettonContent = sc_0.loadRef();
    return { $$type: 'DeployToken' as const, queryId: _queryId, jettonContent: _jettonContent };
}

export function loadTupleDeployToken(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _jettonContent = source.readCell();
    return { $$type: 'DeployToken' as const, queryId: _queryId, jettonContent: _jettonContent };
}

export function loadGetterTupleDeployToken(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _jettonContent = source.readCell();
    return { $$type: 'DeployToken' as const, queryId: _queryId, jettonContent: _jettonContent };
}

export function storeTupleDeployToken(source: DeployToken) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeCell(source.jettonContent);
    return builder.build();
}

export function dictValueParserDeployToken(): DictionaryValue<DeployToken> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployToken(src)).endCell());
        },
        parse: (src) => {
            return loadDeployToken(src.loadRef().beginParse());
        }
    }
}

export type TokenDeployed = {
    $$type: 'TokenDeployed';
    queryId: bigint;
    bondingCurveAddress: Address;
    jettonMasterAddress: Address;
    creator: Address;
}

export function storeTokenDeployed(src: TokenDeployed) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(131074, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.bondingCurveAddress);
        b_0.storeAddress(src.jettonMasterAddress);
        b_0.storeAddress(src.creator);
    };
}

export function loadTokenDeployed(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 131074) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _bondingCurveAddress = sc_0.loadAddress();
    const _jettonMasterAddress = sc_0.loadAddress();
    const _creator = sc_0.loadAddress();
    return { $$type: 'TokenDeployed' as const, queryId: _queryId, bondingCurveAddress: _bondingCurveAddress, jettonMasterAddress: _jettonMasterAddress, creator: _creator };
}

export function loadTupleTokenDeployed(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _bondingCurveAddress = source.readAddress();
    const _jettonMasterAddress = source.readAddress();
    const _creator = source.readAddress();
    return { $$type: 'TokenDeployed' as const, queryId: _queryId, bondingCurveAddress: _bondingCurveAddress, jettonMasterAddress: _jettonMasterAddress, creator: _creator };
}

export function loadGetterTupleTokenDeployed(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _bondingCurveAddress = source.readAddress();
    const _jettonMasterAddress = source.readAddress();
    const _creator = source.readAddress();
    return { $$type: 'TokenDeployed' as const, queryId: _queryId, bondingCurveAddress: _bondingCurveAddress, jettonMasterAddress: _jettonMasterAddress, creator: _creator };
}

export function storeTupleTokenDeployed(source: TokenDeployed) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.bondingCurveAddress);
    builder.writeAddress(source.jettonMasterAddress);
    builder.writeAddress(source.creator);
    return builder.build();
}

export function dictValueParserTokenDeployed(): DictionaryValue<TokenDeployed> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenDeployed(src)).endCell());
        },
        parse: (src) => {
            return loadTokenDeployed(src.loadRef().beginParse());
        }
    }
}

export type BondingCurve$Data = {
    $$type: 'BondingCurve$Data';
    virtualTonReserves: bigint;
    virtualTokenReserves: bigint;
    realTonReserves: bigint;
    realTokenReserves: bigint;
    migrated: boolean;
    jettonMaster: Address;
    creator: Address;
    platformWallet: Address;
    createdAt: bigint;
    dedustNativeVault: Address;
    dedustJettonVault: Address;
    dedustPool: Address;
}

export function storeBondingCurve$Data(src: BondingCurve$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.virtualTonReserves);
        b_0.storeCoins(src.virtualTokenReserves);
        b_0.storeCoins(src.realTonReserves);
        b_0.storeCoins(src.realTokenReserves);
        b_0.storeBit(src.migrated);
        b_0.storeAddress(src.jettonMaster);
        const b_1 = new Builder();
        b_1.storeAddress(src.creator);
        b_1.storeAddress(src.platformWallet);
        b_1.storeUint(src.createdAt, 32);
        b_1.storeAddress(src.dedustNativeVault);
        const b_2 = new Builder();
        b_2.storeAddress(src.dedustJettonVault);
        b_2.storeAddress(src.dedustPool);
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadBondingCurve$Data(slice: Slice) {
    const sc_0 = slice;
    const _virtualTonReserves = sc_0.loadCoins();
    const _virtualTokenReserves = sc_0.loadCoins();
    const _realTonReserves = sc_0.loadCoins();
    const _realTokenReserves = sc_0.loadCoins();
    const _migrated = sc_0.loadBit();
    const _jettonMaster = sc_0.loadAddress();
    const sc_1 = sc_0.loadRef().beginParse();
    const _creator = sc_1.loadAddress();
    const _platformWallet = sc_1.loadAddress();
    const _createdAt = sc_1.loadUintBig(32);
    const _dedustNativeVault = sc_1.loadAddress();
    const sc_2 = sc_1.loadRef().beginParse();
    const _dedustJettonVault = sc_2.loadAddress();
    const _dedustPool = sc_2.loadAddress();
    return { $$type: 'BondingCurve$Data' as const, virtualTonReserves: _virtualTonReserves, virtualTokenReserves: _virtualTokenReserves, realTonReserves: _realTonReserves, realTokenReserves: _realTokenReserves, migrated: _migrated, jettonMaster: _jettonMaster, creator: _creator, platformWallet: _platformWallet, createdAt: _createdAt, dedustNativeVault: _dedustNativeVault, dedustJettonVault: _dedustJettonVault, dedustPool: _dedustPool };
}

export function loadTupleBondingCurve$Data(source: TupleReader) {
    const _virtualTonReserves = source.readBigNumber();
    const _virtualTokenReserves = source.readBigNumber();
    const _realTonReserves = source.readBigNumber();
    const _realTokenReserves = source.readBigNumber();
    const _migrated = source.readBoolean();
    const _jettonMaster = source.readAddress();
    const _creator = source.readAddress();
    const _platformWallet = source.readAddress();
    const _createdAt = source.readBigNumber();
    const _dedustNativeVault = source.readAddress();
    const _dedustJettonVault = source.readAddress();
    const _dedustPool = source.readAddress();
    return { $$type: 'BondingCurve$Data' as const, virtualTonReserves: _virtualTonReserves, virtualTokenReserves: _virtualTokenReserves, realTonReserves: _realTonReserves, realTokenReserves: _realTokenReserves, migrated: _migrated, jettonMaster: _jettonMaster, creator: _creator, platformWallet: _platformWallet, createdAt: _createdAt, dedustNativeVault: _dedustNativeVault, dedustJettonVault: _dedustJettonVault, dedustPool: _dedustPool };
}

export function loadGetterTupleBondingCurve$Data(source: TupleReader) {
    const _virtualTonReserves = source.readBigNumber();
    const _virtualTokenReserves = source.readBigNumber();
    const _realTonReserves = source.readBigNumber();
    const _realTokenReserves = source.readBigNumber();
    const _migrated = source.readBoolean();
    const _jettonMaster = source.readAddress();
    const _creator = source.readAddress();
    const _platformWallet = source.readAddress();
    const _createdAt = source.readBigNumber();
    const _dedustNativeVault = source.readAddress();
    const _dedustJettonVault = source.readAddress();
    const _dedustPool = source.readAddress();
    return { $$type: 'BondingCurve$Data' as const, virtualTonReserves: _virtualTonReserves, virtualTokenReserves: _virtualTokenReserves, realTonReserves: _realTonReserves, realTokenReserves: _realTokenReserves, migrated: _migrated, jettonMaster: _jettonMaster, creator: _creator, platformWallet: _platformWallet, createdAt: _createdAt, dedustNativeVault: _dedustNativeVault, dedustJettonVault: _dedustJettonVault, dedustPool: _dedustPool };
}

export function storeTupleBondingCurve$Data(source: BondingCurve$Data) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.virtualTonReserves);
    builder.writeNumber(source.virtualTokenReserves);
    builder.writeNumber(source.realTonReserves);
    builder.writeNumber(source.realTokenReserves);
    builder.writeBoolean(source.migrated);
    builder.writeAddress(source.jettonMaster);
    builder.writeAddress(source.creator);
    builder.writeAddress(source.platformWallet);
    builder.writeNumber(source.createdAt);
    builder.writeAddress(source.dedustNativeVault);
    builder.writeAddress(source.dedustJettonVault);
    builder.writeAddress(source.dedustPool);
    return builder.build();
}

export function dictValueParserBondingCurve$Data(): DictionaryValue<BondingCurve$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBondingCurve$Data(src)).endCell());
        },
        parse: (src) => {
            return loadBondingCurve$Data(src.loadRef().beginParse());
        }
    }
}

export type ReserveData = {
    $$type: 'ReserveData';
    virtualTonReserves: bigint;
    virtualTokenReserves: bigint;
    realTonReserves: bigint;
    realTokenReserves: bigint;
    migrated: boolean;
}

export function storeReserveData(src: ReserveData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.virtualTonReserves);
        b_0.storeCoins(src.virtualTokenReserves);
        b_0.storeCoins(src.realTonReserves);
        b_0.storeCoins(src.realTokenReserves);
        b_0.storeBit(src.migrated);
    };
}

export function loadReserveData(slice: Slice) {
    const sc_0 = slice;
    const _virtualTonReserves = sc_0.loadCoins();
    const _virtualTokenReserves = sc_0.loadCoins();
    const _realTonReserves = sc_0.loadCoins();
    const _realTokenReserves = sc_0.loadCoins();
    const _migrated = sc_0.loadBit();
    return { $$type: 'ReserveData' as const, virtualTonReserves: _virtualTonReserves, virtualTokenReserves: _virtualTokenReserves, realTonReserves: _realTonReserves, realTokenReserves: _realTokenReserves, migrated: _migrated };
}

export function loadTupleReserveData(source: TupleReader) {
    const _virtualTonReserves = source.readBigNumber();
    const _virtualTokenReserves = source.readBigNumber();
    const _realTonReserves = source.readBigNumber();
    const _realTokenReserves = source.readBigNumber();
    const _migrated = source.readBoolean();
    return { $$type: 'ReserveData' as const, virtualTonReserves: _virtualTonReserves, virtualTokenReserves: _virtualTokenReserves, realTonReserves: _realTonReserves, realTokenReserves: _realTokenReserves, migrated: _migrated };
}

export function loadGetterTupleReserveData(source: TupleReader) {
    const _virtualTonReserves = source.readBigNumber();
    const _virtualTokenReserves = source.readBigNumber();
    const _realTonReserves = source.readBigNumber();
    const _realTokenReserves = source.readBigNumber();
    const _migrated = source.readBoolean();
    return { $$type: 'ReserveData' as const, virtualTonReserves: _virtualTonReserves, virtualTokenReserves: _virtualTokenReserves, realTonReserves: _realTonReserves, realTokenReserves: _realTokenReserves, migrated: _migrated };
}

export function storeTupleReserveData(source: ReserveData) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.virtualTonReserves);
    builder.writeNumber(source.virtualTokenReserves);
    builder.writeNumber(source.realTonReserves);
    builder.writeNumber(source.realTokenReserves);
    builder.writeBoolean(source.migrated);
    return builder.build();
}

export function dictValueParserReserveData(): DictionaryValue<ReserveData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeReserveData(src)).endCell());
        },
        parse: (src) => {
            return loadReserveData(src.loadRef().beginParse());
        }
    }
}

export type QuoteResult = {
    $$type: 'QuoteResult';
    amountOut: bigint;
    fee: bigint;
}

export function storeQuoteResult(src: QuoteResult) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.amountOut);
        b_0.storeCoins(src.fee);
    };
}

export function loadQuoteResult(slice: Slice) {
    const sc_0 = slice;
    const _amountOut = sc_0.loadCoins();
    const _fee = sc_0.loadCoins();
    return { $$type: 'QuoteResult' as const, amountOut: _amountOut, fee: _fee };
}

export function loadTupleQuoteResult(source: TupleReader) {
    const _amountOut = source.readBigNumber();
    const _fee = source.readBigNumber();
    return { $$type: 'QuoteResult' as const, amountOut: _amountOut, fee: _fee };
}

export function loadGetterTupleQuoteResult(source: TupleReader) {
    const _amountOut = source.readBigNumber();
    const _fee = source.readBigNumber();
    return { $$type: 'QuoteResult' as const, amountOut: _amountOut, fee: _fee };
}

export function storeTupleQuoteResult(source: QuoteResult) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.amountOut);
    builder.writeNumber(source.fee);
    return builder.build();
}

export function dictValueParserQuoteResult(): DictionaryValue<QuoteResult> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeQuoteResult(src)).endCell());
        },
        parse: (src) => {
            return loadQuoteResult(src.loadRef().beginParse());
        }
    }
}

export type JettonMaster$Data = {
    $$type: 'JettonMaster$Data';
    totalSupply: bigint;
    owner: Address;
    factory: Address;
    platformWallet: Address;
    jettonContent: Cell;
    mintable: boolean;
}

export function storeJettonMaster$Data(src: JettonMaster$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.totalSupply);
        b_0.storeAddress(src.owner);
        b_0.storeAddress(src.factory);
        b_0.storeAddress(src.platformWallet);
        b_0.storeRef(src.jettonContent);
        b_0.storeBit(src.mintable);
    };
}

export function loadJettonMaster$Data(slice: Slice) {
    const sc_0 = slice;
    const _totalSupply = sc_0.loadCoins();
    const _owner = sc_0.loadAddress();
    const _factory = sc_0.loadAddress();
    const _platformWallet = sc_0.loadAddress();
    const _jettonContent = sc_0.loadRef();
    const _mintable = sc_0.loadBit();
    return { $$type: 'JettonMaster$Data' as const, totalSupply: _totalSupply, owner: _owner, factory: _factory, platformWallet: _platformWallet, jettonContent: _jettonContent, mintable: _mintable };
}

export function loadTupleJettonMaster$Data(source: TupleReader) {
    const _totalSupply = source.readBigNumber();
    const _owner = source.readAddress();
    const _factory = source.readAddress();
    const _platformWallet = source.readAddress();
    const _jettonContent = source.readCell();
    const _mintable = source.readBoolean();
    return { $$type: 'JettonMaster$Data' as const, totalSupply: _totalSupply, owner: _owner, factory: _factory, platformWallet: _platformWallet, jettonContent: _jettonContent, mintable: _mintable };
}

export function loadGetterTupleJettonMaster$Data(source: TupleReader) {
    const _totalSupply = source.readBigNumber();
    const _owner = source.readAddress();
    const _factory = source.readAddress();
    const _platformWallet = source.readAddress();
    const _jettonContent = source.readCell();
    const _mintable = source.readBoolean();
    return { $$type: 'JettonMaster$Data' as const, totalSupply: _totalSupply, owner: _owner, factory: _factory, platformWallet: _platformWallet, jettonContent: _jettonContent, mintable: _mintable };
}

export function storeTupleJettonMaster$Data(source: JettonMaster$Data) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.totalSupply);
    builder.writeAddress(source.owner);
    builder.writeAddress(source.factory);
    builder.writeAddress(source.platformWallet);
    builder.writeCell(source.jettonContent);
    builder.writeBoolean(source.mintable);
    return builder.build();
}

export function dictValueParserJettonMaster$Data(): DictionaryValue<JettonMaster$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonMaster$Data(src)).endCell());
        },
        parse: (src) => {
            return loadJettonMaster$Data(src.loadRef().beginParse());
        }
    }
}

export type JettonWallet$Data = {
    $$type: 'JettonWallet$Data';
    owner: Address;
    minter: Address;
    balance: bigint;
    platformWallet: Address;
}

export function storeJettonWallet$Data(src: JettonWallet$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.owner);
        b_0.storeAddress(src.minter);
        b_0.storeCoins(src.balance);
        b_0.storeAddress(src.platformWallet);
    };
}

export function loadJettonWallet$Data(slice: Slice) {
    const sc_0 = slice;
    const _owner = sc_0.loadAddress();
    const _minter = sc_0.loadAddress();
    const _balance = sc_0.loadCoins();
    const _platformWallet = sc_0.loadAddress();
    return { $$type: 'JettonWallet$Data' as const, owner: _owner, minter: _minter, balance: _balance, platformWallet: _platformWallet };
}

export function loadTupleJettonWallet$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _minter = source.readAddress();
    const _balance = source.readBigNumber();
    const _platformWallet = source.readAddress();
    return { $$type: 'JettonWallet$Data' as const, owner: _owner, minter: _minter, balance: _balance, platformWallet: _platformWallet };
}

export function loadGetterTupleJettonWallet$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _minter = source.readAddress();
    const _balance = source.readBigNumber();
    const _platformWallet = source.readAddress();
    return { $$type: 'JettonWallet$Data' as const, owner: _owner, minter: _minter, balance: _balance, platformWallet: _platformWallet };
}

export function storeTupleJettonWallet$Data(source: JettonWallet$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeAddress(source.minter);
    builder.writeNumber(source.balance);
    builder.writeAddress(source.platformWallet);
    return builder.build();
}

export function dictValueParserJettonWallet$Data(): DictionaryValue<JettonWallet$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeJettonWallet$Data(src)).endCell());
        },
        parse: (src) => {
            return loadJettonWallet$Data(src.loadRef().beginParse());
        }
    }
}

export type LaunchpadFactory$Data = {
    $$type: 'LaunchpadFactory$Data';
    owner: Address;
    platformWallet: Address;
    tokenCount: bigint;
}

export function storeLaunchpadFactory$Data(src: LaunchpadFactory$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.owner);
        b_0.storeAddress(src.platformWallet);
        b_0.storeUint(src.tokenCount, 32);
    };
}

export function loadLaunchpadFactory$Data(slice: Slice) {
    const sc_0 = slice;
    const _owner = sc_0.loadAddress();
    const _platformWallet = sc_0.loadAddress();
    const _tokenCount = sc_0.loadUintBig(32);
    return { $$type: 'LaunchpadFactory$Data' as const, owner: _owner, platformWallet: _platformWallet, tokenCount: _tokenCount };
}

export function loadTupleLaunchpadFactory$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _platformWallet = source.readAddress();
    const _tokenCount = source.readBigNumber();
    return { $$type: 'LaunchpadFactory$Data' as const, owner: _owner, platformWallet: _platformWallet, tokenCount: _tokenCount };
}

export function loadGetterTupleLaunchpadFactory$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _platformWallet = source.readAddress();
    const _tokenCount = source.readBigNumber();
    return { $$type: 'LaunchpadFactory$Data' as const, owner: _owner, platformWallet: _platformWallet, tokenCount: _tokenCount };
}

export function storeTupleLaunchpadFactory$Data(source: LaunchpadFactory$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeAddress(source.platformWallet);
    builder.writeNumber(source.tokenCount);
    return builder.build();
}

export function dictValueParserLaunchpadFactory$Data(): DictionaryValue<LaunchpadFactory$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeLaunchpadFactory$Data(src)).endCell());
        },
        parse: (src) => {
            return loadLaunchpadFactory$Data(src.loadRef().beginParse());
        }
    }
}

 type LaunchpadFactory_init_args = {
    $$type: 'LaunchpadFactory_init_args';
    owner: Address;
    platformWallet: Address;
    tokenCount: bigint;
}

function initLaunchpadFactory_init_args(src: LaunchpadFactory_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.owner);
        b_0.storeAddress(src.platformWallet);
        b_0.storeUint(src.tokenCount, 32);
    };
}

async function LaunchpadFactory_init(owner: Address, platformWallet: Address, tokenCount: bigint) {
    const __code = Cell.fromHex('b5ee9c7241025f0100164a000228ff008e88f4a413f4bcf2c80bed5320e303ed43d9010902027102040127bff8ef6a2687d207d20698faa903609ed9e3618c0300022102012005070127b8e89ed44d0fa40fa40d31f55206c13db3c6c318060002220127b98b5ed44d0fa40fa40d31f55206c13db3c6c3180800022002e230eda2edfb01d072d721d200d200fa4021103450666f04f86102f862ed44d0fa40fa40d31f55206c1304925f04e022d749c21f8e8d02d31f0182020001bae3026c22923032e2f90182f0158e394e7cc73a9aeb362957fe037665588aef16f3bd68580c13ab84097cf22abae30230f2c0820a5e04eed33fd430f8416f24303182009bd03282101dcd6500bef2f4f84205a470f828f828550252757fdb3c5c705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d08218fb7504300082300ee40fd0a3fe80007082300b01a83f7b5cc00070f82389890b1e1e1d012288c855515065fa0213cecece12ccca00c90c0228ff008e88f4a413f4bcf2c80bed5320e303ed43d90d1202038e660e100135adbcf6a2687d007d207d207d206a69002aa8360b2a82ed9e3630c00f015edb3c705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d01a0131af16f6a2687d007d207d207d206a69002aa8360b6d9e3632c011010e885466205467503802f230eda2edfb01d072d721d200d200fa4021103450666f04f86102f862ed44d0fa00fa40fa40fa40d4d20055506c16078e3b058020d7217021d749c21f9430d31f01de8210178d4519ba8e1ed33ffa00596c2114a1443512c855505065fa0213cecece12ccca00c9ed54e05f07e025d749c21f9136e30d04f901131c03fe05d31f2182102c76b973bae302218210642b7d07ba8ee631d33f31fa40d430d0d31f018210178d4519baf2e081d33ffa00fa40d72c01916d93fa4001e201fa00515515144330368200e0ebf8422bc705f2f48200aa232df2f451a3a0f8416f24fa40fa0071d721fa00fa00306c6170f83a3044307050547f805050d8c8e02114161803f431d33ffa40d2003021fa4430c0008eab105610461036467827db3c20f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400309a6d304678102510241023e227db3c6c62705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d0031a1a15008095c858cf16c992316de212c855208210d17354005004cb1f12cb3fcef400c9f84270804043137fc8cf8580ca00cf8440ce01fa02806acf40f400c901fb00db3102fe55508210178d45195007cb1f15cb3f5003fa02ce01206e9430cf84809201cee201fa02cec9102610571024103749a9db3c105b10491038102a103510245f41f90001f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f9040003c8cf8580ca0012cccccf884008cbff01fa028069cf40cf8634f400c901fb0050541a17002c4330c855505065fa0213cecece12ccca00c9ed54db310198821012345678ba8e3531d33f31fa40308127e9f84224c70592347f96f8425005c705e214f2f410355512c855505065fa0213cecece12ccca00c9ed54db31e00182107bdd97debae3023610451902eed33ffa00fa40d72c01916d93fa4001e231f842fa4410691058104710394ab9db3c20f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f9040081287b0cc00097206ef2d08019ba93303870e21af2f45034a1266eb3923435e30d4153c855505065fa0213cecece12ccca00c9ed54db311a1b010cf8287025db3c37006a06206ef2d08004c8018210d53276db58cb1fcb3fc914707080425044c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00102400b882f03bbf4868a19e6b2ff79609cc6e3bfa15755e0f009733582095e8d74fec257355ba8e31810eb6f84223c705f2f470f842c8cf8508ce70cf0b6ec98042fb0010354430c855505065fa0213cecece12ccca00c9ed54e05f05f2c08203fe8929045611045611414403db3c5c705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d0821008f0d180717f53a3c8598210123456785003cb1fcb3fcec9103540145038191045102410235f41f90001f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff711e1f5b004380000000000000000000000000000000000000000000000000000000000000000010015688c855b150cbfa025009fa025007fa025005fa0213ca00ce01c8ce12ce12cb1f12ce03c8ce12ce12cdcdc9200228ff008e88f4a413f4bcf2c80bed5320e303ed43d9212f02027122270201482325016db7d1fda89a1f401f401f401f401a401f481a803a1f481f481a63ff481a861a1f481f4806020d820d620d420d220d020ced839b678d98302400242b82103b9aca00a882103b9aca00a82ba904016db72afda89a1f401f401f401f401a401f481a803a1f481f481a63ff481a861a1f481f4806020d820d620d420d220d020ced839b678d98b026000a547ba953ba02016e282a016db37afb51343e803e803e803e8034803e903500743e903e9034c7fe90350c343e903e900c041b041ac41a841a441a0419db0736cf1b3060290002270201202b2d0171ace376a2687d007d007d007d0069007d206a00e87d207d20698ffd206a18687d207d2018083608358835083488340833b60e2a85ed9e3661402c005c8200dda621c200f2f4208100c8a8812710a90466a18200ad4921c200f2f453dca852d2a066a0a501a90452d0a1010171af0c76a2687d007d007d007d0069007d206a00e87d207d20698ffd206a18687d207d2018083608358835083488340833b60e2a85ed9e3661402e003481194721c200f2f47053dca852e3a05122a0a558a90452c0a10102f43001d072d721d200d200fa4021103450666f04f86102f862ed44d0fa00fa00fa00fa00d200fa40d401d0fa40fa40d31ffa40d430d0fa40fa4030106c106b106a1069106810676c1c0d8e1e10bc5f0c8020d7217021d749c21f9430d31f309131e28210642b7d07badce00bd70d1ff2e0822182010001bae30221303301fc31d33ffa003081726528b3f2f4f8416f24135f0320821005f5e100a18200bcd521c200f2f48200b67621c200f2f453b0a082100bebc200be8e2a3082102faf0800a18200b14821c200f2f48200b67621c200f2f48200b14853b1a082100bebc200bef2f49131e253cba851d1a051dda0a52da90451cca18200cf9121c2003101fef2f4208200a23904be13f2f4817e8e532abbf2f41aa05189a1820afaf080717ff842f828f842248b082905111255302a071113065540c855708210642b7d075009cb1f17cb3f15cec8061045103443078210178d45195007cb1f15cb3f5003fa02ce01206e9430cf84809201cee201fa02cecdc9290450dd441359c8cf85803202faca00cf8440ce01fa02806acf40f400c901fb002782100bebc200be8e9210ab109a10791067105610451034413cdb3c8e120c10ab109a10791067105610451034413070e28e86550bdb3c55a0913ce2550ac855b050cbfa025009fa025007fa025005fa0213ca00ce01c8ce12ce12cb1f12ce03c8ce12ce12cdcdc9ed54565804dc82107362d09cbae3022182010003ba8f5331d33f308151db27b3f2f48200dd212982100bebc200bef2f40b81264e0ddb3c1ef2f4551adb3cc855b050cbfa025009fa025007fa025005fa0213ca00ce01c8ce12ce12cb1f12ce03c8ce12ce12cdcdc9ed54e0323b3b0982010005ba3456585a04e031d33f31fa00fa40d31f2182010004ba8f5c6c2181357528f2f48147d6f842f82810ce5e3a109d108e107d106e105d104e103d102f01111001db3c01111001c7051ef2f40ad33f308200c0232c822adf0e742c074000bef2f4109d108c107b106a1059104810374605401403db3ce30e3635535504c010ad109c108b107d106c105b104d103c4bdc81264e0cdb3c1df2f4f82810bc10ab109a1089107810671056104510344130db3c2a10cd10bd559051dedb3c821014dc9380717f6d82100e01d0c0c816f400c9d056140356145139513d035099c856364c4d0164277027db3c705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d037011a88c855315034cece01fa02cec938022cff008e88f4a413f4bcf2c80bed53208e8130e1ed43d9393b012da65ec0bb51343e903e903e803e90154c1b0536cf1b11203a000ef82a5462505250049801d072d721d200d200fa4021103450666f04f86102f862ed44d0fa40fa40fa00fa4055306c1405e30203d70d1ff2e0822182100f8a7ea5bae302218210178d4519bae302018210595f07bcba3c3d3f4900b6038020d7217021d749c21f9430d31f01de208210178d4519ba8e1a30d33ffa00596c2113a05003c855305034cece01fa02cec9ed54e082107bdd97deba8e19d33ffa00596c2113a05003c855305034cece01fa02cec9ed54e05f0501ee31d33ffa00fa40d72c01916d93fa4001e201f40431fa008123fff84229c705f2f45184a181093e21c2fff2f4f8416f2425b8a4541432817d7106fa40fa0071d721fa00fa00306c6170f83a12a85240a0801e814e2070f838a081290470f836aa008208989680a0a0bcf2f450547080407f2a4613509cc83e02f655508210178d45195007cb1f15cb3f5003fa02ce01206e9430cf84809201cee201fa02cec95432572adb3c10581024103810281045102410235f41f90001f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f9040003c8cf8580ca0012cccccf884008cbff01fa028069cf40cf8634f400c901fb004003444803f831d33ffa00fa40d72c01916d93fa4001e201fa005336702cdb3cf842fa44315920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400206ef2d08001ba9b8123fff8425280c705f2f4df2704103749a054650a2cdb3c5155a18200ad4921c200f2f45122a0f8416f2421f8276f1021a12bc20044404201d2eda2edfb5124c705917f945303c705e292307f8e268d0860000000000000000000000000000000000000000000000000000000000000000004c705e2925b70e020d749c120e302d70b1f2082010002ba92307f978210e3a0d482bae2998100c8a8812710a904e0307041007a20d749c2008e32f405206eb38e28206ef2d080d020d749c21f8e18d70b1f8210e3a0d482ba9b8100c8a8812710a904db31e030915be2915be2915be27004fa913be30d2ec2008e545530fa40fa0071d721fa00fa00306c6170f83a52b0a0a1717029461350cec8553082107362d09c5005cb1f13cb3f01fa02cecec92504103b40aa441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00963f5f04383830e2028208989680b60972fb02236eb39326c2009170e2e30f024346474802fc8200894a22820a625a00bcf2f401820a625a00a1820a625a00717f6d708b085612040311120356110302111302011113c855508210178d45195007cb1f15cb3f5003fa02ce01206e9430cf84809201cee201fa02cec953ac702ddb3c10451034031110031045102410235f41f90001f9005ad76501d76582020134c8cb174445001cf82ac855315034cece01fa02cec9005acb0fcb0fcbffcbff71f9040003c8cf8580ca0012cccccf884008cbff01fa028069cf40cf8634f400c901fb000a007203206ef2d0808100827004c8018210d53276db58cb1fcb3fc91024103812441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00030006366c21001cc855305034cece01fa02cec9ed5402fe8efdd33ffa00d72c01916d93fa4001e2318123fff84226c705f2f45151a181093e21c2fff2f4f8416f2443305230fa40fa0071d721fa00fa00306c6170f83a817d71811a2c70f836aa0012a012bcf2f47080405414367f09c8553082107bdd97de5005cb1f13cb3f01fa02ce01206e9430cf84809201cee2c92404431350774a4b0054441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb004003c855305034cece01fa02cec9ed54000ce05f05f2c082027e6dc8821040e108d601cb1f7001cb0055b3db3c1dcf160cdb3c1dcf1671fa02500ffa02500dfa0252b0f4001bf400c9108c107b106a105910481037465010244f5002fc556082100f8a7ea55008cb1f16cb3f5004fa0212ce01206e9430cf84809201cee2f40001fa02cec9041110044130441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0053188210127a3980a010bc10ac717f2e0c0b0a090807060504031110030211120211111fdb3c104f103e021110021d441359c8cf85804e5102926dc871fa0223fa0258fa02c9c88210d55e468601cb1f14cb3f58fa027001cb0055b2db3c1dcf160cdb3c1dcf161ecc52c0f4001cf400c9109c108b107a1069105810471036454010234f50000ec87001cb03c9d0001e26fa44c87101cb0312ca07cbffc9d00178ca00cf8440ce01fa02806acf40f400c901fb008208989680717088265530441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb005537413052001c00000000636c6f73655f6d696e7401f68172652ab3f2f48200ca6c24c200f2f4815ebc0282010002ba12f2f4d33f31fa003053cba851c3a051cca0a52ca90451dda1816f8321c200f2f453008200a23904be13f2f481611c531cbbf2f41ba15092a0717f88104b103c441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00109b108a5e2655155400100000000073656c6c0058c855b050cbfa025009fa025007fa025005fa0213ca00ce01c8ce12ce12cb1f12ce03c8ce12ce12cdcdc9ed5401b68d08600000000000000000000000000000000000000000000000000000000000000000045230c705b38e298d08600000000000000000000000000000000000000000000000000000000000000000045220c705b39170e29170e30d5700528d08600000000000000000000000000000000000000000000000000000000000000000045210c705b301f2387fc88201000401cb1f5290cb3fc9d0821007270e00717ff828822adf0e742c074000f828f828820afaf08056110509071112071069c855708210642b7d075009cb1f17cb3f15cec8061045103443078210178d45195007cb1f15cb3f5003fa02ce01206e9430cf84809201cee201fa02cecdc92a43144ccc590034441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0000f48e7209d33f31fa40fa40fa40308200eb28f8422dc705917f95f84225c705e2f2f48151db26b3f2f4f842c8cf8508ce70cf0b6ec98042fb00109b108a107910681057104610351034c855b050cbfa025009fa025007fa025005fa0213ca00ce01c8ce12ce12cb1f12ce03c8ce12ce12cdcdc9ed54e05f0af2c08202fef9040003c8cf8580ca0012cccccf884008cbff01fa028069cf40cf8634f400c901fb00821008f0d18002717f5a6d40071045102410235f41f90001f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f9040003c8cf8580ca0012cccccf884008cbff01fa028069cf40cf8634f400c901fb0082100bebc2007370885c5d001c000000006465706c6f795f66656500d0295530441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb004016c85530820200025005cb1f13cb3fcececec9c88258c000000000000000000000000101cb67ccc970fb00f842c8cf8508ce70cf0b6ec98042fb0002c855205023cececb1fc9ed54db31005282008aabf84222c705f2f47083066d40037fc8cf8580ca00cf8440ce01fa02806acf40f400c901fb00e0b22fd5');
    const builder = beginCell();
    initLaunchpadFactory_init_args({ $$type: 'LaunchpadFactory_init_args', owner, platformWallet, tokenCount })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const LaunchpadFactory_errors = {
    2: { message: "Stack underflow" },
    3: { message: "Stack overflow" },
    4: { message: "Integer overflow" },
    5: { message: "Integer out of expected range" },
    6: { message: "Invalid opcode" },
    7: { message: "Type check error" },
    8: { message: "Cell overflow" },
    9: { message: "Cell underflow" },
    10: { message: "Dictionary error" },
    11: { message: "'Unknown' error" },
    12: { message: "Fatal error" },
    13: { message: "Out of gas error" },
    14: { message: "Virtualization error" },
    32: { message: "Action list is invalid" },
    33: { message: "Action list is too long" },
    34: { message: "Action is invalid or not supported" },
    35: { message: "Invalid source address in outbound message" },
    36: { message: "Invalid destination address in outbound message" },
    37: { message: "Not enough Toncoin" },
    38: { message: "Not enough extra currencies" },
    39: { message: "Outbound message does not fit into a cell after rewriting" },
    40: { message: "Cannot process a message" },
    41: { message: "Library reference is null" },
    42: { message: "Library change action error" },
    43: { message: "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree" },
    50: { message: "Account state size exceeded limits" },
    128: { message: "Null reference exception" },
    129: { message: "Invalid serialization prefix" },
    130: { message: "Invalid incoming message" },
    131: { message: "Constraints error" },
    132: { message: "Access denied" },
    133: { message: "Contract stopped" },
    134: { message: "Invalid argument" },
    135: { message: "Code of a contract was not found" },
    136: { message: "Invalid standard address" },
    138: { message: "Not a basechain address" },
    2366: { message: "Incorrect balance after send" },
    3766: { message: "Only owner can close minting" },
    6471: { message: "tonIn must be positive" },
    9215: { message: "Incorrect sender" },
    9806: { message: "DeDust not configured" },
    10217: { message: "Only factory or owner can change ownership" },
    10363: { message: "Unauthorized burn" },
    13685: { message: "Not migrating" },
    18390: { message: "Invalid migration wallet" },
    20955: { message: "Already migrated" },
    24252: { message: "Invalid sell opcode" },
    24860: { message: "Insufficient TON reserves" },
    28547: { message: "Zero TON out" },
    29285: { message: "Token has migrated to DEX" },
    32113: { message: "Insufficient amount of TON attached" },
    32398: { message: "Insufficient token reserves" },
    35146: { message: "Insufficient tax gas" },
    35499: { message: "Only owner" },
    39888: { message: "Insufficient TON for deployment" },
    41529: { message: "Slippage exceeded" },
    43555: { message: "Minting is closed" },
    44361: { message: "Amount too small after tax" },
    45384: { message: "Migration gas required" },
    46710: { message: "Amount too small" },
    48341: { message: "Insufficient TON sent" },
    49187: { message: "Migration tokens missing" },
    51820: { message: "Zero tokens received" },
    53137: { message: "Zero tokens out" },
    56609: { message: "Threshold not met" },
    56742: { message: "tokensIn must be positive" },
    57579: { message: "Only owner can mint" },
    60200: { message: "Only platform or creator" },
} as const

export const LaunchpadFactory_errors_backward = {
    "Stack underflow": 2,
    "Stack overflow": 3,
    "Integer overflow": 4,
    "Integer out of expected range": 5,
    "Invalid opcode": 6,
    "Type check error": 7,
    "Cell overflow": 8,
    "Cell underflow": 9,
    "Dictionary error": 10,
    "'Unknown' error": 11,
    "Fatal error": 12,
    "Out of gas error": 13,
    "Virtualization error": 14,
    "Action list is invalid": 32,
    "Action list is too long": 33,
    "Action is invalid or not supported": 34,
    "Invalid source address in outbound message": 35,
    "Invalid destination address in outbound message": 36,
    "Not enough Toncoin": 37,
    "Not enough extra currencies": 38,
    "Outbound message does not fit into a cell after rewriting": 39,
    "Cannot process a message": 40,
    "Library reference is null": 41,
    "Library change action error": 42,
    "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree": 43,
    "Account state size exceeded limits": 50,
    "Null reference exception": 128,
    "Invalid serialization prefix": 129,
    "Invalid incoming message": 130,
    "Constraints error": 131,
    "Access denied": 132,
    "Contract stopped": 133,
    "Invalid argument": 134,
    "Code of a contract was not found": 135,
    "Invalid standard address": 136,
    "Not a basechain address": 138,
    "Incorrect balance after send": 2366,
    "Only owner can close minting": 3766,
    "tonIn must be positive": 6471,
    "Incorrect sender": 9215,
    "DeDust not configured": 9806,
    "Only factory or owner can change ownership": 10217,
    "Unauthorized burn": 10363,
    "Not migrating": 13685,
    "Invalid migration wallet": 18390,
    "Already migrated": 20955,
    "Invalid sell opcode": 24252,
    "Insufficient TON reserves": 24860,
    "Zero TON out": 28547,
    "Token has migrated to DEX": 29285,
    "Insufficient amount of TON attached": 32113,
    "Insufficient token reserves": 32398,
    "Insufficient tax gas": 35146,
    "Only owner": 35499,
    "Insufficient TON for deployment": 39888,
    "Slippage exceeded": 41529,
    "Minting is closed": 43555,
    "Amount too small after tax": 44361,
    "Migration gas required": 45384,
    "Amount too small": 46710,
    "Insufficient TON sent": 48341,
    "Migration tokens missing": 49187,
    "Zero tokens received": 51820,
    "Zero tokens out": 53137,
    "Threshold not met": 56609,
    "tokensIn must be positive": 56742,
    "Only owner can mint": 57579,
    "Only platform or creator": 60200,
} as const

const LaunchpadFactory_types: ABIType[] = [
    {"name":"DataSize","header":null,"fields":[{"name":"cells","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bits","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"refs","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"SignedBundle","header":null,"fields":[{"name":"signature","type":{"kind":"simple","type":"fixed-bytes","optional":false,"format":64}},{"name":"signedData","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"StateInit","header":null,"fields":[{"name":"code","type":{"kind":"simple","type":"cell","optional":false}},{"name":"data","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"Context","header":null,"fields":[{"name":"bounceable","type":{"kind":"simple","type":"bool","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"raw","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"SendParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"code","type":{"kind":"simple","type":"cell","optional":true}},{"name":"data","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"MessageParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"DeployParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}},{"name":"init","type":{"kind":"simple","type":"StateInit","optional":false}}]},
    {"name":"StdAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":8}},{"name":"address","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"VarAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":32}},{"name":"address","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"BasechainAddress","header":null,"fields":[{"name":"hash","type":{"kind":"simple","type":"int","optional":true,"format":257}}]},
    {"name":"JettonWalletData","header":null,"fields":[{"name":"balance","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"minter","type":{"kind":"simple","type":"address","optional":false}},{"name":"code","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"JettonMinterState","header":null,"fields":[{"name":"totalSupply","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintable","type":{"kind":"simple","type":"bool","optional":false}},{"name":"adminAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"jettonContent","type":{"kind":"simple","type":"cell","optional":false}},{"name":"jettonWalletCode","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"JettonTransfer","header":260734629,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"destination","type":{"kind":"simple","type":"address","optional":false}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":true}},{"name":"customPayload","type":{"kind":"simple","type":"cell","optional":true}},{"name":"forwardTonAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"JettonTransferInternal","header":395134233,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":true}},{"name":"forwardTonAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"JettonNotification","header":1935855772,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"JettonBurn","header":1499400124,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":true}},{"name":"customPayload","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"JettonBurnNotification","header":2078119902,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":true}}]},
    {"name":"JettonExcesses","header":3576854235,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"ProvideWalletAddress","header":745978227,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"ownerAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"includeAddress","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"TakeWalletAddress","header":3513996288,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"walletAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"ownerAddress","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"Mint","header":1680571655,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"receiver","type":{"kind":"simple","type":"address","optional":false}},{"name":"mintMessage","type":{"kind":"simple","type":"JettonTransferInternal","optional":false}}]},
    {"name":"ChangeOwner","header":305419896,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"BuyTokens","header":65537,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"minTokensOut","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"SellTokens","header":65538,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"minTonOut","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"MigrateToStonfi","header":65539,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"ConfigureDedustMigration","header":65541,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"nativeVault","type":{"kind":"simple","type":"address","optional":false}},{"name":"jettonVault","type":{"kind":"simple","type":"address","optional":false}},{"name":"pool","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"DeployToken","header":131073,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"jettonContent","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"TokenDeployed","header":131074,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"bondingCurveAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"jettonMasterAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"creator","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"BondingCurve$Data","header":null,"fields":[{"name":"virtualTonReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"virtualTokenReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"realTonReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"realTokenReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"migrated","type":{"kind":"simple","type":"bool","optional":false}},{"name":"jettonMaster","type":{"kind":"simple","type":"address","optional":false}},{"name":"creator","type":{"kind":"simple","type":"address","optional":false}},{"name":"platformWallet","type":{"kind":"simple","type":"address","optional":false}},{"name":"createdAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"dedustNativeVault","type":{"kind":"simple","type":"address","optional":false}},{"name":"dedustJettonVault","type":{"kind":"simple","type":"address","optional":false}},{"name":"dedustPool","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"ReserveData","header":null,"fields":[{"name":"virtualTonReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"virtualTokenReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"realTonReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"realTokenReserves","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"migrated","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"QuoteResult","header":null,"fields":[{"name":"amountOut","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"fee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"JettonMaster$Data","header":null,"fields":[{"name":"totalSupply","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"factory","type":{"kind":"simple","type":"address","optional":false}},{"name":"platformWallet","type":{"kind":"simple","type":"address","optional":false}},{"name":"jettonContent","type":{"kind":"simple","type":"cell","optional":false}},{"name":"mintable","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"JettonWallet$Data","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"minter","type":{"kind":"simple","type":"address","optional":false}},{"name":"balance","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"platformWallet","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"LaunchpadFactory$Data","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"platformWallet","type":{"kind":"simple","type":"address","optional":false}},{"name":"tokenCount","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
]

const LaunchpadFactory_opcodes = {
    "JettonTransfer": 260734629,
    "JettonTransferInternal": 395134233,
    "JettonNotification": 1935855772,
    "JettonBurn": 1499400124,
    "JettonBurnNotification": 2078119902,
    "JettonExcesses": 3576854235,
    "ProvideWalletAddress": 745978227,
    "TakeWalletAddress": 3513996288,
    "Mint": 1680571655,
    "ChangeOwner": 305419896,
    "BuyTokens": 65537,
    "SellTokens": 65538,
    "MigrateToStonfi": 65539,
    "ConfigureDedustMigration": 65541,
    "DeployToken": 131073,
    "TokenDeployed": 131074,
}

const LaunchpadFactory_getters: ABIGetter[] = [
    {"name":"getTokenCount","methodId":121013,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"getOwner","methodId":102025,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":false}},
    {"name":"getPlatformWallet","methodId":98077,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":false}},
]

export const LaunchpadFactory_getterMapping: { [key: string]: string } = {
    'getTokenCount': 'getGetTokenCount',
    'getOwner': 'getGetOwner',
    'getPlatformWallet': 'getGetPlatformWallet',
}

const LaunchpadFactory_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"typed","type":"DeployToken"}},
    {"receiver":"internal","message":{"kind":"text","text":"withdraw"}},
]

export const NANOS_PER_TON = 1000000000n;
export const SOL_TO_TON_SCALE = 36n;
export const INITIAL_VIRTUAL_TON = 1080000000000n;
export const INITIAL_VIRTUAL_TOKENS = 1073000000000000000n;
export const REAL_TOKEN_SUPPLY = 793100000000000000n;
export const PRODUCTION_MIGRATION_THRESHOLD = 3060000000000n;
export const MIGRATION_THRESHOLD = 200000000n;
export const MIGRATION_TOKEN_RESERVE = 206900000000000000n;
export const MIGRATION_GAS_RESERVE = 800000000n;
export const FEE_BPS = 0n;
export const SELL_TAX_BPS = 200n;
export const BPS_DENOMINATOR = 10000n;
export const DEPLOY_FEE = 200000000n;
export const MIN_TONS_FOR_STORAGE = 10000000n;
export const GAS_FOR_TRANSFER = 10500n;
export const GAS_FOR_BURN = 6700n;
export const WALLET_STATE_INIT_CELLS = 30n;
export const WALLET_STATE_INIT_BITS = 20000n;
export const BASECHAIN = 0n;
export const TAX_TRANSFER_GAS = 40000000n;
export const OP_BONDING_CURVE_SELL = 65538n;
export const OP_DEDUST_JETTON_SWAP = 3818968194n;
export const OP_DEDUST_JETTON_DEPOSIT_LIQUIDITY = 1088489686n;
export const OP_DEDUST_NATIVE_DEPOSIT_LIQUIDITY = 3579725446n;
export const DEAD_ADDRESS = address("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c");

export class LaunchpadFactory implements Contract {
    
    public static readonly storageReserve = 0n;
    public static readonly errors = LaunchpadFactory_errors_backward;
    public static readonly opcodes = LaunchpadFactory_opcodes;
    
    static async init(owner: Address, platformWallet: Address, tokenCount: bigint) {
        return await LaunchpadFactory_init(owner, platformWallet, tokenCount);
    }
    
    static async fromInit(owner: Address, platformWallet: Address, tokenCount: bigint) {
        const __gen_init = await LaunchpadFactory_init(owner, platformWallet, tokenCount);
        const address = contractAddress(0, __gen_init);
        return new LaunchpadFactory(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new LaunchpadFactory(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  LaunchpadFactory_types,
        getters: LaunchpadFactory_getters,
        receivers: LaunchpadFactory_receivers,
        errors: LaunchpadFactory_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: DeployToken | "withdraw") {
        
        let body: Cell | null = null;
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'DeployToken') {
            body = beginCell().store(storeDeployToken(message)).endCell();
        }
        if (message === "withdraw") {
            body = beginCell().storeUint(0, 32).storeStringTail(message).endCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
    async getGetTokenCount(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('getTokenCount', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getGetOwner(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('getOwner', builder.build())).stack;
        const result = source.readAddress();
        return result;
    }
    
    async getGetPlatformWallet(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('getPlatformWallet', builder.build())).stack;
        const result = source.readAddress();
        return result;
    }
    
}