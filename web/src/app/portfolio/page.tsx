'use client';

import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { Bell, Moon, Search, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelGridShader } from '../PixelGridShader';
import { TopbarNav } from '../TopbarNav';
import { useThemeMode } from '../providers';
import { subscribeLaunchpadEvents } from '@/lib/liveEvents';
import { supabase } from '@/lib/supabase';

type PortfolioToken = {
  address: string;
  creatorAddress: string;
  name: string;
  ticker: string;
  imageUrl: string | null;
  marketCapTon: number;
  priceTon: number;
  holders: number;
  volumeTon: number;
  progressPercent: number;
  migrated: boolean;
  createdAt: string | null;
};

type PortfolioHolding = {
  token: PortfolioToken;
  balance: number;
  balanceNano: string;
  valueTon: number;
};

type PortfolioTrade = {
  id: string;
  tokenAddress: string;
  type: 'buy' | 'sell';
  source: string;
  tonAmount: number;
  tokenAmount: number;
  feeTon: number;
  trader: string;
  timestamp: string | null;
  txHash: string | null;
  token: PortfolioToken | null;
};

type PortfolioResponse = {
  wallet: string;
  summary: {
    createdCount: number;
    tradedCount: number;
    tradeCount: number;
    buyVolumeTon: number;
    sellVolumeTon: number;
    netFlowTon: number;
    holdingsCount: number;
    holdingsValueTon: number;
  };
  createdTokens: PortfolioToken[];
  tradedTokens: PortfolioToken[];
  holdings: PortfolioHolding[];
  recentTrades: PortfolioTrade[];
};

const fallbackImages = [
  '/memes/tonk-batcat.jpg',
  '/memes/rocket-cat.png',
  '/memes/blue-pepe.png',
  '/memes/diamond-frog.png',
  '/memes/ice-hamster.png',
  '/memes/moon-toast.jpg',
  '/memes/pixel-whale.png',
];

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
  return `${compactNumber(value, options)} TON`;
}

function formatTokenAmount(value: number, ticker: string) {
  return `${compactNumber(value, { maximumFractionDigits: value < 1 ? 6 : 2 })} ${ticker}`;
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

function PortfolioTopbar() {
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

function TokenThumb({ token, index }: { token: PortfolioToken; index: number }) {
  const imageUrl = token.imageUrl || fallbackImages[index % fallbackImages.length];
  return imageUrl ? (
    <img
      alt=""
      src={imageUrl}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  ) : (
    <span>${token.ticker}</span>
  );
}

function HoldingCard({ holding, index }: { holding: PortfolioHolding; index: number }) {
  const router = useRouter();
  const token = holding.token;
  const openToken = () => router.push(`/tokens/${encodeURIComponent(token.address)}`);

  return (
    <article
      className="portfolio-token-card"
      role="button"
      tabIndex={0}
      onClick={openToken}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') openToken();
      }}
    >
      <div className="portfolio-token-image">
        <TokenThumb token={token} index={index} />
      </div>
      <div className="portfolio-token-copy">
        <div className="portfolio-token-title">
          <strong>{token.name}</strong>
          <span>${token.ticker}</span>
        </div>
        <div className="portfolio-token-metrics">
          <div><span>Holding</span><strong>{formatTokenAmount(holding.balance, token.ticker)}</strong></div>
          <div><span>Value</span><strong>{formatTon(holding.valueTon, { maximumFractionDigits: 4 })}</strong></div>
          <div><span>Market cap</span><strong>{formatTon(token.marketCapTon)}</strong></div>
          <div><span>Status</span><strong>{token.migrated ? 'STON.fi' : 'Bonding'}</strong></div>
        </div>
      </div>
    </article>
  );
}

function MiniTokenCard({ token, index, label }: { token: PortfolioToken; index: number; label: string }) {
  const router = useRouter();
  const openToken = () => router.push(`/tokens/${encodeURIComponent(token.address)}`);

  return (
    <article
      className="portfolio-mini-token-card"
      role="button"
      tabIndex={0}
      onClick={openToken}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') openToken();
      }}
    >
      <div className="portfolio-mini-token-image">
        <TokenThumb token={token} index={index} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{token.name}</strong>
        <small>${token.ticker} - {formatTon(token.marketCapTon)}</small>
      </div>
    </article>
  );
}

function TradeRow({ trade }: { trade: PortfolioTrade }) {
  return (
    <div className={`portfolio-trade-row portfolio-trade-${trade.type}`}>
      <span>{trade.type}</span>
      <strong>{trade.token ? `$${trade.token.ticker}` : 'Token'}</strong>
      <code>{formatTon(trade.tonAmount, { maximumFractionDigits: 4 })}</code>
      <small>{formatTimeAgo(trade.timestamp)}</small>
    </div>
  );
}

export default function PortfolioPage() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletAddress = wallet?.account.address || '';

  const netFlowLabel = useMemo(() => {
    const value = data?.summary.netFlowTon || 0;
    return `${value >= 0 ? '+' : ''}${formatTon(value, { maximumFractionDigits: 4 })}`;
  }, [data?.summary.netFlowTon]);

  useEffect(() => {
    if (!walletAddress) {
      setData(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    async function loadPortfolio() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/portfolio?wallet=${encodeURIComponent(walletAddress)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json() as PortfolioResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Portfolio request failed');
        setData(payload);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load portfolio');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadPortfolio();
    return () => controller.abort();
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    const refresh = () => {
      if (refreshDebounce.current) clearTimeout(refreshDebounce.current);
      refreshDebounce.current = setTimeout(() => {
        fetch(`/api/portfolio?wallet=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' })
          .then((response) => response.ok ? response.json() : null)
          .then((payload: PortfolioResponse | null) => {
            if (payload) setData(payload);
          })
          .catch(() => undefined);
      }, 350);
    };
    const tokenChannel = supabase.channel(`portfolio-tokens-${walletAddress}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens' }, refresh)
      .subscribe();
    const tradeChannel = supabase.channel(`portfolio-trades-${walletAddress}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, refresh)
      .subscribe();
    const unsubscribeLive = subscribeLaunchpadEvents(refresh);

    return () => {
      if (refreshDebounce.current) clearTimeout(refreshDebounce.current);
      supabase.removeChannel(tokenChannel);
      supabase.removeChannel(tradeChannel);
      unsubscribeLive();
    };
  }, [walletAddress]);

  return (
    <main className="dashboard-shell">
      <PortfolioTopbar />

      <section className="dashboard-canvas portfolio-page-canvas" aria-label="Portfolio canvas">
        <PixelGridShader
          className="portfolio-pixel-grid-bg"
          shape="noise"
          matrix="bayer8"
          pxSize={2}
          amplitude={0.15}
          frequency={0.7}
          speed={0.08}
          rings={3}
          colorFg="#5498e6"
          cursorMode="ripple"
          cursorSize={0.3}
          cursorScale={0.12}
        />

        {!wallet && (
          <div className="portfolio-empty-card">
            <span>Portfolio</span>
            <h1>Connect wallet</h1>
            <p>See launched tokens, traded tokens, current holdings, and recent activity for your TON wallet.</p>
            <button type="button" className="connect-wallet-button portfolio-connect-button" onClick={() => tonConnectUI.openModal()}>
              <span>Connect wallet</span>
            </button>
          </div>
        )}

        {wallet && (
          <div className="portfolio-dashboard">
            <section className="portfolio-overview-card">
              <div className="portfolio-overview-copy">
                <span>Portfolio</span>
                <h1>{shortWallet(wallet.account.address)}</h1>
                <p>{loading ? 'Loading wallet stats...' : error || 'Live wallet stats across Tonked launches and trades.'}</p>
              </div>
              <div className="portfolio-summary-grid">
                <div><span>Holdings value</span><strong>{formatTon(data?.summary.holdingsValueTon || 0, { maximumFractionDigits: 4 })}</strong></div>
                <div><span>Tokens created</span><strong>{compactNumber(data?.summary.createdCount || 0)}</strong></div>
                <div><span>Tokens traded</span><strong>{compactNumber(data?.summary.tradedCount || 0)}</strong></div>
                <div><span>Net flow</span><strong>{netFlowLabel}</strong></div>
              </div>
            </section>

            <section className="portfolio-main-grid">
              <div className="portfolio-section-card portfolio-holdings-card">
                <header>
                  <span>Holdings</span>
                  <strong>{compactNumber(data?.summary.holdingsCount || 0)}</strong>
                </header>
                <div className="portfolio-holdings-list">
                  {data?.holdings.length ? data.holdings.map((holding, index) => (
                    <HoldingCard holding={holding} index={index} key={holding.token.address} />
                  )) : (
                    <p>{loading ? 'Loading holdings...' : 'No token holdings found for this wallet yet.'}</p>
                  )}
                </div>
              </div>

              <div className="portfolio-section-card">
                <header>
                  <span>Recent trades</span>
                  <strong>{compactNumber(data?.summary.tradeCount || 0)}</strong>
                </header>
                <div className="portfolio-trades-list">
                  {data?.recentTrades.length ? data.recentTrades.slice(0, 12).map((trade) => (
                    <TradeRow trade={trade} key={trade.id} />
                  )) : (
                    <p>{loading ? 'Loading trades...' : 'No trades found for this wallet yet.'}</p>
                  )}
                </div>
              </div>

              <div className="portfolio-section-card">
                <header>
                  <span>Created tokens</span>
                  <strong>{compactNumber(data?.summary.createdCount || 0)}</strong>
                </header>
                <div className="portfolio-mini-token-list">
                  {data?.createdTokens.length ? data.createdTokens.slice(0, 8).map((token, index) => (
                    <MiniTokenCard token={token} index={index} label="Created" key={token.address} />
                  )) : (
                    <p>No tokens created from this wallet.</p>
                  )}
                </div>
              </div>

              <div className="portfolio-section-card">
                <header>
                  <span>Traded tokens</span>
                  <strong>{compactNumber(data?.summary.tradedCount || 0)}</strong>
                </header>
                <div className="portfolio-mini-token-list">
                  {data?.tradedTokens.length ? data.tradedTokens.slice(0, 8).map((token, index) => (
                    <MiniTokenCard token={token} index={index + 8} label="Traded" key={token.address} />
                  )) : (
                    <p>No traded tokens found.</p>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
