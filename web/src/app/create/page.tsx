'use client';

import { useEffect, useState } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import {
  Bell,
  Link,
  Moon,
  Send,
  Sun,
  UploadCloud,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DitheredSwirl } from '../DitheredSwirl';
import { TopbarNav } from '../TopbarNav';
import { TopbarSearch } from '../TopbarSearch';
import { useThemeMode } from '../providers';
import { DEFAULT_DEPLOY_VALUE, TONCONNECT_CHAIN, deployTokenBody } from '@/lib/launchpad';
import { supabase } from '@/lib/supabase';
import { TON_NETWORK_LABEL } from '@/lib/tonNetwork';
import { formatUserError } from '@/lib/userErrors';

function shortWallet(address: string) {
  return address.length < 12 ? address : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function normalizeTicker(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
}

async function loadLaunchpadConfig(): Promise<{ factoryAddress: string }> {
  const response = await fetch(`/api/launchpad-config?ts=${Date.now()}`, {
    cache: 'no-store',
  });
  const data = await response.json() as { factoryAddress?: string; error?: string };
  if (!response.ok || !data.factoryAddress) {
    throw new Error(data.error || 'Factory address is not configured for this deployment.');
  }
  return { factoryAddress: data.factoryAddress };
}

async function findIndexedToken(
  metadataUrl: string,
  creatorAddress: string,
  earliestTimestampMs: number,
): Promise<string | null> {
  const { data: metadataMatch, error: metadataError } = await supabase
    .from('tokens')
    .select('address, creator_address, metadata_url, created_at')
    .eq('metadata_url', metadataUrl)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!metadataError && typeof metadataMatch?.address === 'string') return metadataMatch.address;

  const { data: recentTokens, error: creatorError } = await supabase
    .from('tokens')
    .select('address, creator_address, metadata_url, created_at')
    .eq('creator_address', creatorAddress)
    .order('created_at', { ascending: false })
    .limit(5);

  if (creatorError) return null;

  const match = (recentTokens || []).find((token) => {
    if (typeof token.address !== 'string') return false;
    if (token.metadata_url === metadataUrl) return true;
    const createdAtMs = token.created_at ? new Date(token.created_at).getTime() : NaN;
    return Number.isFinite(createdAtMs) && createdAtMs >= earliestTimestampMs - 120_000;
  });

  return typeof match?.address === 'string' ? match.address : null;
}

async function syncLaunchIndex(
  metadataUrl: string,
  creatorAddress: string,
  earliestTimestampMs: number,
): Promise<string | null> {
  const response = await fetch('/api/indexer/sync-launch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      metadataUrl,
      creatorAddress,
      submittedAt: earliestTimestampMs,
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = await response.json().catch(() => null) as { address?: string } | null;
  return typeof data?.address === 'string' ? data.address : null;
}

function waitForIndexedToken(
  metadataUrl: string,
  creatorAddress: string,
  earliestTimestampMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let syncInFlight = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const timers: number[] = [];

    const cleanup = () => {
      settled = true;
      for (const timer of timers) window.clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };

    const resolveOnce = (address: string) => {
      if (settled) return;
      cleanup();
      resolve(address);
    };

    const checkNow = async () => {
      const address = await findIndexedToken(metadataUrl, creatorAddress, earliestTimestampMs);
      if (address) resolveOnce(address);
    };

    const syncNow = async () => {
      if (settled || syncInFlight) return;
      syncInFlight = true;
      const address = await syncLaunchIndex(metadataUrl, creatorAddress, earliestTimestampMs);
      syncInFlight = false;
      if (address) resolveOnce(address);
    };

    channel = supabase
      .channel(`create-token-${creatorAddress}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tokens',
        },
        (payload) => {
          const row = payload.new as { address?: string; metadata_url?: string | null; creator_address?: string | null; created_at?: string | null };
          const createdAtMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
          const matchesMetadata = row.metadata_url === metadataUrl;
          const matchesCreator = row.creator_address === creatorAddress
            && Number.isFinite(createdAtMs)
            && createdAtMs >= earliestTimestampMs - 120_000;
          if (!matchesMetadata && !matchesCreator) return;
          if (row.address) resolveOnce(row.address);
        },
      )
      .subscribe(() => {
        void checkNow();
      });

    timers.push(window.setInterval(() => void checkNow(), 2_500));
    timers.push(window.setInterval(() => void syncNow(), 7_500));
    timers.push(window.setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error('The launch was sent, but the token is still indexing.'));
    }, 45_000));
    void checkNow();
    window.setTimeout(() => void syncNow(), 4_000);
  });
}

export default function CreateToken() {
  const router = useRouter();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const { colorScheme, toggleColorScheme } = useThemeMode();
  const [tokenName, setTokenName] = useState('');
  const [ticker, setTicker] = useState('');
  const [description, setDescription] = useState('');
  const [xLink, setXLink] = useState('');
  const [telegramLink, setTelegramLink] = useState('');
  const [websiteLink, setWebsiteLink] = useState('');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!iconFile) {
      setIconPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(iconFile);
    setIconPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [iconFile]);

  function handleIconSelection(file: File | null) {
    setIconFile(file);
  }

  async function handleCreateToken() {
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }

    const name = tokenName.trim();
    const symbol = normalizeTicker(ticker);
    if (!name || !symbol) {
      setErrorMessage('Token name and symbol are required.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage('Uploading token metadata...');

    try {
      if (wallet.account.chain !== TONCONNECT_CHAIN) {
        throw new Error(`Switch your wallet to ${TON_NETWORK_LABEL} before launching a token.`);
      }

      const uploadForm = new FormData();
      uploadForm.set('name', name);
      uploadForm.set('symbol', symbol);
      uploadForm.set('description', description.trim());
      uploadForm.set('twitter', xLink.trim());
      uploadForm.set('telegram', telegramLink.trim());
      uploadForm.set('website', websiteLink.trim());
      if (iconFile) uploadForm.set('file', iconFile);

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: uploadForm,
      });
      const uploadData = await uploadResponse.json() as { metadataUrl?: string; error?: string };
      if (!uploadResponse.ok || !uploadData.metadataUrl) {
        throw new Error(uploadData.error || 'Metadata upload failed');
      }

      const queryId = BigInt(Date.now());
      const body = deployTokenBody(queryId, uploadData.metadataUrl);
      const { factoryAddress } = await loadLaunchpadConfig();
      const submittedAt = Date.now();

      setStatusMessage('Confirm token launch in your wallet...');
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: TONCONNECT_CHAIN,
        messages: [{
          address: factoryAddress,
          amount: DEFAULT_DEPLOY_VALUE.toString(),
          payload: body.toBoc().toString('base64'),
        }],
      });

      setStatusMessage('Finalizing launch...');
      const matchedAddress = await waitForIndexedToken(
        uploadData.metadataUrl,
        wallet.account.address,
        submittedAt,
      ).catch(() => null);

      router.push(matchedAddress ? `/tokens/${encodeURIComponent(matchedAddress)}` : '/tokens');
    } catch (error) {
      setErrorMessage(formatUserError(error, 'Unable to create token.'));
      setStatusMessage(null);
    } finally {
      setSubmitting(false);
    }
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

      <section
        className="dashboard-canvas launch-page-canvas launch-form-canvas"
        aria-label="Launch token canvas"
      >
        <DitheredSwirl
          className="launch-swirl-bg"
          spread={0.3}
          fg="#5498e6"
          scale={3}
          threshold={0.3}
          speed={0.7}
          pixelSize={2}
          fps={24}
        />
        <div className="launch-form-stage">
          <form
            className="launch-token-form-card"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateToken();
            }}
          >
            <header className="launch-card-header">
              <h1>Launch your Token</h1>
              <p>Fill the details below to launch your own token.</p>
            </header>

            <div className="launch-card-body">
              <label className={`launch-icon-upload-row${iconFile ? ' has-file' : ''}`}>
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Upload token icon"
                  onChange={(event) => handleIconSelection(event.target.files?.[0] ?? null)}
                />
                <span className="launch-token-icon-box" aria-hidden="true">
                  {iconPreviewUrl ? (
                    <img src={iconPreviewUrl} alt="" className="launch-token-icon-preview" />
                  ) : (
                    <UploadCloud size={18} strokeWidth={2.4} />
                  )}
                </span>
                <span className="launch-upload-copy">
                  <strong>{iconFile ? 'Token image selected' : 'Upload token icon'}</strong>
                  <small>{iconFile?.name || 'Add an image to make it easy for users to find your token.'}</small>
                </span>
              </label>

              <div className="launch-two-column-fields">
                <label className="launch-field">
                  <span>Token name</span>
                  <input
                    value={tokenName}
                    onChange={(event) => setTokenName(event.target.value)}
                    placeholder="Enter the name of your token"
                  />
                </label>
                <label className="launch-field">
                  <span>Token symbol</span>
                  <input
                    value={ticker}
                    onChange={(event) => setTicker(normalizeTicker(event.target.value))}
                    placeholder="Enter your token symbol"
                  />
                </label>
              </div>

              <label className="launch-field">
                <span>Description <em>(max 100 characters)</em></span>
                <textarea
                  value={description}
                  maxLength={100}
                  onChange={(event) => setDescription(event.target.value.slice(0, 100))}
                  placeholder="Add a short description of your token"
                  rows={3}
                />
              </label>

              <label className={`launch-banner-upload${iconFile ? ' has-file' : ''}`}>
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Upload token image"
                  onChange={(event) => handleIconSelection(event.target.files?.[0] ?? null)}
                />
                {iconPreviewUrl ? (
                  <div className="launch-banner-preview">
                    <img src={iconPreviewUrl} alt="" />
                    <div>
                      <strong><span>Selected image</span> {iconFile?.name || ''}</strong>
                      <small>Click again to replace it.</small>
                    </div>
                  </div>
                ) : (
                  <>
                    <UploadCloud aria-hidden="true" size={19} strokeWidth={2.35} />
                    <strong><span>Click to upload</span> or drag and drop it here.</strong>
                    <small>Only PNG and JPEG files. Up to 50MB.</small>
                  </>
                )}
              </label>

              <div className="launch-social-section">
                <span>Add social media links <em>(optional)</em></span>
                <div className="launch-social-grid">
                  <label className="launch-social-field">
                    <span aria-hidden="true">X</span>
                    <input
                      value={xLink}
                      onChange={(event) => setXLink(event.target.value)}
                      placeholder="Add your X link"
                    />
                  </label>
                  <label className="launch-social-field">
                    <span aria-hidden="true"><Send size={15} strokeWidth={2.2} /></span>
                    <input
                      value={telegramLink}
                      onChange={(event) => setTelegramLink(event.target.value)}
                      placeholder="Add your Telegram link"
                    />
                  </label>
                  <label className="launch-social-field launch-social-field-wide">
                    <span aria-hidden="true"><Link size={15} strokeWidth={2.2} /></span>
                    <input
                      value={websiteLink}
                      onChange={(event) => setWebsiteLink(event.target.value)}
                      placeholder="Add your website link"
                    />
                  </label>
                </div>
              </div>

              <button type="submit" className="launch-submit-button launch-create-button">
                <span>{!wallet ? 'Connect wallet' : submitting ? 'Creating...' : 'Create token'}</span>
              </button>
              {statusMessage && <p className="launch-status-message">{statusMessage}</p>}
              {errorMessage && <p className="launch-error-message">{errorMessage}</p>}
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
