import { DRIVER_ACCESS_PACKAGES, type DriverSubscription } from '@gobye/core';

/** "5 days", "13 h 20 min", "42 min" — time left on an access pass. */
export function formatRemaining(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(min / (60 * 24));
  if (days >= 2) return `${days} days`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function passName(sub: DriverSubscription | null): string {
  if (!sub) return 'No access pass';
  return DRIVER_ACCESS_PACKAGES.find((p) => p.id === sub.packageId)?.name ?? 'Access pass';
}

export function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(t: number, now = Date.now()): string {
  const d = new Date(t);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const PAYMENT_LABEL = { wallet: 'GoBye Wallet', bank_transfer: 'Bank transfer', cash: 'Cash' } as const;
