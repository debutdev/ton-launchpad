import type { DbCandleRow, DbTokenRow, DbTradeRow } from './launchpad';

export type LaunchpadLiveEvent =
  | { type: 'token.created'; payload: DbTokenRow; createdAt?: string }
  | { type: 'token.updated'; payload: DbTokenRow; createdAt?: string }
  | { type: 'trade.created'; payload: DbTradeRow; createdAt?: string }
  | { type: 'candle.updated'; payload: DbCandleRow; createdAt?: string };

type LiveEventHandler = (event: LaunchpadLiveEvent) => void;

const EVENT_TYPES: LaunchpadLiveEvent['type'][] = [
  'token.created',
  'token.updated',
  'trade.created',
  'candle.updated',
];

export function subscribeLaunchpadEvents(handler: LiveEventHandler): () => void {
  if (typeof window === 'undefined') return () => {};
  const baseUrl = process.env.NEXT_PUBLIC_LIVE_EVENTS_URL?.trim();
  if (!baseUrl) return () => {};

  const source = new EventSource(`${baseUrl.replace(/\/$/, '')}/events`);

  const listeners = EVENT_TYPES.map((eventType) => {
    const listener = (message: MessageEvent<string>) => {
      try {
        handler(JSON.parse(message.data) as LaunchpadLiveEvent);
      } catch {
        // Ignore malformed events and keep the stream alive.
      }
    };
    source.addEventListener(eventType, listener);
    return { eventType, listener };
  });

  return () => {
    for (const { eventType, listener } of listeners) {
      source.removeEventListener(eventType, listener);
    }
    source.close();
  };
}
