import type { Metadata, Viewport } from "next";
import "@coinbase/cds-icons/fonts/web/icon-font.css";
import "@coinbase/cds-web/globalStyles";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Instatgram - Memecoin Launchpad on TON",
  description: "Launch and trade memecoins on TON blockchain via Telegram",
  applicationName: "Instatgram",
  appleWebApp: {
    capable: true,
    title: "Instatgram",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

const themeInitializer = `
(() => {
  try {
    const isTelegram = location.search.includes('tgWebAppData') || Boolean(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    if (isTelegram) {
      document.documentElement.dataset.telegramMiniApp = 'true';
    }
    const storedTheme = window.localStorage.getItem('tonked-theme');
    const telegramTheme = isTelegram && window.Telegram && window.Telegram.WebApp
      ? window.Telegram.WebApp.colorScheme
      : null;
    const theme = telegramTheme === 'dark' || telegramTheme === 'light'
      ? telegramTheme
      : storedTheme === 'dark' || storedTheme === 'light'
      ? storedTheme
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
        <link
          rel="preload"
          href="/fonts/SF-Pro-Rounded-Black.otf"
          as="font"
          type="font/otf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/SF-Pro-Rounded-Bold.otf"
          as="font"
          type="font/otf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/SF-Pro-Rounded-Semibold.otf"
          as="font"
          type="font/otf"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
