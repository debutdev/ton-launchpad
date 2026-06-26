'use client';

import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { RollingNumber } from '@coinbase/cds-web/numbers/RollingNumber';
import { Bell, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TopbarNav } from '../TopbarNav';
import { TopbarSearch } from '../TopbarSearch';
import { useThemeMode } from '../providers';
import { subscribeLaunchpadEvents } from '@/lib/liveEvents';
import { supabase } from '@/lib/supabase';

type SortKey = 'marketCap' | 'price' | 'name' | 'time';
type SortDirection = 'asc' | 'desc';

type TokenDirectoryItem = {
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
  createdAt: string | null;
};

type TokenDirectoryResponse = {
  items: TokenDirectoryItem[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

type RollingNumberFormat = Omit<Intl.NumberFormatOptions, 'notation'> & {
  notation?: 'compact' | 'standard';
};

const PAGE_SIZE = 16;
const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'marketCap', label: 'Market cap' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' },
  { value: 'time', label: 'Time launched' },
];

function shortWallet(address: string) {
  return address.length < 12 ? address : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function shortAddress(address: string) {
  return address.length < 16 ? address : `${address.slice(0, 6)}...${address.slice(-5)}`;
}

function compactNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    notation: value >= 10_000 ? 'compact' : 'standard',
    ...options,
  }).format(value);
}

function directionLabel(sort: SortKey, direction: SortDirection) {
  if (sort === 'name') return direction === 'asc' ? 'A-Z' : 'Z-A';
  if (sort === 'time') return direction === 'desc' ? 'Newest first' : 'Oldest first';
  return direction === 'desc' ? 'High to low' : 'Low to high';
}

function defaultDirectionForSort(sort: SortKey): SortDirection {
  return sort === 'name' ? 'asc' : 'desc';
}

function formatTokenPrice(priceTon: number) {
  if (!Number.isFinite(priceTon)) return '--';

  return `${compactNumber(priceTon, {
    maximumFractionDigits: priceTon < 0.01 ? 8 : 4,
  })} TON`;
}

function MemeMetricNumber({
  value,
  format,
  suffix,
  accessibilityLabel,
  className = 'meme-stat-value',
}: {
  value: number;
  format?: RollingNumberFormat;
  suffix?: string;
  accessibilityLabel: string;
  className?: string;
}) {
  return (
    <RollingNumber
      accessibilityLabel={accessibilityLabel}
      ariaLive="off"
      className={className}
      classNames={{
        formattedValueSection: 'meme-rolling-formatted',
        fraction: 'meme-rolling-part',
        i18nPrefix: 'meme-rolling-part',
        i18nSuffix: 'meme-rolling-part',
        integer: 'meme-rolling-part',
        suffix: 'meme-rolling-suffix',
        text: 'meme-rolling-text',
        visibleContent: 'meme-rolling-visible',
      }}
      colorPulseOnUpdate
      dangerouslySetColor="var(--tonked-blue)"
      digitTransitionVariant="single"
      format={format}
      noWrap
      styles={{
        formattedValueSection: { color: 'var(--tonked-blue)', display: 'inline-flex', whiteSpace: 'nowrap' },
        fraction: { color: 'var(--tonked-blue)', display: 'inline-flex', whiteSpace: 'nowrap' },
        i18nPrefix: { color: 'var(--tonked-blue)', display: 'inline-flex', whiteSpace: 'nowrap' },
        i18nSuffix: { color: 'var(--tonked-blue)', display: 'inline-flex', whiteSpace: 'nowrap' },
        integer: { color: 'var(--tonked-blue)', display: 'inline-flex', whiteSpace: 'nowrap' },
        root: { color: 'var(--tonked-blue)', display: 'inline-flex', whiteSpace: 'nowrap' },
        suffix: { color: 'var(--tonked-blue)', whiteSpace: 'nowrap' },
        text: { color: 'var(--tonked-blue)', whiteSpace: 'nowrap' },
        visibleContent: { color: 'var(--tonked-blue)', display: 'inline-flex', whiteSpace: 'nowrap' },
      }}
      suffix={suffix}
      tabularNumbers
      transition={{
        color: { duration: 0.35, ease: 'easeInOut' },
        y: { duration: 0.35, ease: 'easeOut' },
      }}
      value={Number.isFinite(value) ? value : 0}
    />
  );
}

function TokenDirectoryCard({
  token,
}: {
  token: TokenDirectoryItem;
}) {
  const router = useRouter();
  const imageUrl = token.imageUrl;
  const tokenHref = `/tokens/${encodeURIComponent(token.address)}`;

  function openTokenDetail() {
    router.push(tokenHref);
  }

  return (
    <article
      className="dashboard-float-card top-meme-card token-directory-card meme-card-link"
      aria-label={`${token.name} token`}
      role="link"
      tabIndex={0}
      onClick={openTokenDetail}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTokenDetail();
        }
      }}
    >
      <div className="meme-image-panel token-directory-image-panel">
        {imageUrl ? (
          <img
            alt=""
            className="meme-token-image"
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
      <div className="meme-card-body">
        <div className="meme-stat-inset">
          <div className="meme-card-topline">
            <div className="meme-title-stack">
              <h3>{token.name} <span>${token.ticker}</span></h3>
              <span className="meme-kind-pill">Meme</span>
            </div>
            <button
              type="button"
              className="meme-buy-button"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <span>Buy</span>
            </button>
          </div>
          <div className="meme-creator-row">
            <span>created by:</span>
            <code>{shortAddress(token.creatorAddress)}</code>
          </div>
          <div className="meme-stat-row">
            <div>
              <span>Market cap</span>
              <MemeMetricNumber
                accessibilityLabel={`Market cap ${compactNumber(token.marketCapTon)} TON`}
                format={{ notation: 'compact', maximumFractionDigits: 1 }}
                suffix=" TON"
                value={token.marketCapTon}
              />
            </div>
            <div>
              <span>Holders</span>
              <MemeMetricNumber
                accessibilityLabel={`${compactNumber(token.holders)} holders`}
                format={{ notation: 'compact', maximumFractionDigits: 1 }}
                value={token.holders}
              />
            </div>
          </div>
          <div className="token-directory-price-row">
            <span>Price</span>
            <strong>{formatTokenPrice(token.priceTon)}</strong>
          </div>
          <div
            className="meme-progress-row"
            style={{ '--meme-progress': `${token.progressPercent}%` } as CSSProperties}
          >
            <span className="meme-progress-track" aria-hidden="true">
              <span />
            </span>
            <MemeMetricNumber
              accessibilityLabel={`${token.progressPercent.toFixed(2)} percent bonded`}
              className="meme-progress-value"
              format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              suffix="%"
              value={token.progressPercent}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export default function TokensPage() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const { colorScheme, toggleColorScheme } = useThemeMode();
  const [sort, setSort] = useState<SortKey>('time');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuClosing, setSortMenuClosing] = useState(false);
  const sortMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<TokenDirectoryResponse>({
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    hasNext: false,
    hasPrevious: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data.pageSize, data.total]);

  const selectedSortLabel = useMemo(() => {
    return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Time launched';
  }, [sort]);

  function openSortMenu() {
    if (sortMenuCloseTimerRef.current) {
      clearTimeout(sortMenuCloseTimerRef.current);
      sortMenuCloseTimerRef.current = null;
    }
    setSortMenuClosing(false);
    setSortMenuOpen(true);
  }

  function closeSortMenu() {
    if (!sortMenuOpen || sortMenuClosing) return;

    setSortMenuClosing(true);
    sortMenuCloseTimerRef.current = setTimeout(() => {
      setSortMenuOpen(false);
      setSortMenuClosing(false);
      sortMenuCloseTimerRef.current = null;
    }, 190);
  }

  useEffect(() => {
    if (!sortMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        closeSortMenu();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeSortMenu();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [sortMenuClosing, sortMenuOpen]);

  useEffect(() => {
    return () => {
      if (sortMenuCloseTimerRef.current) {
        clearTimeout(sortMenuCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      direction,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
    });

    async function loadTokens() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/tokens?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Token directory request failed');
        const nextData = await response.json() as TokenDirectoryResponse;
        setData(nextData);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load tokens');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadTokens();

    return () => controller.abort();
  }, [direction, page, refreshNonce, sort]);

  useEffect(() => {
    const refresh = () => setRefreshNonce((value) => value + 1);
    const tokenChannel = supabase
      .channel('tokens-page-tokens')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens' }, refresh)
      .subscribe();
    const tradeChannel = supabase
      .channel('tokens-page-trades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, refresh)
      .subscribe();
    const candleChannel = supabase
      .channel('tokens-page-candles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'token_candles' }, refresh)
      .subscribe();
    const unsubscribeLiveEvents = subscribeLaunchpadEvents(refresh);

    return () => {
      supabase.removeChannel(tokenChannel);
      supabase.removeChannel(tradeChannel);
      supabase.removeChannel(candleChannel);
      unsubscribeLiveEvents();
    };
  }, []);

  function handleSortChange(nextSort: SortKey) {
    setSort(nextSort);
    setDirection(defaultDirectionForSort(nextSort));
    setPage(1);
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-topbar">
        <div className="topbar-left">
          <div className="topbar-brand">Instatgram</div>
          <span className="topbar-slash topbar-left-slash" aria-hidden="true">/</span>
          <TopbarNav />
        </div>
        <div className="topbar-actions">
          <TopbarSearch />
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

      <section className="dashboard-canvas tokens-page-canvas" aria-label="Tokens directory canvas">
        <div className="tokens-directory-panel">
          <div className="dashboard-shelf-ridge tokens-directory-ridge" aria-hidden="true" />
          <header className="tokens-directory-toolbar">
            <div className="tokens-directory-controls">
              <div className="tokens-sort-select tokens-sort-menu" ref={sortMenuRef}>
                <span>Sort by</span>
                <button
                  type="button"
                  className="tokens-sort-trigger"
                  aria-expanded={sortMenuOpen}
                  aria-haspopup="listbox"
                  onClick={() => {
                    if (sortMenuOpen) {
                      closeSortMenu();
                    } else {
                      openSortMenu();
                    }
                  }}
                >
                  <span>{selectedSortLabel}</span>
                </button>
                {sortMenuOpen && (
                  <div
                    className={`tokens-sort-popover${sortMenuClosing ? ' is-closing' : ''}`}
                    role="listbox"
                    aria-label="Sort tokens by"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <button
                        type="button"
                        className={option.value === sort ? 'is-selected' : undefined}
                        key={option.value}
                        role="option"
                        aria-selected={option.value === sort}
                        onClick={() => {
                          handleSortChange(option.value);
                          closeSortMenu();
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="tokens-toolbar-button"
                onClick={() => {
                  setDirection((current) => current === 'desc' ? 'asc' : 'desc');
                  setPage(1);
                }}
              >
                <span>{directionLabel(sort, direction)}</span>
              </button>
              <div className="tokens-pagination-controls" aria-label="Token pagination">
                <button
                  type="button"
                  className="tokens-toolbar-button"
                  disabled={!data.hasPrevious || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <span>Previous</span>
                </button>
                <span className="tokens-page-indicator">Page {data.page} / {totalPages}</span>
                <button
                  type="button"
                  className="tokens-toolbar-button tokens-next-button"
                  disabled={!data.hasNext || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <span>Next page</span>
                </button>
              </div>
            </div>
          </header>

          <div className="tokens-directory-grid" aria-busy={loading}>
            {data.items.map((token) => (
              <TokenDirectoryCard
                key={token.address}
                token={token}
              />
            ))}
            {!loading && data.items.length === 0 && (
              <div className="tokens-empty-state">
                <strong>No launched tokens yet</strong>
                <span>New launchpad tokens will appear here.</span>
              </div>
            )}
            {loading && data.items.length === 0 && (
              Array.from({ length: 8 }).map((_, index) => (
                <div className="dashboard-float-card token-directory-card tokens-loading-card" key={index} />
              ))
            )}
          </div>

          {error && <p className="tokens-directory-error">{error}</p>}
        </div>
      </section>
    </main>
  );
}
