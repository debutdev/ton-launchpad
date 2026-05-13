'use client';

import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { Bell, Coins, Moon, Search, Sun, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  valueUsd?: number;
};

type WalletHolding = {
  token: {
    address: string;
    name: string;
    ticker: string;
    imageUrl: string | null;
    priceUsd: number;
    decimals: number;
    isNative: boolean;
  };
  balance: number;
  balanceNano: string;
  valueUsd: number;
  launchpadToken?: PortfolioToken;
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
  tonUsd: number;
  summary: {
    createdCount: number;
    tradedCount: number;
    tradeCount: number;
    buyVolumeTon: number;
    sellVolumeTon: number;
    netFlowTon: number;
    holdingsCount: number;
    holdingsValueTon: number;
    holdingsValueUsd: number;
    nativeTonBalance: number;
    nativeTonValueUsd: number;
  };
  createdTokens: PortfolioToken[];
  tradedTokens: PortfolioToken[];
  holdings: PortfolioHolding[];
  walletHoldings: WalletHolding[];
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

function formatUsd(value: number, options?: Intl.NumberFormatOptions) {
  if (!Number.isFinite(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 10_000 ? 0 : 2,
    ...options,
  }).format(value);
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

function HoldingThumb({ holding, index }: { holding: WalletHolding; index: number }) {
  if (holding.token.isNative) {
    return (
      <div className="portfolio-native-token-mark" aria-hidden="true">
        <Coins size={19} strokeWidth={2.5} />
      </div>
    );
  }

  const imageUrl = holding.token.imageUrl || fallbackImages[index % fallbackImages.length];
  return imageUrl ? (
    <img
      alt=""
      src={imageUrl}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  ) : (
    <span>${holding.token.ticker}</span>
  );
}

function HoldingRow({ holding, index }: { holding: WalletHolding; index: number }) {
  const router = useRouter();
  const token = holding.launchpadToken;
  const openToken = () => {
    if (token) router.push(`/tokens/${encodeURIComponent(token.address)}`);
  };

  return (
    <article
      className={`portfolio-table-row portfolio-holding-row${token ? ' is-clickable' : ''}`}
      role={token ? 'button' : undefined}
      tabIndex={token ? 0 : undefined}
      onClick={openToken}
      onKeyDown={(event) => {
        if (token && (event.key === 'Enter' || event.key === ' ')) openToken();
      }}
    >
      <div className="portfolio-row-token">
        <div className="portfolio-row-image">
          <HoldingThumb holding={holding} index={index} />
        </div>
        <div>
          <strong>{holding.token.name}</strong>
          <span>{holding.token.ticker}</span>
        </div>
      </div>
      <strong className="portfolio-table-balance">{compactNumber(holding.balance, { maximumFractionDigits: holding.balance < 1 ? 6 : 2 })}</strong>
      <strong className="portfolio-table-value">{formatUsd(holding.valueUsd)}</strong>
      <span className="portfolio-table-price">{holding.token.priceUsd > 0 ? formatUsd(holding.token.priceUsd, { maximumFractionDigits: 6 }) : '--'}</span>
    </article>
  );
}

function CreatedTokenRow({ token, index, tonUsd }: { token: PortfolioToken; index: number; tonUsd: number }) {
  const router = useRouter();
  const openToken = () => router.push(`/tokens/${encodeURIComponent(token.address)}`);

  return (
    <article
      className="portfolio-table-row portfolio-created-row is-clickable"
      role="button"
      tabIndex={0}
      onClick={openToken}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') openToken();
      }}
      style={{ '--meme-progress': `${token.progressPercent}%` } as CSSProperties}
    >
      <div className="portfolio-row-token">
        <div className="portfolio-row-image">
          <TokenThumb token={token} index={index} />
        </div>
        <div>
          <strong>{token.name}</strong>
          <span>${token.ticker}</span>
        </div>
      </div>
      <strong className="portfolio-created-age">{formatTimeAgo(token.createdAt)}</strong>
      <strong className="portfolio-table-value">{formatUsd(token.marketCapTon * tonUsd)}</strong>
      <div className="portfolio-created-bonding">
        <span className="meme-progress-track" aria-hidden="true"><span /></span>
        <strong>{token.progressPercent.toFixed(0)}%</strong>
      </div>
    </article>
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
  const tonUsd = data?.tonUsd || 0;

  useEffect(() => {
    if (!walletAddress) {
      queueMicrotask(() => setData(null));
      queueMicrotask(() => setError(null));
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
            <section className="portfolio-account-strip">
              <div className="portfolio-profile-cell">
                <div className="portfolio-avatar" aria-hidden="true">
                  <Wallet size={28} strokeWidth={2.4} />
                </div>
                <div>
                  <h1>{shortWallet(wallet.account.address)}</h1>
                  <span>{loading ? 'Loading wallet stats...' : error || 'TON portfolio'}</span>
                </div>
              </div>
              <div className="portfolio-stat-cell portfolio-stat-primary">
                <span>Portfolio value</span>
                <strong>{formatUsd(data?.summary.holdingsValueUsd || 0)}</strong>
                <small>{formatTon(data?.summary.nativeTonBalance || 0, { maximumFractionDigits: 4 })} @ {tonUsd ? formatUsd(tonUsd) : '--'}</small>
              </div>
              <div className="portfolio-stat-cell">
                <span>Total tokens created</span>
                <strong>{compactNumber(data?.summary.createdCount || 0)}</strong>
              </div>
              <div className="portfolio-stat-cell">
                <span>Tokens held</span>
                <strong>{compactNumber(data?.summary.holdingsCount || 0)}</strong>
              </div>
              <div className="portfolio-stat-cell">
                <span>Tokens traded</span>
                <strong>{compactNumber(data?.summary.tradedCount || 0)}</strong>
              </div>
            </section>

            <section className="portfolio-split-grid">
              <div className="portfolio-section-card portfolio-table-card">
                <header>
                  <span>Portfolio holdings</span>
                  <strong>{compactNumber(data?.summary.holdingsCount || 0)}</strong>
                </header>
                <div className="portfolio-table-head portfolio-holdings-head">
                  <span>Token</span>
                  <span>Balance</span>
                  <span>Value</span>
                  <span>Price</span>
                </div>
                <div className="portfolio-table-list">
                  {data?.walletHoldings.length ? data.walletHoldings.map((holding, index) => (
                    <HoldingRow holding={holding} index={index} key={`${holding.token.address}-${index}`} />
                  )) : (
                    <p>{loading ? 'Loading holdings...' : 'No TON or jetton holdings found for this wallet yet.'}</p>
                  )}
                </div>
              </div>

              <div className="portfolio-section-card portfolio-table-card">
                <header>
                  <span>Created tokens</span>
                  <strong>{compactNumber(data?.summary.createdCount || 0)}</strong>
                </header>
                <div className="portfolio-table-head portfolio-created-head">
                  <span>Token</span>
                  <span>Age</span>
                  <span>Mcap</span>
                  <span>Bonding</span>
                </div>
                <div className="portfolio-table-list">
                  {data?.createdTokens.length ? data.createdTokens.map((token, index) => (
                    <CreatedTokenRow token={token} index={index} key={token.address} tonUsd={tonUsd} />
                  )) : (
                    <p>No tokens created from this wallet.</p>
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
