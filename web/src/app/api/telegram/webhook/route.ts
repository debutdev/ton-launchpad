import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type TelegramChat = {
  id: number | string;
};

type TelegramMessage = {
  chat?: TelegramChat;
  text?: string;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

const COMMANDS = [
  { command: 'start', description: 'Open Tonked launchpad' },
  { command: 'launchpad', description: 'Open the Mini App' },
  { command: 'create', description: 'Launch a token' },
  { command: 'tokens', description: 'Browse live tokens' },
  { command: 'portfolio', description: 'View your portfolio' },
  { command: 'help', description: 'Show commands' },
] as const;

function clean(value: string | undefined) {
  return (value || '').replace(/[\r\n\t]/g, '').trim();
}

function appBaseUrl() {
  return clean(process.env.NEXT_PUBLIC_APP_URL) || 'https://web-eight-pi-llv0a90mz9.vercel.app';
}

function appUrl(pathname = '/') {
  const url = new URL(pathname, appBaseUrl());
  return url.toString();
}

function tokenRouteFromStartArg(arg: string) {
  const decoded = decodeURIComponent(arg || '').trim();
  if (!decoded) return '/';
  if (decoded === 'create' || decoded === 'launch') return '/create';
  if (decoded === 'tokens') return '/tokens';
  if (decoded === 'portfolio') return '/portfolio';
  if (decoded.startsWith('token_')) return `/tokens/${encodeURIComponent(decoded.slice(6))}`;
  if (decoded.startsWith('token-')) return `/tokens/${encodeURIComponent(decoded.slice(6))}`;
  if (/^(EQ|UQ|kQ)[A-Za-z0-9_-]{20,}$/.test(decoded)) return `/tokens/${encodeURIComponent(decoded)}`;
  return '/';
}

function parseCommand(text: string) {
  const [rawCommand = '', ...rest] = text.trim().split(/\s+/);
  if (!rawCommand.startsWith('/')) return { command: '', arg: '' };
  return {
    command: rawCommand.slice(1).split('@')[0].toLowerCase(),
    arg: rest.join(' '),
  };
}

async function telegram(method: string, body: Record<string, unknown>) {
  const token = clean(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN);
  if (!token) throw new Error('Telegram bot token is not configured');

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed with ${response.status}`);
  }

  const result = await response.json() as { ok?: boolean; description?: string };
  if (!result.ok) throw new Error(result.description || `Telegram ${method} failed`);
}

function webAppKeyboard(buttons: Array<{ text: string; path: string }>) {
  return {
    inline_keyboard: buttons.map((button) => [
      {
        text: button.text,
        web_app: { url: appUrl(button.path) },
      },
    ]),
  };
}

async function sendCommandReply(chatId: number | string, command: string, arg: string) {
  if (command === 'create') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: 'Launch a token on Tonked.',
      reply_markup: webAppKeyboard([{ text: 'Create token', path: '/create' }]),
    });
    return;
  }

  if (command === 'tokens') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: 'Browse live Tonked tokens.',
      reply_markup: webAppKeyboard([{ text: 'View tokens', path: '/tokens' }]),
    });
    return;
  }

  if (command === 'portfolio') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: 'Open your Tonked portfolio.',
      reply_markup: webAppKeyboard([{ text: 'View portfolio', path: '/portfolio' }]),
    });
    return;
  }

  if (command === 'help') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: [
        'Tonked commands:',
        '/launchpad - open the app',
        '/create - launch a token',
        '/tokens - browse live tokens',
        '/portfolio - view your portfolio',
      ].join('\n'),
      reply_markup: webAppKeyboard([
        { text: 'Open Launchpad', path: '/' },
        { text: 'Create token', path: '/create' },
        { text: 'Browse tokens', path: '/tokens' },
        { text: 'Portfolio', path: '/portfolio' },
      ]),
    });
    return;
  }

  const startPath = command === 'start' ? tokenRouteFromStartArg(arg) : '/';
  await telegram('sendMessage', {
    chat_id: chatId,
    text: 'Open Tonked to create, buy, sell, and track TON launchpad tokens.',
    reply_markup: webAppKeyboard([{ text: 'Open Tonked', path: startPath }]),
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    commands: COMMANDS,
    appUrl: appBaseUrl(),
  });
}

export async function POST(request: NextRequest) {
  const expectedSecret = clean(process.env.TELEGRAM_WEBHOOK_SECRET);
  const actualSecret = clean(request.headers.get('x-telegram-bot-api-secret-token') || undefined);
  if (expectedSecret && actualSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const update = await request.json() as TelegramUpdate;
  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;
  const text = message?.text || '';

  if (!chatId || !text.startsWith('/')) {
    return NextResponse.json({ ok: true });
  }

  const { command, arg } = parseCommand(text);
  await sendCommandReply(chatId, command, arg);
  return NextResponse.json({ ok: true });
}
