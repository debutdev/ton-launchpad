'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type SearchToken = {
  address: string;
  name: string;
  ticker: string;
  imageUrl: string | null;
  marketCapTon: number;
};

type SearchResponse = {
  items?: SearchToken[];
};

function shortAddress(address: string) {
  return address.length < 12 ? address : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
  }).format(value);
}

export function TopbarSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchToken[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/tokens?q=${encodeURIComponent(trimmed)}&page=1`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json() as SearchResponse;
        setResults((data.items || []).slice(0, 6));
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function goToToken(token: SearchToken) {
    setOpen(false);
    setQuery('');
    router.push(`/tokens/${encodeURIComponent(token.address)}`);
  }

  const showPanel = open && query.trim().length > 0;

  return (
    <div className={`topbar-search-shell ${showPanel ? 'is-open' : ''}`} ref={rootRef}>
      <label className="dashboard-search" aria-label="Search tokens">
        <Search aria-hidden="true" size={13} strokeWidth={2.25} />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) {
              event.preventDefault();
              goToToken(results[0]);
            }
          }}
        />
        <kbd>Ctrl K</kbd>
      </label>

      <div className="topbar-search-results" aria-label="Token search results" role="listbox">
        {loading && <div className="topbar-search-empty">Searching...</div>}
        {!loading && query.trim() && results.length === 0 && (
          <div className="topbar-search-empty">No tokens found</div>
        )}
        {!loading && results.map((token) => (
          <button type="button" key={token.address} onClick={() => goToToken(token)} role="option">
            <span className="topbar-search-thumb">
              {token.imageUrl ? <img src={token.imageUrl} alt="" /> : <span>{token.ticker.slice(0, 2)}</span>}
            </span>
            <span className="topbar-search-copy">
              <strong>{token.name || 'Unknown'}</strong>
              <small>${token.ticker || 'UNK'} · {shortAddress(token.address)}</small>
            </span>
            <em>{compactNumber(token.marketCapTon)} TON</em>
          </button>
        ))}
      </div>
    </div>
  );
}
