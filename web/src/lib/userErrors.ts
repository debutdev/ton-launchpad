export function formatUserError(error: unknown, fallback = 'Transaction failed. Please try again.') {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (
    normalized.includes('no enough funds') ||
    normalized.includes('not enough funds') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('insufficient balance')
  ) {
    return 'Not enough funds.';
  }

  if (
    normalized.includes('user reject') ||
    normalized.includes('user declined') ||
    normalized.includes('declined') ||
    normalized.includes('rejected') ||
    normalized.includes('cancelled') ||
    normalized.includes('canceled')
  ) {
    return 'Transaction cancelled.';
  }

  if (normalized.includes('timeout') || normalized.includes('expired')) {
    return 'Transaction timed out.';
  }

  if (normalized.includes('switch your wallet')) {
    return message;
  }

  return fallback;
}
