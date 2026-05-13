'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { MediaQueryProvider, ThemeProvider } from '@coinbase/cds-web/system';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { TonConnectUIProvider } from '@tonconnect/ui-react';

type ColorScheme = 'light' | 'dark';

type ThemeContextValue = {
  colorScheme: ColorScheme;
  toggleColorScheme: () => void;
};

const THEME_STORAGE_KEY = 'tonked-theme';
const ThemeModeContext = createContext<ThemeContextValue | null>(null);

function getSystemColorScheme(): ColorScheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredColorScheme(): ColorScheme | null {
  if (typeof window === 'undefined') return null;
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : null;
}

function getInitialColorScheme(): ColorScheme {
  if (typeof document !== 'undefined') {
    const currentTheme = document.documentElement.dataset.theme;
    if (currentTheme === 'dark' || currentTheme === 'light') return currentTheme;
  }

  return getStoredColorScheme() ?? getSystemColorScheme();
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within Providers');
  }

  return context;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const sanitize = (val: string | undefined) => (val || '').replace(/[\r\n\t]/g, '').trim();
  const getManifestUrl = () => {
    if (typeof window === 'undefined') {
      const appUrl = sanitize(process.env.NEXT_PUBLIC_APP_URL);
      return `${appUrl || 'https://web-eight-pi-llv0a90mz9.vercel.app'}/tonconnect-manifest.json`;
    }

    const origin = window.location.origin;
    const envUrl = sanitize(process.env.NEXT_PUBLIC_APP_URL);
    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
    return `${isLocal ? origin : envUrl || origin}/tonconnect-manifest.json`;
  };

  const manifestUrl = getManifestUrl();
  const [mounted, setMounted] = useState(false);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(getInitialColorScheme);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    document.documentElement.style.colorScheme = colorScheme;
  }, [colorScheme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (!getStoredColorScheme()) {
        setColorScheme(media.matches ? 'dark' : 'light');
      }
    };

    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, []);

  const themeContextValue = useMemo<ThemeContextValue>(() => ({
    colorScheme,
    toggleColorScheme: () => {
      setColorScheme((currentScheme) => {
        const nextScheme = currentScheme === 'dark' ? 'light' : 'dark';
        window.localStorage.setItem(THEME_STORAGE_KEY, nextScheme);
        return nextScheme;
      });
    },
  }), [colorScheme]);

  return (
    <MediaQueryProvider>
      <ThemeProvider theme={defaultTheme} activeColorScheme={colorScheme}>
        <ThemeModeContext.Provider value={themeContextValue}>
          {mounted ? (
            <TonConnectUIProvider
              manifestUrl={manifestUrl}
              restoreConnection={false}
              actionsConfiguration={{ returnStrategy: 'back' }}
            >
              {children}
            </TonConnectUIProvider>
          ) : null}
        </ThemeModeContext.Provider>
      </ThemeProvider>
    </MediaQueryProvider>
  );
}
