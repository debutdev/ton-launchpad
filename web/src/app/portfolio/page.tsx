'use client';

import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { Bell, Moon, Search, Sun } from 'lucide-react';
import { PixelGridShader } from '../PixelGridShader';
import { TopbarNav } from '../TopbarNav';
import { useThemeMode } from '../providers';

function shortWallet(address: string) {
  return address.length < 12 ? address : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function PortfolioPage() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const { colorScheme, toggleColorScheme } = useThemeMode();

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
        <div className="portfolio-coming-soon-card">
          <header className="portfolio-coming-soon-header">
            <span className="portfolio-coming-soon-eyebrow">Portfolio</span>
            <h1>Coming soon</h1>
            <p>Wallet balances, launched tokens, holdings, and claimable rewards will live here.</p>
          </header>
          <div className="portfolio-coming-soon-body">
            <div className="portfolio-coming-soon-row">
              <span>Wallet holdings</span>
              <strong>Pending</strong>
            </div>
            <div className="portfolio-coming-soon-row">
              <span>Launch positions</span>
              <strong>Pending</strong>
            </div>
            <button type="button" className="connect-wallet-button portfolio-coming-soon-button">
              <span>Connect wallet</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
