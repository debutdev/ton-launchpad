'use client';

import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { RollingNumber } from '@coinbase/cds-web/numbers/RollingNumber';
import { Bell, Moon, Search, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { HexagonPattern } from './HexagonPattern';
import { InteractiveDots } from './InteractiveDots';
import { NumberTicker } from './NumberTicker';
import { TopbarNav } from './TopbarNav';
import { WordRotate } from './WordRotate';
import { useThemeMode } from './providers';
import { getMarketCap, getPriceInNanotons, MIGRATION_THRESHOLD } from '@/lib/bondingCurve';
import { subscribeLaunchpadEvents } from '@/lib/liveEvents';
import { supabase } from '@/lib/supabase';

type LaunchpadStats = {
  tonUsdPrice: number;
  tokensLaunched: number;
  buyVolumeTon: string;
  sellVolumeTon: string;
  totalVolumeTon: string;
  totalVolumeUsd: number;
  updatedAt: string;
};

type TokenRow = {
  address: string;
  creator_address: string | null;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  virtual_ton_reserves: string | number | null;
  virtual_token_reserves: string | number | null;
  real_ton_reserves: string | number | null;
  created_at: string | null;
};

type MemeTradeRow = {
  token_address: string | null;
  ton_amount: string | null;
  user_address: string | null;
};

type RecentTradeRow = MemeTradeRow & {
  type: 'buy' | 'sell' | string | null;
  token_amount: string | null;
  timestamp: string | null;
};

type RollingNumberFormat = Omit<Intl.NumberFormatOptions, 'notation'> & {
  notation?: 'compact' | 'standard';
};

type TopMeme = {
  rank: number;
  name: string;
  ticker: string;
  address: string;
  creatorAddress: string;
  imageUrl: string | null;
  marketCapTon: number;
  priceTon: number;
  holders: number;
  volumeTon: number;
  progressPercent: number;
  accentHue: number;
};

type RecentActivityItem = {
  id: string;
  type: 'buy' | 'sell' | 'launch';
  tokenName: string;
  ticker: string;
  amountLabel: string;
  userLabel: string;
  timeLabel: string;
  accentHue: number;
  timestampMs: number;
};

const NANOS_PER_TON = 1_000_000_000;

const FALLBACK_MEME_IMAGES = [
  '/memes/tonk-batcat.jpg',
  '/memes/rocket-cat.png',
  '/memes/blue-pepe.png',
  '/memes/diamond-frog.png',
  '/memes/ice-hamster.png',
  '/memes/moon-toast.jpg',
  '/memes/pixel-whale.png',
];

function fallbackMemeImageUrl(rank: number) {
  return FALLBACK_MEME_IMAGES[(Math.max(rank, 1) - 1) % FALLBACK_MEME_IMAGES.length];
}

const FALLBACK_TOP_MEMES: TopMeme[] = [
  {
    rank: 1,
    name: 'Tonked Inu',
    ticker: 'TONK',
    address: 'EQB1memeLaunchpadTopToken000000000000000001',
    creatorAddress: 'UQB1creatorLaunchpad000000000000000000001',
    imageUrl: fallbackMemeImageUrl(1),
    marketCapTon: 18_400,
    priceTon: 0.0000184,
    holders: 1284,
    volumeTon: 2840,
    progressPercent: 25.86,
    accentHue: 210,
  },
  {
    rank: 2,
    name: 'Rocket Cat',
    ticker: 'ROCAT',
    address: 'EQB2memeLaunchpadTopToken000000000000000002',
    creatorAddress: 'UQB2creatorLaunchpad000000000000000000002',
    imageUrl: fallbackMemeImageUrl(2),
    marketCapTon: 12_700,
    priceTon: 0.0000127,
    holders: 918,
    volumeTon: 1760,
    progressPercent: 18.42,
    accentHue: 254,
  },
  {
    rank: 3,
    name: 'Blue Pepe',
    ticker: 'BPEPE',
    address: 'EQB3memeLaunchpadTopToken000000000000000003',
    creatorAddress: 'UQB3creatorLaunchpad000000000000000000003',
    imageUrl: fallbackMemeImageUrl(3),
    marketCapTon: 9_520,
    priceTon: 0.00000952,
    holders: 642,
    volumeTon: 1118,
    progressPercent: 12.94,
    accentHue: 188,
  },
  {
    rank: 4,
    name: 'Diamond Frog',
    ticker: 'DFROG',
    address: 'EQB4memeLaunchpadTopToken000000000000000004',
    creatorAddress: 'UQB4creatorLaunchpad000000000000000000004',
    imageUrl: fallbackMemeImageUrl(4),
    marketCapTon: 7_840,
    priceTon: 0.00000784,
    holders: 528,
    volumeTon: 936,
    progressPercent: 10.82,
    accentHue: 228,
  },
  {
    rank: 5,
    name: 'Ice Hamster',
    ticker: 'IHAM',
    address: 'EQB5memeLaunchpadTopToken000000000000000005',
    creatorAddress: 'UQB5creatorLaunchpad000000000000000000005',
    imageUrl: fallbackMemeImageUrl(5),
    marketCapTon: 6_420,
    priceTon: 0.00000642,
    holders: 471,
    volumeTon: 804,
    progressPercent: 9.36,
    accentHue: 196,
  },
  {
    rank: 6,
    name: 'Moon Toast',
    ticker: 'MTOAST',
    address: 'EQB6memeLaunchpadTopToken000000000000000006',
    creatorAddress: 'UQB6creatorLaunchpad000000000000000000006',
    imageUrl: fallbackMemeImageUrl(6),
    marketCapTon: 5_380,
    priceTon: 0.00000538,
    holders: 389,
    volumeTon: 692,
    progressPercent: 7.74,
    accentHue: 244,
  },
  {
    rank: 7,
    name: 'Pixel Whale',
    ticker: 'PWHALE',
    address: 'EQB7memeLaunchpadTopToken000000000000000007',
    creatorAddress: 'UQB7creatorLaunchpad000000000000000000007',
    imageUrl: fallbackMemeImageUrl(7),
    marketCapTon: 4_260,
    priceTon: 0.00000426,
    holders: 312,
    volumeTon: 548,
    progressPercent: 6.18,
    accentHue: 214,
  },
];

const FALLBACK_RECENT_ACTIVITY: RecentActivityItem[] = [
  {
    id: 'fallback-buy-tonk',
    type: 'buy',
    tokenName: 'Tonked Inu',
    ticker: 'TONK',
    amountLabel: '2.4 TON',
    userLabel: 'UQB1cr...00001',
    timeLabel: 'just now',
    accentHue: 210,
    timestampMs: Date.now(),
  },
  {
    id: 'fallback-launch-dfrog',
    type: 'launch',
    tokenName: 'Diamond Frog',
    ticker: 'DFROG',
    amountLabel: 'new token',
    userLabel: 'UQB4cr...00004',
    timeLabel: '2m ago',
    accentHue: 228,
    timestampMs: Date.now() - 120_000,
  },
  {
    id: 'fallback-sell-rocat',
    type: 'sell',
    tokenName: 'Rocket Cat',
    ticker: 'ROCAT',
    amountLabel: '0.8 TON',
    userLabel: 'UQB2cr...00002',
    timeLabel: '4m ago',
    accentHue: 254,
    timestampMs: Date.now() - 240_000,
  },
  {
    id: 'fallback-buy-bpepe',
    type: 'buy',
    tokenName: 'Blue Pepe',
    ticker: 'BPEPE',
    amountLabel: '1.7 TON',
    userLabel: 'UQB3cr...00003',
    timeLabel: '6m ago',
    accentHue: 188,
    timestampMs: Date.now() - 360_000,
  },
];

function shortWallet(address: string) {
  return address.length < 12 ? address : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function shortAddress(address: string) {
  return address.length < 16 ? address : `${address.slice(0, 6)}...${address.slice(-5)}`;
}

function parseNano(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0n;

  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function nanoToTon(value: bigint) {
  return Number(value) / NANOS_PER_TON;
}

function resolveTokenImageUrl(imageUrl: string | null) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('ipfs://')) {
    return `https://gateway.pinata.cloud/ipfs/${imageUrl.slice('ipfs://'.length)}`;
  }

  return imageUrl;
}

function tokenAccentHue(token: Pick<TopMeme, 'name' | 'ticker'>) {
  const seed = `${token.name}${token.ticker}`.split('').reduce((total, char) => {
    return total + char.charCodeAt(0);
  }, 0);

  return 180 + (seed % 90);
}

function getRankBadgeSrc(rank: number) {
  if (rank === 1) return '/meme-rank-one-badge.svg';
  if (rank === 2) return '/meme-rank-two-badge.svg';
  if (rank === 3) return '/meme-rank-three-badge.svg';
  return null;
}

function handleSideCardPointerMove(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;

  event.currentTarget.style.setProperty('--tilt-x', `${(-y * 9).toFixed(2)}deg`);
  event.currentTarget.style.setProperty('--tilt-y', `${(x * 9).toFixed(2)}deg`);
}

function handleSideCardPointerLeave(event: PointerEvent<HTMLElement>) {
  event.currentTarget.style.setProperty('--tilt-x', '0deg');
  event.currentTarget.style.setProperty('--tilt-y', '0deg');
}

function compactNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    notation: value >= 10_000 ? 'compact' : 'standard',
    ...options,
  }).format(value);
}

function formatUsd(value: number | undefined, fallback = '--') {
  if (value === undefined || !Number.isFinite(value)) return fallback;

  return `$${compactNumber(value, {
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: value < 10 ? 3 : 2,
  })}`;
}

function formatTonVolume(value: string | undefined) {
  if (!value) return '--';
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '--';

  return `${compactNumber(numericValue, {
    maximumFractionDigits: numericValue < 10 ? 2 : 1,
  })} TON`;
}

function formatNanoTonAmount(value: string | number | null | undefined) {
  const tonValue = nanoToTon(parseNano(value));

  if (!Number.isFinite(tonValue) || tonValue <= 0) return '0 TON';
  return `${compactNumber(tonValue, {
    maximumFractionDigits: tonValue < 10 ? 2 : 1,
  })} TON`;
}

function formatTimeAgo(value: string | null | undefined) {
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

function formatMemeMarketCap(marketCapTon: number, tonUsdPrice: number | undefined) {
  if (!Number.isFinite(marketCapTon)) return '--';
  if (!tonUsdPrice) return `${compactNumber(marketCapTon)} TON`;

  return formatUsd(marketCapTon * tonUsdPrice);
}

function formatMemePrice(priceTon: number, tonUsdPrice: number | undefined) {
  if (!Number.isFinite(priceTon)) return '--';
  if (!tonUsdPrice) {
    return `${compactNumber(priceTon, { maximumFractionDigits: 8 })} TON`;
  }

  const usdPrice = priceTon * tonUsdPrice;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: usdPrice < 0.01 ? 6 : 2,
    maximumFractionDigits: usdPrice < 0.01 ? 8 : 4,
  }).format(usdPrice);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function buildRecentActivity(tokens: TokenRow[], trades: RecentTradeRow[]) {
  if (tokens.length === 0 && trades.length === 0) return [];
  const tokenMap = new Map<string, TokenRow>();
  for (const token of tokens) {
    tokenMap.set(token.address, token);
  }

  const tradeItems = trades
    .filter((trade) => trade.type === 'buy' || trade.type === 'sell')
    .map((trade, index): RecentActivityItem => {
      const token = trade.token_address ? tokenMap.get(trade.token_address) : undefined;
      const tokenName = token?.name?.trim() || 'Unknown meme';
      const ticker = (token?.symbol?.trim() || 'UNK').toUpperCase();
      const timestampMs = trade.timestamp ? new Date(trade.timestamp).getTime() : Date.now() - index;

      return {
        id: `trade-${trade.timestamp || index}-${trade.token_address || ticker}`,
        type: trade.type === 'sell' ? 'sell' : 'buy',
        tokenName,
        ticker,
        amountLabel: formatNanoTonAmount(trade.ton_amount),
        userLabel: shortAddress(trade.user_address || ''),
        timeLabel: formatTimeAgo(trade.timestamp),
        accentHue: tokenAccentHue({ name: tokenName, ticker }),
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now() - index,
      };
    });

  const launchItems = tokens.slice(0, 12).map((token, index): RecentActivityItem => {
    const tokenName = token.name?.trim() || 'Unknown meme';
    const ticker = (token.symbol?.trim() || 'UNK').toUpperCase();
    const timestampMs = token.created_at ? new Date(token.created_at).getTime() : Date.now() - index;

    return {
      id: `launch-${token.address}`,
      type: 'launch',
      tokenName,
      ticker,
      amountLabel: 'new token',
      userLabel: shortAddress(token.creator_address || token.address),
      timeLabel: formatTimeAgo(token.created_at),
      accentHue: tokenAccentHue({ name: tokenName, ticker }),
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now() - index,
    };
  });

  const activity = [...tradeItems, ...launchItems]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, 18);

  return activity;
}

function buildTopMemes(tokens: TokenRow[], trades: MemeTradeRow[]) {
  if (tokens.length === 0) return [];

  const tradeStats = new Map<string, { volumeNano: bigint; holders: Set<string> }>();

  for (const trade of trades) {
    if (!trade.token_address) continue;

    const current = tradeStats.get(trade.token_address) ?? {
      volumeNano: 0n,
      holders: new Set<string>(),
    };

    current.volumeNano += parseNano(trade.ton_amount);
    if (trade.user_address) current.holders.add(trade.user_address);
    tradeStats.set(trade.token_address, current);
  }

  const rankedMemes = tokens
    .map((token) => {
      const virtualTonReserves = parseNano(token.virtual_ton_reserves);
      const virtualTokenReserves = parseNano(token.virtual_token_reserves);
      const marketCapNano = virtualTonReserves > 0n && virtualTokenReserves > 0n
        ? getMarketCap(virtualTonReserves, virtualTokenReserves)
        : 0n;
      const priceNano = virtualTonReserves > 0n && virtualTokenReserves > 0n
        ? getPriceInNanotons(virtualTonReserves, virtualTokenReserves)
        : 0n;
      const realTonReserves = parseNano(token.real_ton_reserves);
      const stats = tradeStats.get(token.address);
      const name = token.name?.trim() || 'Unknown meme';
      const ticker = (token.symbol?.trim() || 'UNK').toUpperCase();

      return {
        rank: 0,
        name,
        ticker,
        address: token.address,
        creatorAddress: token.creator_address || token.address,
        imageUrl: resolveTokenImageUrl(token.image_url),
        marketCapTon: nanoToTon(marketCapNano),
        priceTon: nanoToTon(priceNano),
        holders: stats?.holders.size ?? 0,
        volumeTon: nanoToTon(stats?.volumeNano ?? realTonReserves),
        progressPercent: clampPercent(Number(realTonReserves * 10000n / MIGRATION_THRESHOLD) / 100),
        accentHue: tokenAccentHue({ name, ticker }),
      };
    })
    .sort((a, b) => {
      const volumeDifference = b.volumeTon - a.volumeTon;
      if (volumeDifference !== 0) return volumeDifference;
      return b.marketCapTon - a.marketCapTon;
    })
    .slice(0, 7)
    .map((meme, index) => ({
      ...meme,
      rank: index + 1,
      imageUrl: meme.imageUrl ?? fallbackMemeImageUrl(index + 1),
    }));

  return rankedMemes;
}

function StatNumberTicker({
  value,
  prefix = '',
  decimalPlaces = 0,
  accessibilityLabel,
}: {
  value: number;
  prefix?: string;
  decimalPlaces?: number;
  accessibilityLabel: string;
}) {
  return (
    <span className="card-stat-value" aria-label={accessibilityLabel}>
      {prefix}
      <NumberTicker
        className="card-stat-number"
        decimalPlaces={decimalPlaces}
        value={value}
      />
    </span>
  );
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

function MemeCard({
  meme,
  showBadge,
  tonUsdPrice,
}: {
  meme: TopMeme;
  showBadge: boolean;
  tonUsdPrice: number | undefined;
}) {
  const router = useRouter();
  const badgeSrc = showBadge ? getRankBadgeSrc(meme.rank) : null;
  const tokenHref = `/tokens/${encodeURIComponent(meme.address)}`;

  function openTokenDetail() {
    router.push(tokenHref);
  }

  return (
    <article
      className="dashboard-float-card top-meme-card meme-card-link"
      key={`${meme.rank}-${meme.address}`}
      aria-label={`Rank ${meme.rank} meme token ${meme.name}`}
      role="link"
      tabIndex={0}
      onClick={openTokenDetail}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTokenDetail();
        }
      }}
      style={{ '--meme-hue': meme.accentHue } as CSSProperties}
    >
      {badgeSrc && (
        <img
          alt=""
          aria-hidden="true"
          className="meme-rank-badge"
          src={badgeSrc}
        />
      )}
      <div className="meme-image-panel">
        {meme.imageUrl ? (
          <img
            alt=""
            className="meme-token-image"
            src={meme.imageUrl}
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div className="meme-image-fallback" aria-hidden="true">
            <span>${meme.ticker}</span>
          </div>
        )}
      </div>
      <div className="meme-card-body">
        <div className="meme-stat-inset">
          <div className="meme-card-topline">
            <div className="meme-title-stack">
              <h3>{meme.name} <span>${meme.ticker}</span></h3>
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
            <code>{shortAddress(meme.creatorAddress)}</code>
          </div>
          <div className="meme-stat-row">
            <div>
              <span>Market cap</span>
              <MemeMetricNumber
                accessibilityLabel={`Market cap ${formatMemeMarketCap(meme.marketCapTon, tonUsdPrice)}`}
                format={
                  tonUsdPrice
                    ? {
                        style: 'currency',
                        currency: 'USD',
                        notation: 'compact',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 1,
                      }
                    : {
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }
                }
                suffix={tonUsdPrice ? undefined : ' TON'}
                value={tonUsdPrice ? meme.marketCapTon * tonUsdPrice : meme.marketCapTon}
              />
            </div>
            <div>
              <span>Holders</span>
              <MemeMetricNumber
                accessibilityLabel={`${compactNumber(meme.holders)} holders`}
                format={{ notation: 'compact', maximumFractionDigits: 1 }}
                value={meme.holders}
              />
            </div>
          </div>
          <div
            className="meme-progress-row"
            style={{ '--meme-progress': `${meme.progressPercent}%` } as CSSProperties}
          >
            <span className="meme-progress-track" aria-hidden="true">
              <span />
            </span>
            <MemeMetricNumber
              accessibilityLabel={`${meme.progressPercent.toFixed(2)} percent bonded`}
              className="meme-progress-value"
              format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              suffix="%"
              value={meme.progressPercent}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function RecentActivityTicker({ items }: { items: RecentActivityItem[] }) {
  const tickerItems = items;
  const loopItems = [...tickerItems, ...tickerItems, ...tickerItems];

  return (
    <div className="recent-activity-shelf" aria-label="Recent launchpad activity">
      <div className="dashboard-shelf-ridge recent-activity-ridge" aria-hidden="true" />
      <div className="recent-activity-marquee" aria-hidden="true">
        <div className="recent-activity-track">
          {loopItems.map((item, index) => (
            <div
              className={`recent-activity-chip recent-activity-chip-${item.type}`}
              key={`${item.id}-${index}`}
              style={{ '--activity-hue': item.accentHue } as CSSProperties}
            >
              <span className="recent-activity-type">
                {item.type === 'launch' ? 'New' : item.type}
              </span>
              <span className="recent-activity-token">${item.ticker}</span>
              <span className="recent-activity-copy">
                {item.type === 'launch' ? 'created' : item.amountLabel}
              </span>
              <span className="recent-activity-user">{item.userLabel}</span>
              <span className="recent-activity-time">{item.timeLabel}</span>
            </div>
          ))}
        </div>
      </div>
      <span className="recent-activity-screen-reader">
        {tickerItems.map((item) => `${item.type} ${item.ticker} ${item.amountLabel} ${item.timeLabel}`).join(', ')}
      </span>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [stats, setStats] = useState<LaunchpadStats | null>(null);
  const [topMemes, setTopMemes] = useState<TopMeme[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
  const [activeFeatureSlide, setActiveFeatureSlide] = useState(0);
  const { colorScheme, toggleColorScheme } = useThemeMode();
  const primaryMemes = topMemes.slice(0, 3);
  const lowerMemes = topMemes.slice(3, 7);

  async function handleWalletClick() {
    try {
      if (wallet) {
        await tonConnectUI.disconnect();
      } else {
        tonConnectUI.openModal();
      }
    } catch (error) {
      console.error('TonConnect wallet action failed:', error);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      try {
        const response = await fetch('/api/stats', { cache: 'no-store' });
        if (!response.ok) throw new Error('Stats request failed');
        const nextStats = await response.json() as LaunchpadStats;

        if (!cancelled) setStats(nextStats);
      } catch {
        if (!cancelled) setStats(null);
      }
    }

    async function loadTopMemes() {
      try {
        const [{ data: tokens, error: tokenError }, { data: trades, error: tradeError }] = await Promise.all([
          supabase
            .from('tokens')
            .select('address, creator_address, name, symbol, image_url, virtual_ton_reserves, virtual_token_reserves, real_ton_reserves, created_at')
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('trades')
            .select('token_address, ton_amount, token_amount, user_address, type, timestamp')
            .order('timestamp', { ascending: false })
            .limit(5000),
        ]);

        if (tokenError || tradeError) throw new Error(tokenError?.message || tradeError?.message);
        if (!cancelled) {
          const tokenRows = (tokens || []) as TokenRow[];
          const tradeRows = (trades || []) as RecentTradeRow[];
          setTopMemes(buildTopMemes(tokenRows, tradeRows));
          setRecentActivity(buildRecentActivity(tokenRows, tradeRows.slice(0, 40)));
        }
      } catch {
        if (!cancelled) {
          setTopMemes(FALLBACK_TOP_MEMES);
          setRecentActivity(FALLBACK_RECENT_ACTIVITY);
        }
      }
    }

    void loadStats();
    void loadTopMemes();

    const interval = window.setInterval(() => {
      void loadStats();
      void loadTopMemes();
    }, 30_000);
    const tokenChannel = supabase
      .channel('launchpad-stats-tokens')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens' }, () => {
        void loadStats();
        void loadTopMemes();
      })
      .subscribe();
    const tradeChannel = supabase
      .channel('launchpad-stats-trades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
        void loadStats();
        void loadTopMemes();
      })
      .subscribe();
    const candleChannel = supabase
      .channel('launchpad-stats-candles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'token_candles' }, () => {
        void loadTopMemes();
      })
      .subscribe();
    const unsubscribeLiveEvents = subscribeLaunchpadEvents((event) => {
      if (event.type === 'token.created' || event.type === 'token.updated' || event.type === 'trade.created' || event.type === 'candle.updated') {
        void loadStats();
        void loadTopMemes();
      }
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(tokenChannel);
      supabase.removeChannel(tradeChannel);
      supabase.removeChannel(candleChannel);
      unsubscribeLiveEvents();
    };
  }, []);

  function showNextFeatureSlide() {
    setActiveFeatureSlide((slide) => (slide + 1) % 2);
  }

  function handleFeatureCardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showNextFeatureSlide();
    }
  }

  return (
    <main className="dashboard-shell">
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
            <kbd>⌘ K</kbd>
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
            onClick={() => void handleWalletClick()}
          >
            <span>{wallet ? shortWallet(wallet.account.address) : 'Connect'}</span>
          </button>
        </div>
      </div>
      <section className="dashboard-canvas" aria-label="Dashboard canvas">
        <div className="canvas-inset-card">
          <InteractiveDots
            backgroundColor={colorScheme === 'dark' ? '#15171c' : '#f1f3f5'}
            dotColor="#5498e6"
            gridSpacing={26}
            animationSpeed={0.01}
          />
          <div className="card-launch-copy">
            <p>
              <span className="card-copy-muted">The </span>
              <WordRotate
                className="card-rotating-word"
                words={['fastest', 'easiest', 'best']}
              />
              <span className="card-copy-muted"> way to launch a meme on </span>
              <span className="card-ton-highlight">TON</span>
            </p>
          </div>
          <div className="card-stats-panel" aria-label="Launchpad stats">
            <div className="card-stat">
              <span className="card-stat-label">TON price</span>
              <StatNumberTicker
                accessibilityLabel={`TON price ${formatUsd(stats?.tonUsdPrice ?? 0)}`}
                decimalPlaces={3}
                prefix="$"
                value={stats?.tonUsdPrice ?? 0}
              />
            </div>
            <div className="card-stat">
              <span className="card-stat-label">Tokens launched</span>
              <StatNumberTicker
                accessibilityLabel={`${stats?.tokensLaunched ?? 0} tokens launched`}
                value={stats?.tokensLaunched ?? 0}
              />
            </div>
            <div className="card-stat">
              <span className="card-stat-label">Total volume</span>
              <StatNumberTicker
                accessibilityLabel={`Total volume ${formatUsd(stats?.totalVolumeUsd ?? 0)}`}
                decimalPlaces={2}
                prefix="$"
                value={stats?.totalVolumeUsd ?? 0}
              />
              <span className="card-stat-subvalue">
                {formatTonVolume(stats?.buyVolumeTon ?? '0')} buy / {formatTonVolume(stats?.sellVolumeTon ?? '0')} sell
              </span>
            </div>
          </div>
          <button
            type="button"
            className="card-launch-button"
            onClick={() => router.push('/create')}
          >
            <span>Launch token</span>
          </button>
        </div>
        <div
          className="canvas-side-card"
          aria-label="TON launch artwork"
          onPointerLeave={handleSideCardPointerLeave}
          onPointerMove={handleSideCardPointerMove}
        >
          <HexagonPattern
            className="side-card-hexagons"
            hexagons={[
              [1, 1],
              [4, 4],
              [2, 2],
              [3, 4],
              [5, 4],
              [8, 2],
              [6, 3],
              [8, 5],
              [10, 10],
            ]}
            radius={38}
            gap={4}
          />
          <img
            alt=""
            aria-hidden="true"
            className="side-card-art"
            src="/ton-top-card-art.png"
          />
          <div className="side-card-noise" aria-hidden="true" />
          <div className="side-card-blur-vignette blur-vignette" aria-hidden="true" />
        </div>
        <div className="dashboard-module-shelf" aria-label="Launchpad dashboard modules">
          <div className="dashboard-shelf-ridge" aria-hidden="true" />
          <article
            className="dashboard-float-card dashboard-float-card-primary"
            aria-label="Switch featured launchpad card"
            role="button"
            tabIndex={0}
            onClick={showNextFeatureSlide}
            onKeyDown={handleFeatureCardKeyDown}
            onPointerLeave={handleSideCardPointerLeave}
            onPointerMove={handleSideCardPointerMove}
          >
            <HexagonPattern
              className="side-card-hexagons float-card-hexagons"
              hexagons={[
                [1, 1],
                [4, 4],
                [2, 2],
                [3, 4],
                [5, 4],
                [8, 2],
                [6, 3],
                [8, 5],
                [10, 10],
              ]}
              radius={26}
              gap={3}
            />
            <div className="empty-card-carousel-viewport" aria-hidden="true">
              <div
                className="empty-card-carousel-track"
                style={{ transform: `translate3d(-${activeFeatureSlide * 50}%, 0, 0)` }}
              >
                <div className="empty-card-slide empty-card-slide-launch">
                  <HexagonPattern
                    className="side-card-hexagons float-card-hexagons carousel-slide-hexagons"
                    hexagons={[
                      [1, 1],
                      [4, 4],
                      [2, 2],
                      [3, 4],
                      [5, 4],
                      [8, 2],
                      [6, 3],
                      [8, 5],
                      [10, 10],
                    ]}
                    radius={26}
                    gap={3}
                  />
                  <img
                    alt=""
                    className="side-card-art empty-card-art"
                    src="/ton-launch-carousel-slide.png"
                  />
                </div>
                <div className="empty-card-slide empty-card-slide-trade">
                  <HexagonPattern
                    className="side-card-hexagons float-card-hexagons carousel-slide-hexagons"
                    hexagons={[
                      [1, 1],
                      [4, 4],
                      [2, 2],
                      [3, 4],
                      [5, 4],
                      [8, 2],
                      [6, 3],
                      [8, 5],
                      [10, 10],
                    ]}
                    radius={26}
                    gap={3}
                  />
                  <img
                    alt=""
                    className="side-card-art empty-card-art"
                    src="/ton-trade-carousel-slide.png"
                  />
                </div>
              </div>
            </div>
            <div className="side-card-noise empty-card-noise" aria-hidden="true" />
            <div className="side-card-blur-vignette empty-card-blur-vignette blur-vignette" aria-hidden="true" />
          </article>
          {primaryMemes.map((meme) => (
            <MemeCard
              key={`${meme.rank}-${meme.address}`}
              meme={meme}
              showBadge
              tonUsdPrice={stats?.tonUsdPrice}
            />
          ))}
        </div>
        <div className="dashboard-lower-meme-shelf" aria-label="More top meme tokens">
          <div className="dashboard-shelf-ridge" aria-hidden="true" />
          {lowerMemes.map((meme) => (
            <MemeCard
              key={`${meme.rank}-${meme.address}`}
              meme={meme}
              showBadge={false}
              tonUsdPrice={stats?.tonUsdPrice}
            />
          ))}
        </div>
        <RecentActivityTicker items={recentActivity} />
      </section>
    </main>
  );
}
