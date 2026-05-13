'use client';

import { useEffect, useRef, useState } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { beginCell, toNano, Address } from '@ton/core';
import { TonClient } from '@ton/ton';
import { supabase } from '@/lib/supabase';
import { TONCONNECT_TESTNET_CHAIN } from '@/lib/launchpad';
import {
  getBondingProgress,
  getRequiredBuyGasReserve,
  MIGRATION_GAS_RESERVE,
  MIGRATION_MARKET_CAP_TON as MIGRATION_MARKET_CAP_TON_NANO,
} from '@/lib/bondingCurve';
import { createChart, ColorType, IChartApi } from 'lightweight-charts';
import type { AreaData, UTCTimestamp } from 'lightweight-charts';

interface Token {
  id: string; address: string; jetton_address: string; name: string; symbol: string;
  description: string | null; image_url: string | null; creator_address: string;
  virtual_ton_reserves: string; virtual_token_reserves: string;
  real_ton_reserves: string; real_token_reserves: string;
  market_cap_ton: string | null; volume_24h_ton: string | null;
  tx_count: number; migrated: boolean; created_at: string;
}
interface Trade {
  id: string; token_address: string; trader_address: string;
  type: 'buy' | 'sell'; ton_amount: string; token_amount: string;
  tx_hash: string; created_at: string;
}

const TOTAL_SUPPLY_NANO = 1_000_000_000n * 1_000_000_000n;
const MIGRATION_MARKET_CAP_TON = Number(MIGRATION_MARKET_CAP_TON_NANO) / 1e9;
const OP_BUY_TOKENS = 0x10001;
const OP_SELL_TOKENS = 0x10002;
const OP_JETTON_TRANSFER = 0x0f8a7ea5;

function formatTon(nanoStr: string): string {
  const ton = Number(BigInt(nanoStr || '0')) / 1e9;
  if (ton >= 1000) return `${(ton / 1000).toFixed(1)}k`;
  if (ton >= 1) return ton.toFixed(4);
  return ton.toFixed(6);
}
function formatTokens(nanoStr: string): string {
  const tokens = Number(BigInt(nanoStr || '0')) / 1e9;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return tokens.toFixed(0);
}
function parseNanoAmount(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return 0n;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const wholeNano = BigInt(whole || '0') * 1_000_000_000n;
  const fractionNano = BigInt(fraction.padEnd(9, '0').slice(0, 9) || '0');
  return wholeNano + fractionNano;
}
function formatNanoAmount(value: bigint): string {
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function shortAddr(addr: string): string {
  return addr.length < 12 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
}

// Client-side bonding curve math
function getBuyQuote(vTon: bigint, vTokens: bigint, tonIn: bigint): bigint {
  const k = vTon * vTokens;
  const newVTon = vTon + tonIn;
  const newVTokens = (k + newVTon - 1n) / newVTon;
  return vTokens - newVTokens;
}
function getSellQuote(vTon: bigint, vTokens: bigint, tokensIn: bigint): bigint {
  const k = vTon * vTokens;
  const newVTokens = vTokens + tokensIn;
  const newVTon = (k + newVTokens - 1n) / newVTokens;
  const grossTon = vTon - newVTon;
  const feeTon = (grossTon * 200n) / 10000n;
  return grossTon - feeTon;
}
function getMarketCapNano(vTon: string, vTokens: string): bigint {
  const virtualTon = BigInt(vTon || '0');
  const virtualTokens = BigInt(vTokens || '1');
  if (virtualTokens <= 0n) return 0n;
  return (virtualTon * TOTAL_SUPPLY_NANO) / virtualTokens;
}
function getMarketCap(vTon: string, vTokens: string): number {
  return Number(getMarketCapNano(vTon, vTokens)) / 1e9;
}
function nextChartTime(time: number, previousTime: number): number {
  return time > previousTime ? time : previousTime + 1;
}
function chartTime(seconds: number): UTCTimestamp {
  return seconds as UTCTimestamp;
}

export default function TokenDetailPage({
  token, trades, onBack
}: { token: Token; trades: Trade[]; onBack: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [liveToken, setLiveToken] = useState(token);
  const [liveTrades, setLiveTrades] = useState<Trade[]>(trades.filter(t => t.token_address === token.address));
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const walletAddress = wallet?.account.address || '';

  useEffect(() => { setMounted(true); }, []);

  // Real-time token updates
  useEffect(() => {
    const sub = supabase
      .channel(`token-${token.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tokens', filter: `id=eq.${token.id}` }, (payload) => {
        setLiveToken(payload.new as Token);
      })
      .subscribe();
    const tradeSub = supabase
      .channel(`trades-${token.address}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `token_address=eq.${token.address}` }, (payload) => {
        setLiveTrades(prev => [payload.new as Trade, ...prev.slice(0, 99)]);
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); supabase.removeChannel(tradeSub); };
  }, [token.id, token.address]);

  useEffect(() => {
    if (!walletAddress) {
      setTokenBalance(null);
      setBalanceLoading(false);
      return;
    }

    let cancelled = false;
    const loadTokenBalance = async () => {
      setBalanceLoading(true);
      try {
        const client = new TonClient({ endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC' });
        const ownerAddress = Address.parse(walletAddress);
        const result = await client.runMethod(
          Address.parse(liveToken.jetton_address),
          'get_wallet_address',
          [{ type: 'slice', cell: beginCell().storeAddress(ownerAddress).endCell() }],
        );
        const userJettonWallet = result.stack.readAddress();
        const walletData = await client.runMethod(userJettonWallet, 'get_wallet_data');
        const balance = walletData.stack.readBigNumber();
        if (!cancelled) setTokenBalance(balance);
      } catch {
        if (!cancelled) setTokenBalance(0n);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    };

    loadTokenBalance();
    return () => { cancelled = true; };
  }, [walletAddress, liveToken.jetton_address, liveTrades.length]);

  // Chart
  useEffect(() => {
    if (!chartRef.current || !mounted) return;
    if (chartInstanceRef.current) { chartInstanceRef.current.remove(); chartInstanceRef.current = null; }

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth, height: 200,
      layout: { background: { type: ColorType.Solid, color: '#12121a' }, textColor: '#8888aa', fontSize: 11 },
      grid: { vertLines: { color: '#1e1e32' }, horzLines: { color: '#1e1e32' } },
      timeScale: { timeVisible: true, borderColor: '#1e1e32' },
      rightPriceScale: { borderColor: '#1e1e32' },
      crosshair: { mode: 0 },
    });
    chartInstanceRef.current = chart;

    const areaSeries = chart.addAreaSeries({
      lineColor: '#7c4dff', topColor: 'rgba(124,77,255,0.4)', bottomColor: 'rgba(124,77,255,0.0)',
      lineWidth: 2,
    });

    // Build chart data from trades (oldest first)
    const allTrades = [...liveTrades].reverse();
    const mcap = getMarketCap(liveToken.virtual_ton_reserves, liveToken.virtual_token_reserves);
    
    if (allTrades.length === 0) {
      const now = Math.floor(Date.now() / 1000);
      const points: AreaData<UTCTimestamp>[] = [
        { time: chartTime(now - 60), value: mcap * 0.95 },
        { time: chartTime(now), value: mcap },
      ];
      areaSeries.setData(points);
    } else {
      let previousTime = 0;
      const points: AreaData<UTCTimestamp>[] = allTrades.map((t, i) => {
        const time = nextChartTime(Math.floor(new Date(t.created_at).getTime() / 1000), previousTime);
        previousTime = time;
        return {
          time: chartTime(time),
          value: mcap * (0.8 + 0.2 * (i / Math.max(allTrades.length - 1, 1))),
        };
      });
      points.push({ time: chartTime(nextChartTime(Math.floor(Date.now() / 1000), previousTime)), value: mcap });
      areaSeries.setData(points);
    }

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => { if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth }); });
    ro.observe(chartRef.current);
    return () => { ro.disconnect(); chart.remove(); chartInstanceRef.current = null; };
  }, [mounted, liveTrades.length, liveToken.virtual_ton_reserves]);

  const mcapNano = getMarketCapNano(liveToken.virtual_ton_reserves, liveToken.virtual_token_reserves);
  const progress = getBondingProgress(mcapNano);
  const mcap = getMarketCap(liveToken.virtual_ton_reserves, liveToken.virtual_token_reserves);
  const price = Number(BigInt(liveToken.virtual_ton_reserves || '0')) / Number(BigInt(liveToken.virtual_token_reserves || '1'));

  // Quote calculation
  let quoteText = '';
  if (amount && Number(amount) > 0) {
    try {
      const vTon = BigInt(liveToken.virtual_ton_reserves);
      const vTokens = BigInt(liveToken.virtual_token_reserves);
      if (tab === 'buy') {
        const tonNano = parseNanoAmount(amount);
        const tokensOut = getBuyQuote(vTon, vTokens, tonNano);
        const gasReserve = getRequiredBuyGasReserve(tonNano, vTon, vTokens);
        const migrationSuffix = gasReserve === MIGRATION_GAS_RESERVE ? ' + 0.8 TON migration gas' : '';
        quoteText = `~ ${(Number(tokensOut) / 1e9).toLocaleString()} tokens${migrationSuffix}`;
      } else {
        const tokensNano = parseNanoAmount(amount);
        const tonOut = getSellQuote(vTon, vTokens, tokensNano);
        quoteText = `~ ${(Number(tonOut) / 1e9).toFixed(6)} TON after 2% sell fee`;
      }
    } catch { quoteText = ''; }
  }
  const sellAmountNano = tab === 'sell' && amount ? parseNanoAmount(amount) : 0n;
  const hasSellBalance = tokenBalance !== null && tokenBalance > 0n;
  const sellExceedsBalance = tab === 'sell' && tokenBalance !== null && sellAmountNano > tokenBalance;
  const tokenBalanceText = tokenBalance === null ? '0' : formatNanoAmount(tokenBalance);

  function setSellAllAmount() {
    if (hasSellBalance) setAmount(formatNanoAmount(tokenBalance));
  }

  async function handleBuy() {
    if (!wallet) { tonConnectUI.openModal(); return; }
    if (!amount || Number(amount) <= 0) return;
    if (wallet.account.chain !== TONCONNECT_TESTNET_CHAIN) return;
    setSending(true);
    try {
      const body = beginCell()
        .storeUint(OP_BUY_TOKENS, 32)
        .storeUint(Date.now(), 64)
        .storeCoins(0) // minTokensOut (0 = no slippage protection)
        .endCell();
      
      const buyAmount = parseNanoAmount(amount);
      const gasReserve = getRequiredBuyGasReserve(
        buyAmount,
        BigInt(liveToken.virtual_ton_reserves || '0'),
        BigInt(liveToken.virtual_token_reserves || '1'),
      );
      const tonAmount = buyAmount + gasReserve;
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: TONCONNECT_TESTNET_CHAIN,
        messages: [{
          address: liveToken.address,
          amount: tonAmount.toString(),
          payload: body.toBoc().toString('base64'),
        }],
      });
      setAmount('');
    } catch (e: any) {
      console.error('Buy failed:', e);
    }
    setSending(false);
  }

  async function handleSell() {
    if (!wallet) { tonConnectUI.openModal(); return; }
    if (!amount || Number(amount) <= 0) return;
    if (sellExceedsBalance) return;
    if (wallet.account.chain !== TONCONNECT_TESTNET_CHAIN) return;
    setSending(true);
    try {
      const client = new TonClient({ endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC' });
      
      // Get user's JettonWallet address from JettonMaster
      const result = await client.runMethod(
        Address.parse(liveToken.jetton_address),
        'get_wallet_address',
        [{ type: 'slice', cell: beginCell().storeAddress(Address.parse(walletAddress)).endCell() }]
      );
      const userJettonWallet = result.stack.readAddress();

      // Forward payload for BondingCurve (OP_SELL_TOKENS)
      const forwardPayload = beginCell()
        .storeUint(OP_SELL_TOKENS, 32)
        .storeUint(Date.now(), 64)
        .storeCoins(0) // minTonOut
        .endCell();

      // JettonTransfer message body
      const tokensNano = parseNanoAmount(amount);
      if (tokensNano <= 0n) return;
      const body = beginCell()
        .storeUint(OP_JETTON_TRANSFER, 32)
        .storeUint(Date.now(), 64)
        .storeCoins(tokensNano)
        .storeAddress(Address.parse(liveToken.address)) // destination: Bonding Curve
        .storeAddress(Address.parse(walletAddress)) // response_destination (excess TON)
        .storeMaybeRef(null) // custom_payload
        .storeCoins(toNano('0.15')) // forward_ton_amount (enough gas for curve to execute sell)
        .storeSlice(forwardPayload.beginParse()) // forward_payload
        .endCell();

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: TONCONNECT_TESTNET_CHAIN,
        messages: [{
          address: userJettonWallet.toString(),
          amount: toNano('0.25').toString(), // Total TON attached to the transfer for gas
          payload: body.toBoc().toString('base64'),
        }],
      });
      setAmount('');
    } catch (e: any) {
      console.error('Sell failed:', e);
    }
    setSending(false);
  }

  if (!mounted) return <div style={{ minHeight: '100vh', background: '#0a0a0f' }} />;

  const cardStyle = { background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border)', padding: '16px', marginBottom: '10px' };

  return (
    <div style={{ minHeight: '100vh', padding: '16px', maxWidth: '480px', margin: '0 auto' }}>
      {/* Back */}
      <button onClick={onBack} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px 14px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
        Back
      </button>

      {/* Token Header */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' }}>
          <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: `linear-gradient(135deg, hsl(${(liveToken.name.charCodeAt(0) * 37) % 360}, 70%, 50%), hsl(${(liveToken.name.charCodeAt(0) * 37 + 60) % 360}, 70%, 50%))`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 800 }}>
            {liveToken.symbol.slice(0, 2)}
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>{liveToken.name}</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>${liveToken.symbol}</p>
          </div>
          {liveToken.migrated && <span style={{ fontSize: '11px', fontWeight: 600, background: 'rgba(0,230,118,0.15)', color: 'var(--accent-green)', padding: '4px 10px', borderRadius: '6px' }}>Migrated</span>}
        </div>
        {/* Stats row */}
        <div style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
          <div style={{ flex: 1, background: '#0a0a0f', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>Market Cap</div>
            <div style={{ fontWeight: 700, color: 'var(--accent-green)' }}>{mcap.toFixed(4)} TON</div>
          </div>
          <div style={{ flex: 1, background: '#0a0a0f', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>Price</div>
            <div style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{price.toExponential(2)} TON</div>
          </div>
          <div style={{ flex: 1, background: '#0a0a0f', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>Txns</div>
            <div style={{ fontWeight: 700 }}>{liveToken.tx_count || liveTrades.length}</div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={cardStyle}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>Market Cap</div>
        <div ref={chartRef} style={{ width: '100%', height: '200px', borderRadius: '8px', overflow: 'hidden' }} />
      </div>

      {/* Migration Progress */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Progress to DEX</span>
          <span style={{ fontWeight: 600 }}>{mcap.toFixed(2)} / {MIGRATION_MARKET_CAP_TON.toFixed(2)} TON mcap</span>
        </div>
        <div style={{ width: '100%', height: '8px', borderRadius: '4px', background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', borderRadius: '4px', background: 'linear-gradient(90deg, var(--accent-purple), var(--accent-green))', transition: 'width 0.5s ease' }} />
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', textAlign: 'right' }}>
          {progress.toFixed(1)}%{liveToken.migrated ? ' - Migrated!' : ''}
        </div>
      </div>

      {/* Buy/Sell Panel */}
      {!liveToken.migrated && (
        <div style={cardStyle}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', background: '#0a0a0f', borderRadius: '10px', padding: '3px' }}>
            {(['buy', 'sell'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setAmount(''); }}
                style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                  background: tab === t ? (t === 'buy' ? 'rgba(0,230,118,0.15)' : 'rgba(255,23,68,0.15)') : 'transparent',
                  color: tab === t ? (t === 'buy' ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-secondary)',
                }}>
                {t === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>

          {/* Amount Input */}
          <div style={{ position: 'relative', marginBottom: '8px' }}>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={tab === 'buy' ? 'TON amount' : 'Token amount'}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: '#0a0a0f', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600, outline: 'none' }}
            />
            <span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {tab === 'buy' ? 'TON' : 'Tokens'}
            </span>
          </div>
          {tab === 'sell' && wallet && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>
                Balance: {balanceLoading ? 'loading...' : `${tokenBalanceText} ${liveToken.symbol}`}
              </span>
              <button type="button" onClick={setSellAllAmount} disabled={!hasSellBalance || balanceLoading}
                style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: '#0a0a0f', color: hasSellBalance ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, cursor: hasSellBalance && !balanceLoading ? 'pointer' : 'not-allowed', opacity: hasSellBalance && !balanceLoading ? 1 : 0.55 }}>
                Max
              </button>
            </div>
          )}

          {/* Preset buttons */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {(tab === 'buy' ? ['0.1', '0.5', '1', '2'] : ['1000', '10000', '100000', '1000000']).map(v => (
              <button key={v} onClick={() => setAmount(v)}
                style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                {tab === 'buy' ? `${v}` : Number(v) >= 1000000 ? '1M' : Number(v) >= 1000 ? `${Number(v)/1000}k` : v}
              </button>
            ))}
          </div>

          {/* Quote */}
          {quoteText && <div style={{ fontSize: '13px', color: 'var(--accent-purple)', marginBottom: '10px', textAlign: 'center', fontWeight: 600 }}>{quoteText}</div>}
          {sellExceedsBalance && <div style={{ fontSize: '12px', color: 'var(--accent-red)', marginBottom: '10px', textAlign: 'center', fontWeight: 600 }}>Amount exceeds wallet balance</div>}

          {/* Action Button */}
          <button onClick={tab === 'buy' ? handleBuy : handleSell} disabled={sending || sellExceedsBalance}
            style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', fontSize: '15px', fontWeight: 700, cursor: sending || sellExceedsBalance ? 'not-allowed' : 'pointer', opacity: sending || sellExceedsBalance ? 0.6 : 1,
              background: tab === 'buy' ? 'linear-gradient(135deg, #00e676, #00c853)' : 'linear-gradient(135deg, #ff1744, #d50000)',
              color: '#fff', transition: 'all 0.2s',
            }}>
            {!wallet ? 'Connect Wallet' : sending ? 'Confirming...' : tab === 'buy' ? `Buy $${liveToken.symbol}` : `Sell $${liveToken.symbol}`}
          </button>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '6px' }}>0% buy tax - 2% sell fee - 0% transfer tax</div>
        </div>
      )}

      {/* Contract Info */}
      <div style={{ ...cardStyle, fontSize: '12px' }}>
        <div style={{ marginBottom: '6px' }}><span style={{ color: 'var(--text-secondary)' }}>BondingCurve: </span><span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{shortAddr(liveToken.address)}</span></div>
        <div style={{ marginBottom: '6px' }}><span style={{ color: 'var(--text-secondary)' }}>Jetton: </span><span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{shortAddr(liveToken.jetton_address)}</span></div>
        <div><span style={{ color: 'var(--text-secondary)' }}>Creator: </span><span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{shortAddr(liveToken.creator_address)}</span></div>
      </div>

      {/* Trade History */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px' }}>Trades ({liveTrades.length})</h2>
        {liveTrades.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)', fontSize: '13px' }}>No trades yet. Be the first!</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
            {liveTrades.map(trade => (
              <div key={trade.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: '8px', background: '#0a0a0f', fontSize: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: trade.type === 'buy' ? 'var(--accent-green)' : 'var(--accent-red)', background: trade.type === 'buy' ? 'rgba(0,230,118,0.1)' : 'rgba(255,23,68,0.1)', padding: '2px 5px', borderRadius: '4px' }}>
                    {trade.type === 'buy' ? 'BUY' : 'SELL'}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{shortAddr(trade.trader_address)}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>{formatTon(trade.ton_amount)} TON</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{timeAgo(trade.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
