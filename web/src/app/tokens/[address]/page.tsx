'use client';

import { LineChart, Scrubber } from '@coinbase/cds-web-visualization/chart';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { Address } from '@ton/core';
import { Bell, Moon, Search, Sun } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TopbarNav } from '../../TopbarNav';
import { useThemeMode } from '../../providers';
import {
  DEFAULT_SELL_FORWARD_TON,
  DEFAULT_SELL_TRANSFER_VALUE,
  TONCONNECT_TESTNET_CHAIN,
  buyTokensBody,
  jettonTransferBody,
  parseDecimalToNano,
  quoteBondingCurveBuy,
  quoteBondingCurveSell,
  sellForwardPayload,
  formatNano as formatNanoAmount,
} from '@/lib/launchpad';
import { subscribeLaunchpadEvents } from '@/lib/liveEvents';
import { supabase } from '@/lib/supabase';
import { formatUserError } from '@/lib/userErrors';

type PeriodKey = 'hour' | 'day' | 'week' | 'month' | 'ytd' | 'all';

type TokenDetailToken = {
  address: string;
  creatorAddress: string;
  jettonAddress: string | null;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string | null;
  marketCapTon: number;
  priceTon: number;
  migrationMarketCapNano: string;
  migrationMarketCapTon: number;
  virtualTonReserves: string;
  virtualTokenReserves: string;
  holders: number;
  volumeTon: number;
  progressPercent: number;
  migrationState: number;
  migrated: boolean;
  stonPoolAddress: string | null;
  lpStatus: string;
  createdAt: string | null;
};

type TokenDetailChartPeriod = {
  data: number[];
  labels: string[];
  label: string;
};

type TokenDetailResponse = {
  token: TokenDetailToken;
  chart: Record<PeriodKey, TokenDetailChartPeriod>;
  trades: TokenDetailTrade[];
};

type TokenDetailTrade = {
  id: string;
  type: 'buy' | 'sell';
  source: string;
  tonAmount: number;
  tokenAmount: number;
  feeTon: number;
  feeTokenAmount: number;
  trader: string;
  timestamp: string | null;
  txHash: string | null;
};

const PERIODS: Array<{ id: PeriodKey; label: string }> = [
  { id: 'hour', label: '1H' },
  { id: 'day', label: '1D' },
  { id: 'week', label: '1W' },
  { id: 'month', label: '1M' },
  { id: 'ytd', label: 'YTD' },
  { id: 'all', label: 'ALL' },
];

const BUY_PRESETS = ['0.1', '0.5', '1', '2'];
const SELL_PRESETS = [10, 25, 50, 100];
const TRADE_SIZE_FILTERS = [
  { id: 'all', label: 'All trades', minTon: 0 },
  { id: '0.1', label: '0.1+ TON', minTon: 0.1 },
  { id: '0.5', label: '0.5+ TON', minTon: 0.5 },
  { id: '1', label: '1+ TON', minTon: 1 },
];

const fallbackImages = [
  '/memes/tonk-batcat.jpg',
  '/memes/rocket-cat.png',
  '/memes/blue-pepe.png',
  '/memes/diamond-frog.png',
  '/memes/ice-hamster.png',
  '/memes/moon-toast.jpg',
  '/memes/pixel-whale.png',
];

const TON_USD_PRICE = 2.454;
const NANOS_PER_UNIT_LOCAL = 1_000_000_000n;
const TOTAL_SUPPLY_NANO = 1_000_000_000n * NANOS_PER_UNIT_LOCAL;

function nanoToDisplay(value: bigint) {
  return Number(value) / 1e9;
}

function marketCapTonFromReserves(virtualTonReserves: bigint, virtualTokenReserves: bigint) {
  if (virtualTokenReserves <= 0n) return 0;
  return nanoToDisplay((virtualTonReserves * TOTAL_SUPPLY_NANO) / virtualTokenReserves);
}

function priceTonFromReserves(virtualTonReserves: bigint, virtualTokenReserves: bigint) {
  if (virtualTokenReserves <= 0n) return 0;
  return nanoToDisplay((virtualTonReserves * NANOS_PER_UNIT_LOCAL) / virtualTokenReserves);
}

function shortWallet(address: string) {
  return address.length < 12 ? address : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function compactNumber(value: number, options?: Intl.NumberFormatOptions) {
  if (!Number.isFinite(value)) return '--';

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    ...options,
  }).format(value);
}

function formatTon(value: number, options?: Intl.NumberFormatOptions) {
  if (!Number.isFinite(value)) return '--';

  return `${compactNumber(value, options)} TON`;
}

function formatUsd(value: number, options?: Intl.NumberFormatOptions) {
  if (!Number.isFinite(value)) return '--';

  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    style: 'currency',
    ...options,
  }).format(value);
}

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return '--';

  return `${compactNumber(value, {
    maximumFractionDigits: value < 0.01 ? 8 : 4,
  })} TON`;
}

function formatTimeAgo(value: string | null) {
  if (!value) return 'now';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'now';

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchJettonBalance(master: string, owner: string): Promise<{ balance: string; walletAddress: string }> {
  const response = await fetch(
    `/api/jetton-balance?master=${encodeURIComponent(master)}&owner=${encodeURIComponent(owner)}`,
    { cache: 'no-store' },
  );
  const data = await response.json() as { balance?: string; walletAddress?: string; error?: string };
  if (!response.ok || data.balance === undefined || !data.walletAddress) {
    throw new Error(data.error || 'Unable to load jetton balance');
  }
  return { balance: data.balance, walletAddress: data.walletAddress };
}

function getTokenImage(token: Pick<TokenDetailToken, 'imageUrl'>, index = 0) {
  return token.imageUrl || fallbackImages[index % fallbackImages.length];
}

function TokenImage({
  token,
  index,
  className = '',
}: {
  token: TokenDetailToken;
  index?: number;
  className?: string;
}) {
  const imageUrl = getTokenImage(token, index);

  return (
    <div className={`token-detail-image-shell ${className}`}>
      {imageUrl ? (
        <img
          alt=""
          className="token-detail-image"
          src={imageUrl}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <div className="meme-image-fallback" aria-hidden="true">
          <span>${token.ticker}</span>
        </div>
      )}
    </div>
  );
}

function TokenTopbar() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const { colorScheme, toggleColorScheme } = useThemeMode();

  return (
    <div className="dashboard-topbar">
      <div className="topbar-left">
        <div className="topbar-brand">tonked</div>
        <span className="topbar-slash topbar-left-slash" aria-hidden="true">/</span>
        <TopbarNav />
      </div>
      <div className="topbar-actions">
        <label className="dashboard-search" aria-label="Search">
          <Search aria-hidden="true" size={13} strokeWidth={2.25} />
          <input type="search" placeholder="Search" />
          <kbd>Ctrl K</kbd>
        </label>
        <span className="topbar-slash" aria-hidden="true">/</span>
        <button type="button" className="notification-button" aria-label="Notifications">
          <Bell aria-hidden="true" size={14} strokeWidth={2.4} />
        </button>
        <span className="topbar-slash" aria-hidden="true">/</span>
        <button
          type="button"
          className="notification-button theme-toggle-button"
          aria-label={colorScheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleColorScheme}
        >
          {colorScheme === 'dark' ? (
            <Sun aria-hidden="true" size={14} strokeWidth={2.4} />
          ) : (
            <Moon aria-hidden="true" size={14} strokeWidth={2.4} />
          )}
        </button>
        <span className="topbar-slash" aria-hidden="true">/</span>
        <button
          type="button"
          className="connect-wallet-button"
          onClick={() => wallet ? tonConnectUI.disconnect() : tonConnectUI.openModal()}
        >
          <span>{wallet ? shortWallet(wallet.account.address) : 'Connect'}</span>
        </button>
      </div>
    </div>
  );
}

function appendOptimisticChartPoint(chart: TokenDetailResponse['chart'], marketCapTon: number) {
  const timestamp = new Date().toISOString();
  const nextChart = { ...chart };
  for (const period of PERIODS) {
    const current = chart[period.id];
    nextChart[period.id] = {
      ...current,
      data: [...current.data, marketCapTon].slice(-1000),
      labels: [...current.labels, timestamp].slice(-1000),
    };
  }
  return nextChart;
}

function detailChartPointCount(chart: TokenDetailResponse['chart']) {
  return Object.values(chart).reduce((sum, period) => sum + period.data.length, 0);
}

function mergeTokenDetailData(
  current: TokenDetailResponse | null,
  nextData: TokenDetailResponse,
  optimisticUntilMs: number,
): TokenDetailResponse {
  if (!current || Date.now() > optimisticUntilMs) return nextData;
  if (detailChartPointCount(nextData.chart) >= detailChartPointCount(current.chart)) return nextData;

  return {
    ...nextData,
    chart: current.chart,
    trades: nextData.trades.length >= current.trades.length ? nextData.trades : current.trades,
  };
}

export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const router = useRouter();
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('hour');
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradeSort, setTradeSort] = useState<'newest' | 'oldest'>('newest');
  const [tradeSizeFilter, setTradeSizeFilter] = useState('all');
  const [tradeAmount, setTradeAmount] = useState('0.1');
  const [scrubberPosition, setScrubberPosition] = useState<number | undefined>();
  const [data, setData] = useState<TokenDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [tradeStatus, setTradeStatus] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [userJettonWalletAddress, setUserJettonWalletAddress] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [balanceNonce, setBalanceNonce] = useState(0);
  const refreshTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const refreshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optimisticUntil = useRef(0);
  const hasLoadedDetail = useRef(false);
  const address = Array.isArray(params.address) ? params.address[0] : params.address;
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const walletAddress = wallet?.account.address || '';
  const activeJettonAddress = data?.token.jettonAddress || '';
  const liveTradeCount = data?.trades.length || 0;

  useEffect(() => () => {
    refreshTimers.current.forEach((timer) => clearTimeout(timer));
    refreshTimers.current = [];
    if (refreshDebounce.current) clearTimeout(refreshDebounce.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTokenDetail() {
      if (!hasLoadedDetail.current) setLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const response = await fetch(`/api/tokens/${encodeURIComponent(address)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.status === 404) {
          setNotFound(true);
          setData(null);
          return;
        }

        if (!response.ok) throw new Error('Token detail request failed');
        const nextData = await response.json() as TokenDetailResponse;
        hasLoadedDetail.current = true;
        setData((current) => mergeTokenDetailData(current, nextData, optimisticUntil.current));
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load token');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    if (address) void loadTokenDetail();
    return () => controller.abort();
  }, [address, refreshNonce]);

  useEffect(() => {
    if (!address) return;
    const refresh = () => {
      if (refreshDebounce.current) clearTimeout(refreshDebounce.current);
      refreshDebounce.current = setTimeout(() => {
        setRefreshNonce((value) => value + 1);
        setBalanceNonce((value) => value + 1);
      }, 250);
    };
    const tokenChannel = supabase
      .channel(`token-detail-token-${address}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: `address=eq.${address}` }, refresh)
      .subscribe();
    const tradeChannel = supabase
      .channel(`token-detail-trades-${address}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades', filter: `token_address=eq.${address}` }, refresh)
      .subscribe();
    const candleChannel = supabase
      .channel(`token-detail-candles-${address}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'token_candles', filter: `token_address=eq.${address}` }, refresh)
      .subscribe();
    const unsubscribeLiveEvents = subscribeLaunchpadEvents((event) => {
      const payload = event.payload as { address?: string; token_address?: string };
      if (payload.address === address || payload.token_address === address) refresh();
    });

    return () => {
      supabase.removeChannel(tokenChannel);
      supabase.removeChannel(tradeChannel);
      supabase.removeChannel(candleChannel);
      unsubscribeLiveEvents();
    };
  }, [address]);

  useEffect(() => {
    if (!walletAddress || !activeJettonAddress) {
      queueMicrotask(() => setTokenBalance(null));
      queueMicrotask(() => setUserJettonWalletAddress(null));
      return;
    }

    let cancelled = false;
    async function loadTokenBalance() {
      setBalanceLoading(true);
      try {
        let balance: Awaited<ReturnType<typeof fetchJettonBalance>> | null = null;
        let lastError: unknown = null;
        for (const delay of [0, 900, 1_800]) {
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (cancelled) return;
          }
          try {
            balance = await fetchJettonBalance(activeJettonAddress, walletAddress);
            break;
          } catch (retryError) {
            lastError = retryError;
          }
        }
        if (!balance) throw lastError instanceof Error ? lastError : new Error('Unable to load jetton balance');
        if (!cancelled) {
          setTokenBalance(BigInt(balance.balance));
          setUserJettonWalletAddress(balance.walletAddress);
        }
      } catch (balanceError) {
        if (!cancelled) {
          console.warn('Unable to load jetton balance', balanceError);
          setTokenBalance((current) => current);
        }
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    }

    void loadTokenBalance();
    return () => {
      cancelled = true;
    };
  }, [activeJettonAddress, balanceNonce, liveTradeCount, walletAddress]);

  const token = data?.token;
  const chartPeriod = data?.chart[activePeriod];
  const chartData = chartPeriod?.data ?? [];
  const chartDataUsd = chartData.map((value) => value * TON_USD_PRICE);
  const currentValue = chartDataUsd[chartDataUsd.length - 1] ?? (token?.marketCapTon ?? 0) * TON_USD_PRICE;
  const firstValue = chartDataUsd[0] ?? currentValue;
  const delta = currentValue - firstValue;
  const deltaPercent = firstValue > 0 ? (delta / firstValue) * 100 : 0;
  const tradeAmountNano = parseDecimalToNano(tradeAmount);
  const tokenQuoteRow = token ? {
    address: token.address,
    virtual_ton_reserves: token.virtualTonReserves,
    virtual_token_reserves: token.virtualTokenReserves,
    migration_market_cap_ton: token.migrationMarketCapNano,
  } : null;
  const buyQuote = token && tokenQuoteRow && !token.migrated ? quoteBondingCurveBuy(tokenQuoteRow, tradeAmountNano) : null;
  const sellQuote = token && tokenQuoteRow && !token.migrated ? quoteBondingCurveSell(tokenQuoteRow, tradeAmountNano) : null;
  const selectedTradeSize = TRADE_SIZE_FILTERS.find((filter) => filter.id === tradeSizeFilter) || TRADE_SIZE_FILTERS[0];
  const liveTrades = [...(data?.trades || [])]
    .filter((trade) => trade.tonAmount >= selectedTradeSize.minTon)
    .sort((a, b) => {
      const aTime = new Date(a.timestamp || 0).getTime();
      const bTime = new Date(b.timestamp || 0).getTime();
      return tradeSort === 'newest' ? bTime - aTime : aTime - bTime;
    });
  const selectedBuyPreset = tradeSide === 'buy' ? BUY_PRESETS.find((preset) => preset === tradeAmount) : undefined;
  const selectedSellPreset = tradeSide === 'sell' && tokenBalance && tokenBalance > 0n
    ? SELL_PRESETS.find((preset) => (tokenBalance * BigInt(preset)) / 100n === tradeAmountNano)
    : undefined;
  const sellExceedsBalance = tradeSide === 'sell' && tokenBalance !== null && tradeAmountNano > tokenBalance;

  const scrubberLabel = (index: number) => {
    const value = chartDataUsd[index] ?? 0;
    const timestamp = chartPeriod?.labels[index];
    const dateLabel = timestamp
      ? new Date(timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : `Point ${index + 1}`;

    return `${formatUsd(value)} ${dateLabel}`;
  };

  const splitIndex = Math.max(0, Math.min(chartDataUsd.length - 1, scrubberPosition ?? chartDataUsd.length - 1));
  const chartSeries = scrubberPosition === undefined || chartDataUsd.length === 0
    ? [
        {
          id: 'marketCap',
          data: chartDataUsd,
          color: 'var(--tonked-blue)',
        },
      ]
    : [
        {
          id: 'marketCapPast',
          data: chartDataUsd.map((value, index) => (index <= splitIndex ? value : null)),
          color: 'var(--tonked-blue)',
        },
        {
          id: 'marketCapFuture',
          data: chartDataUsd.map((value, index) => (index >= splitIndex ? value : null)),
          color: 'var(--chart-future-line)',
        },
      ];

  const scrubberSeriesId = scrubberPosition === undefined ? 'marketCap' : 'marketCapPast';

  function setSellPercent(percent: number) {
    if (!tokenBalance || tokenBalance <= 0n) return;
    setTradeAmount(formatNanoAmount((tokenBalance * BigInt(percent)) / 100n, 9));
  }

  function applyOptimisticCurveTrade(type: 'buy' | 'sell') {
    if (!token || !data || token.migrated) return;
    const quote = type === 'buy' ? buyQuote : sellQuote;
    if (!quote) return;

    const newVirtualTonReserves = quote.newVirtualTonReserves;
    const newVirtualTokenReserves = quote.newVirtualTokenReserves;
    const nextMarketCapTon = marketCapTonFromReserves(newVirtualTonReserves, newVirtualTokenReserves);
    const nextPriceTon = priceTonFromReserves(newVirtualTonReserves, newVirtualTokenReserves);
    const tonAmount = type === 'buy' ? nanoToDisplay(tradeAmountNano) : nanoToDisplay(sellQuote?.tonOut || 0n);
    const tokenAmount = type === 'buy' ? nanoToDisplay(buyQuote?.tokensOut || 0n) : nanoToDisplay(tradeAmountNano);

    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        token: {
          ...current.token,
          virtualTonReserves: newVirtualTonReserves.toString(),
          virtualTokenReserves: newVirtualTokenReserves.toString(),
          marketCapTon: nextMarketCapTon,
          priceTon: nextPriceTon,
          volumeTon: current.token.volumeTon + Math.max(0, tonAmount),
        },
        chart: appendOptimisticChartPoint(current.chart, nextMarketCapTon),
        trades: [
          {
            id: `optimistic-${Date.now()}`,
            type,
            source: 'bonding_curve',
            tonAmount,
            tokenAmount,
            feeTon: type === 'sell' ? nanoToDisplay(sellQuote?.fee || 0n) : 0,
            feeTokenAmount: 0,
            trader: walletAddress,
            timestamp: new Date().toISOString(),
            txHash: null,
          },
          ...current.trades,
        ].slice(0, 120),
      };
    });

    if (type === 'buy') {
      setTokenBalance((value) => value === null ? buyQuote?.tokensOut || 0n : value + (buyQuote?.tokensOut || 0n));
    } else {
      setTokenBalance((value) => value === null ? value : value > tradeAmountNano ? value - tradeAmountNano : 0n);
    }
  }

  function queuePostTradeRefresh() {
    refreshTimers.current.forEach((timer) => clearTimeout(timer));
    refreshTimers.current = [];
    const refresh = () => {
      setRefreshNonce((value) => value + 1);
      setBalanceNonce((value) => value + 1);
    };
    for (const delay of [1_500, 3_500, 7_000, 12_000]) {
      refreshTimers.current.push(setTimeout(refresh, delay));
    }
  }

  async function handleTrade() {
    if (!token) return;
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }
    if (tradeAmountNano <= 0n || sellExceedsBalance) return;
    if (wallet.account.chain !== TONCONNECT_TESTNET_CHAIN) {
      setTradeStatus('Switch your wallet to TON testnet before trading.');
      return;
    }

    setSending(true);
    setTradeStatus('Confirm transaction in your wallet...');
    try {
      const submittedSide = tradeSide;
      if (token.migrated) {
        const response = await fetch('/api/stonfi/swap-params', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            side: tradeSide,
            jettonMaster: token.jettonAddress,
            userWallet: wallet.account.address,
            amountNano: tradeAmountNano.toString(),
            minOutNano: '0',
          }),
        });
        const swap = await response.json() as { address?: string; amount?: string; payload?: string; error?: string };
        if (!response.ok || !swap.address || !swap.amount) throw new Error(swap.error || 'Unable to build STON.fi swap');
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          network: TONCONNECT_TESTNET_CHAIN,
          messages: [{ address: swap.address, amount: swap.amount, payload: swap.payload || undefined }],
        });
      } else if (tradeSide === 'buy') {
        if (!buyQuote) throw new Error('Unable to quote buy');
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          network: TONCONNECT_TESTNET_CHAIN,
          messages: [{
            address: token.address,
            amount: buyQuote.txValue.toString(),
            payload: buyTokensBody(BigInt(Date.now())).toBoc().toString('base64'),
          }],
        });
      } else {
        if (!token.jettonAddress) throw new Error('Jetton master is missing');
        const balance = userJettonWalletAddress
          ? { walletAddress: userJettonWalletAddress }
          : await fetchJettonBalance(token.jettonAddress, wallet.account.address);
        const queryId = BigInt(Date.now());
        const payload = jettonTransferBody({
          queryId,
          amount: tradeAmountNano,
          destination: Address.parse(token.address),
          responseDestination: Address.parse(wallet.account.address),
          forwardTonAmount: DEFAULT_SELL_FORWARD_TON,
          forwardPayload: sellForwardPayload(queryId),
        });
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          network: TONCONNECT_TESTNET_CHAIN,
          messages: [{
            address: balance.walletAddress,
            amount: DEFAULT_SELL_TRANSFER_VALUE.toString(),
            payload: payload.toBoc().toString('base64'),
          }],
        });
      }
      if (!token.migrated) {
        optimisticUntil.current = Date.now() + 45_000;
        applyOptimisticCurveTrade(submittedSide);
      }
      setTradeStatus(null);
      queuePostTradeRefresh();
      setTradeAmount(tradeSide === 'buy' ? '0.1' : '');
    } catch (error) {
      setTradeStatus(formatUserError(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="dashboard-shell token-detail-shell">
      <TokenTopbar />

      <section className="dashboard-canvas token-detail-canvas" aria-label="Token detail canvas">
        <div className="token-detail-panel">
          <div className="dashboard-shelf-ridge token-detail-ridge" aria-hidden="true" />

          {loading && (
            <div className="token-detail-state-card">
              <strong>Loading token</strong>
              <span>Fetching launchpad stats and trades.</span>
            </div>
          )}

          {!loading && notFound && (
            <div className="token-detail-state-card">
              <strong>Token not found</strong>
              <span>No launched token matches this contract address.</span>
              <button type="button" className="connect-wallet-button" onClick={() => router.push('/tokens')}>
                <span>Back to tokens</span>
              </button>
            </div>
          )}

          {!loading && error && (
            <div className="token-detail-state-card">
              <strong>Unable to load token</strong>
              <span>{error}</span>
            </div>
          )}

          {!loading && token && data && (
            <div className="token-detail-grid">
              <section className="token-detail-chart-card">
                <div className="token-detail-hero-row">
                  <TokenImage token={token} className="token-detail-hero-image" />
                  <div className="token-detail-heading">
                    <div className="token-detail-title-row">
                      <div className="token-detail-title-stack">
                        <span className="meme-kind-pill">Meme</span>
                        <h1>{token.name}</h1>
                        <strong>${token.ticker}</strong>
                      </div>
                      <div
                        className="meme-progress-row token-detail-title-progress"
                        style={{ '--meme-progress': `${token.progressPercent}%` } as CSSProperties}
                      >
                        <span className="meme-progress-track" aria-hidden="true"><span /></span>
                        <strong>{token.progressPercent.toFixed(2)}%</strong>
                      </div>
                    </div>
                    <p>{token.description || `Launched on Tonked with a fair bonding curve on TON.`}</p>
                  </div>
                </div>

                <div className="token-detail-delta-card">
                  <div className="token-detail-market-cap">
                    <span>Market cap</span>
                    <strong>{formatUsd(currentValue, { maximumFractionDigits: 2 })}</strong>
                    <small className={delta >= 0 ? 'is-positive' : 'is-negative'}>
                      {delta >= 0 ? '+' : ''}{formatUsd(delta, { maximumFractionDigits: 2 })}
                      {' '}
                      ({delta >= 0 ? '+' : ''}{deltaPercent.toFixed(2)}%)
                      {' '}
                      {PERIODS.find((period) => period.id === activePeriod)?.label}
                    </small>
                  </div>
                </div>

                <div className="token-detail-chart-shell">
                  <LineChart
                    enableScrubbing
                    onScrubberPositionChange={setScrubberPosition}
                    showArea
                    accessibilityLabel={`${token.name} market cap chart for ${activePeriod}`}
                    areaType="dotted"
                    height={{ base: 230, tablet: 285, desktop: 330 }}
                    inset={{ top: 20, right: 50, bottom: 12, left: 50 }}
                    series={chartSeries}
                    strokeWidth={3}
                    style={{ outlineColor: 'var(--tonked-blue)' }}
                    transitions={{
                      enter: { type: 'tween', duration: 0.55 },
                      update: { type: 'spring', stiffness: 700, damping: 95, mass: 3 },
                    }}
                  >
                    <Scrubber
                      hideOverlay
                      idlePulse
                      overlayOffset={3}
                      seriesIds={[scrubberSeriesId]}
                      accessibilityLabel={(index) => scrubberLabel(index)}
                      label={(index) => scrubberLabel(index)}
                      labelElevated
                    />
                  </LineChart>
                </div>

                <div className="token-detail-chart-footer">
                  <div className="token-detail-period-tabs" aria-label="Chart period">
                    {PERIODS.map((period) => (
                      <button
                        type="button"
                        className={period.id === activePeriod ? 'is-active' : undefined}
                        key={period.id}
                        onClick={() => {
                          setActivePeriod(period.id);
                          setScrubberPosition(undefined);
                        }}
                      >
                        {period.label}
                      </button>
                    ))}
                  </div>
                </div>

                <section className="token-detail-live-trades" aria-label="Live token trades">
                  <header className="token-detail-live-trades-header">
                    <div>
                      <span>Live trades</span>
                      <strong>{compactNumber(liveTrades.length)} fills</strong>
                    </div>
                    <div className="token-detail-live-trade-controls">
                      <label>
                        <span>Sort</span>
                        <select value={tradeSort} onChange={(event) => setTradeSort(event.target.value as 'newest' | 'oldest')}>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                        </select>
                      </label>
                      <label>
                        <span>Size</span>
                        <select value={tradeSizeFilter} onChange={(event) => setTradeSizeFilter(event.target.value)}>
                          {TRADE_SIZE_FILTERS.map((filter) => (
                            <option value={filter.id} key={filter.id}>{filter.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </header>
                  <div className="token-detail-live-trades-table">
                    <div className="token-detail-live-trades-head">
                      <span>Side</span>
                      <span>Tokens</span>
                      <span>TON</span>
                      <span>USD</span>
                      <span>Wallet</span>
                      <span>Time</span>
                    </div>
                    <div className="token-detail-live-trades-list">
                      {liveTrades.length ? liveTrades.map((trade) => (
                        <article className={`token-detail-live-trade-row token-detail-live-trade-${trade.type}`} key={trade.id}>
                          <span>{trade.type}</span>
                          <strong>{compactNumber(trade.tokenAmount, { maximumFractionDigits: trade.tokenAmount < 1 ? 6 : 2 })} {token.ticker}</strong>
                          <strong>{formatTon(trade.tonAmount, { maximumFractionDigits: 4 })}</strong>
                          <strong>{formatUsd(trade.tonAmount * TON_USD_PRICE, { maximumFractionDigits: 2 })}</strong>
                          <code>{shortWallet(trade.trader)}</code>
                          <small>{formatTimeAgo(trade.timestamp)}</small>
                        </article>
                      )) : (
                        <p>{data.trades.length ? 'No trades match this size filter.' : 'No live trades yet.'}</p>
                      )}
                    </div>
                  </div>
                </section>
              </section>

              <div className="token-detail-side-column">
                <aside
                  className={`token-detail-trade-card token-detail-trade-card-${tradeSide} token-detail-trade-card-combined`}
                  aria-label={`Trade ${token.name}`}
                >
                  <div className="token-detail-trade-header">
                    <div>
                      <span>Trade</span>
                      <strong>${token.ticker}</strong>
                    </div>
                    <div className="token-detail-trade-tabs" aria-label="Trade side">
                      <button
                        type="button"
                        className={tradeSide === 'buy' ? 'is-active' : undefined}
                        onClick={() => setTradeSide('buy')}
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        className={tradeSide === 'sell' ? 'is-active' : undefined}
                        onClick={() => setTradeSide('sell')}
                      >
                        Sell
                      </button>
                    </div>
                  </div>

                  <label className="token-detail-trade-field">
                    <span>{tradeSide === 'buy' ? 'You pay' : 'You sell'}</span>
                    <div>
                      <input
                        inputMode="decimal"
                        value={tradeAmount}
                        onChange={(event) => setTradeAmount(event.target.value)}
                      />
                      <strong>{tradeSide === 'buy' ? 'TON' : token.ticker}</strong>
                    </div>
                  </label>

                  <div className="token-detail-presets" aria-label={`${tradeSide} presets`}>
                    {tradeSide === 'buy'
                      ? BUY_PRESETS.map((preset) => (
                          <button
                            type="button"
                            className={selectedBuyPreset === preset ? 'is-active' : undefined}
                            key={preset}
                          onClick={() => setTradeAmount(preset)}
                          >
                            {preset} TON
                          </button>
                        ))
                      : SELL_PRESETS.map((preset) => (
                          <button
                            type="button"
                            className={selectedSellPreset === preset ? 'is-active' : undefined}
                            key={preset}
                            onClick={() => setSellPercent(preset)}
                          >
                            {preset === 100 ? 'Max' : `${preset}%`}
                          </button>
                        ))}
                  </div>

                  <div className="token-detail-trade-quote">
                    <span>
                      {token.migrated
                        ? `Estimated ${tradeSide === 'buy' ? 'STON.fi receive' : 'STON.fi return'}`
                        : tradeSide === 'buy' ? 'Estimated receive' : 'Estimated return after 2% sell fee'}
                    </span>
                    <strong>
                      {token.migrated
                        ? 'Quoted by STON.fi on submit'
                        : tradeSide === 'buy'
                          ? `${compactNumber(Number(buyQuote?.tokensOut || 0n) / 1e9, { maximumFractionDigits: 2 })} ${token.ticker}`
                          : formatTon(Number(sellQuote?.tonOut || 0n) / 1e9, { maximumFractionDigits: 6 })}
                    </strong>
                  </div>
                  {tradeSide === 'sell' && wallet && (
                    <div className="token-detail-trade-balance">
                      <span>Balance</span>
                      <strong>
                        {balanceLoading || tokenBalance === null
                          ? 'Loading...'
                          : `${formatNanoAmount(tokenBalance, 4)} ${token.ticker}`}
                      </strong>
                    </div>
                  )}
                  {sellExceedsBalance && <p className="token-detail-trade-error">Amount exceeds wallet balance.</p>}
                  {tradeStatus && <p className="token-detail-trade-status">{tradeStatus}</p>}

                  <button
                    type="button"
                    className={`connect-wallet-button token-detail-trade-button token-detail-trade-button-${tradeSide}`}
                    disabled={sending || sellExceedsBalance}
                    onClick={() => void handleTrade()}
                  >
                    <span>
                      {!wallet
                        ? 'Connect wallet'
                        : sending
                          ? 'Waiting...'
                          : `${tradeSide === 'buy' ? 'Buy' : 'Sell'} $${token.ticker}`}
                    </span>
                  </button>

                  <section className="token-detail-inline-stats" aria-label="Token stats">
                    <div className="token-detail-stat-grid">
                      <div><span>Name</span><strong>{token.name}</strong></div>
                      <div><span>Symbol</span><strong>${token.ticker}</strong></div>
                      <div><span>Network</span><strong>TON</strong></div>
                      <div><span>Market Cap</span><strong>{formatTon(token.marketCapTon)}</strong></div>
                      <div><span>Price</span><strong>{formatPrice(token.priceTon)}</strong></div>
                      <div><span>Volume</span><strong>{formatTon(token.volumeTon)}</strong></div>
                      <div><span>Holders</span><strong>{compactNumber(token.holders)}</strong></div>
                      <div><span>Status</span><strong>{token.migrated ? 'STON.fi' : 'Bonding'}</strong></div>
                      <div><span>Created</span><strong>{formatTimeAgo(token.createdAt)}</strong></div>
                    </div>
                  </section>
                </aside>
              </div>

            </div>
          )}
        </div>
      </section>
    </main>
  );
}
