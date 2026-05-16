'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MediaQueryProvider, ThemeProvider } from '@coinbase/cds-web/system';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { usePathname, useRouter } from 'next/navigation';

type ColorScheme = 'light' | 'dark';

type ThemeContextValue = {
  colorScheme: ColorScheme;
  toggleColorScheme: () => void;
};

type TelegramMiniAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

type TelegramMiniAppContextValue = {
  isTelegramMiniApp: boolean;
  platform: string;
  startParam: string;
  user: TelegramMiniAppUser | null;
  hapticImpact: (style?: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  openTelegramLink: (url: string) => void;
};

type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: TelegramMiniAppUser;
  };
  platform?: string;
  colorScheme?: ColorScheme;
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: { top: number; right: number; bottom: number; left: number };
  contentSafeAreaInset?: { top: number; right: number; bottom: number; left: number };
  themeParams?: Partial<{
    bg_color: string;
    secondary_bg_color: string;
    header_bg_color: string;
    bottom_bar_bg_color: string;
  }>;
  ready: () => void;
  expand: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  };
  openTelegramLink?: (url: string) => void;
  onEvent?: (eventName: string, callback: () => void) => void;
  offEvent?: (eventName: string, callback: () => void) => void;
};

const THEME_STORAGE_KEY = 'tonked-theme';
const ThemeModeContext = createContext<ThemeContextValue | null>(null);
const TelegramMiniAppContext = createContext<TelegramMiniAppContextValue>({
  isTelegramMiniApp: false,
  platform: '',
  startParam: '',
  user: null,
  hapticImpact: () => {},
  openTelegramLink: (url) => {
    if (typeof window !== 'undefined') window.location.href = url;
  },
});

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

export function useTelegramMiniApp() {
  return useContext(TelegramMiniAppContext);
}

function sanitizeEnv(val: string | undefined) {
  return (val || '').replace(/[\r\n\t]/g, '').trim();
}

function telegramReturnUrl(): `${string}://${string}` | undefined {
  const explicit = sanitizeEnv(process.env.NEXT_PUBLIC_TELEGRAM_RETURN_URL || process.env.NEXT_PUBLIC_TELEGRAM_MINI_APP_URL);
  if (explicit.includes('://')) return explicit as `${string}://${string}`;

  const botUsername = sanitizeEnv(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME).replace(/^@/, '');
  const appName = sanitizeEnv(process.env.NEXT_PUBLIC_TELEGRAM_APP_NAME);
  if (botUsername && appName) return `https://t.me/${botUsername}/${appName}` as `${string}://${string}`;
  return undefined;
}

function routeForStartParam(startParam: string) {
  const decoded = decodeURIComponent(startParam || '').trim();
  if (!decoded) return null;
  if (decoded === 'create' || decoded === 'launch') return '/create';
  if (decoded === 'tokens') return '/tokens';
  if (decoded === 'portfolio') return '/portfolio';
  if (decoded.startsWith('token_')) return `/tokens/${encodeURIComponent(decoded.slice(6))}`;
  if (decoded.startsWith('token-')) return `/tokens/${encodeURIComponent(decoded.slice(6))}`;
  if (/^(EQ|UQ|kQ)[A-Za-z0-9_-]{20,}$/.test(decoded)) return `/tokens/${encodeURIComponent(decoded)}`;
  return null;
}

function setPxVariable(name: string, value: number | undefined) {
  document.documentElement.style.setProperty(name, `${Math.max(0, Math.round(value || 0))}px`);
}

function syncTelegramViewport(webApp: TelegramWebApp) {
  const stableHeight = webApp.viewportStableHeight || webApp.viewportHeight || window.innerHeight;
  const safeArea = webApp.safeAreaInset || { top: 0, right: 0, bottom: 0, left: 0 };
  const contentSafeArea = webApp.contentSafeAreaInset || safeArea;
  document.documentElement.style.setProperty('--tg-viewport-height', `${Math.max(1, Math.round(stableHeight))}px`);
  setPxVariable('--tg-safe-area-top', safeArea.top);
  setPxVariable('--tg-safe-area-right', safeArea.right);
  setPxVariable('--tg-safe-area-bottom', safeArea.bottom);
  setPxVariable('--tg-safe-area-left', safeArea.left);
  setPxVariable('--tg-content-safe-area-top', contentSafeArea.top);
  setPxVariable('--tg-content-safe-area-bottom', contentSafeArea.bottom);
}

function syncTelegramChrome(webApp: TelegramWebApp, colorScheme: ColorScheme) {
  const theme = webApp.themeParams || {};
  const background = theme.bg_color || (colorScheme === 'dark' ? '#111319' : '#ffffff');
  const secondary = theme.secondary_bg_color || theme.header_bg_color || background;
  const bottomBar = theme.bottom_bar_bg_color || secondary;
  document.documentElement.style.setProperty('--tg-bg-color', background);
  document.documentElement.style.setProperty('--tg-secondary-bg-color', secondary);
  document.documentElement.style.setProperty('--tg-bottom-bar-color', bottomBar);
  webApp.setHeaderColor?.(secondary);
  webApp.setBackgroundColor?.(background);
  webApp.setBottomBarColor?.(bottomBar);
}

function TelegramMiniAppRuntime({
  colorScheme,
  onColorScheme,
  onState,
}: {
  colorScheme: ColorScheme;
  onColorScheme: (scheme: ColorScheme) => void;
  onState: (value: TelegramMiniAppContextValue) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const webAppRef = useRef<TelegramWebApp | null>(null);
  const startParamHandled = useRef(false);

  useEffect(() => {
    let disposed = false;
    const cleanupCallbacks: Array<() => void> = [];

    async function bootTelegramMiniApp() {
      try {
        const module = await import('@twa-dev/sdk') as unknown as { default: TelegramWebApp };
        const webApp = module.default;
        const isTelegram = Boolean(webApp?.initData || window.location.search.includes('tgWebAppData'));
        if (!isTelegram || disposed) return;

        webAppRef.current = webApp;
        document.documentElement.dataset.telegramMiniApp = 'true';
        document.body.dataset.telegramMiniApp = 'true';
        webApp.ready();
        webApp.expand();
        if (webApp.isVersionAtLeast?.('7.7')) webApp.disableVerticalSwipes?.();

        const applyViewport = () => syncTelegramViewport(webApp);
        const applyTheme = () => {
          const nextScheme = webApp.colorScheme === 'dark' ? 'dark' : 'light';
          onColorScheme(nextScheme);
          syncTelegramChrome(webApp, nextScheme);
        };

        applyViewport();
        applyTheme();

        for (const eventName of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) {
          webApp.onEvent?.(eventName, applyViewport);
          cleanupCallbacks.push(() => webApp.offEvent?.(eventName, applyViewport));
        }
        webApp.onEvent?.('themeChanged', applyTheme);
        cleanupCallbacks.push(() => webApp.offEvent?.('themeChanged', applyTheme));

        onState({
          isTelegramMiniApp: true,
          platform: webApp.platform || '',
          startParam: webApp.initDataUnsafe?.start_param || '',
          user: webApp.initDataUnsafe?.user || null,
          hapticImpact: (style = 'light') => webApp.HapticFeedback?.impactOccurred(style),
          openTelegramLink: (url) => {
            if (webApp.openTelegramLink) webApp.openTelegramLink(url);
            else window.location.assign(url);
          },
        });
      } catch {
        // The normal website path should stay silent if Telegram APIs are unavailable.
      }
    }

    void bootTelegramMiniApp();
    return () => {
      disposed = true;
      cleanupCallbacks.forEach((cleanup) => cleanup());
      webAppRef.current?.enableVerticalSwipes?.();
    };
  }, [onColorScheme, onState]);

  useEffect(() => {
    const webApp = webAppRef.current;
    if (!webApp) return;
    syncTelegramChrome(webApp, colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    const webApp = webAppRef.current;
    if (!webApp?.BackButton) return;
    const handleBack = () => {
      if (pathname === '/') {
        webApp.BackButton?.hide();
        return;
      }
      router.back();
    };
    if (pathname === '/') webApp.BackButton.hide();
    else webApp.BackButton.show();
    webApp.BackButton.onClick(handleBack);
    return () => webApp.BackButton?.offClick(handleBack);
  }, [pathname, router]);

  useEffect(() => {
    const webApp = webAppRef.current;
    if (!webApp || startParamHandled.current || pathname !== '/') return;
    const route = routeForStartParam(webApp.initDataUnsafe?.start_param || '');
    if (!route) return;
    startParamHandled.current = true;
    router.replace(route);
  }, [pathname, router]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const getManifestUrl = () => {
    if (typeof window === 'undefined') {
      const appUrl = sanitizeEnv(process.env.NEXT_PUBLIC_APP_URL);
      return `${appUrl || 'https://web-eight-pi-llv0a90mz9.vercel.app'}/tonconnect-manifest.json`;
    }

    const origin = window.location.origin;
    const envUrl = sanitizeEnv(process.env.NEXT_PUBLIC_APP_URL);
    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
    return `${isLocal ? origin : envUrl || origin}/tonconnect-manifest.json`;
  };

  const manifestUrl = getManifestUrl();
  const tonConnectActions = {
    returnStrategy: 'back' as const,
    ...(telegramReturnUrl() ? { twaReturnUrl: telegramReturnUrl() } : {}),
  };
  const [mounted, setMounted] = useState(false);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(getInitialColorScheme);
  const [telegramState, setTelegramState] = useState<TelegramMiniAppContextValue>({
    isTelegramMiniApp: false,
    platform: '',
    startParam: '',
    user: null,
    hapticImpact: () => {},
    openTelegramLink: (url) => {
      window.location.href = url;
    },
  });

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
          <TelegramMiniAppContext.Provider value={telegramState}>
            {mounted ? (
              <TonConnectUIProvider
                manifestUrl={manifestUrl}
                restoreConnection
                actionsConfiguration={tonConnectActions}
              >
                <TelegramMiniAppRuntime
                  colorScheme={colorScheme}
                  onColorScheme={setColorScheme}
                  onState={setTelegramState}
                />
                {children}
              </TonConnectUIProvider>
            ) : null}
          </TelegramMiniAppContext.Provider>
        </ThemeModeContext.Provider>
      </ThemeProvider>
    </MediaQueryProvider>
  );
}
