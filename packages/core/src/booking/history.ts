import { kobo } from '../money';
import type { Kobo, PaymentMethodType, TripReceipt } from '../types';

/**
 * Rider trip history (Activities): period and payment filters, day grouping and a summary.
 * Amounts are what the rider was charged (fare + any processing fee). Failed, reversed and refunded
 * payments didn't cost the rider anything, so they are left out of the spend total.
 */

export type HistoryPeriod = 'week' | 'month' | 'all';
export type HistoryFilter = 'all' | 'attention' | 'wallet' | 'bank_transfer';

const DAY = 86_400_000;

/** Start of the period containing `now`, local time (week starts Monday). */
export function periodStart(period: HistoryPeriod, now: number): number {
  if (period === 'all') return 0;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else d.setDate(1);
  return d.getTime();
}

/** Needs the rider's attention: payment not confirmed yet, failed, or reversed. */
export function needsAttention(r: TripReceipt): boolean {
  return r.paymentStatus === 'pending' || r.paymentStatus === 'processing' || r.paymentStatus === 'failed' || r.paymentStatus === 'reversed';
}

export function matchesFilter(r: TripReceipt, filter: HistoryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'attention':
      return needsAttention(r);
    case 'wallet':
    case 'bank_transfer':
      return r.paymentMethod.type === (filter as PaymentMethodType);
  }
}

/** Newest first, within the period and filter. */
export function filterHistory(history: TripReceipt[], opts: { period: HistoryPeriod; filter: HistoryFilter; now: number }): TripReceipt[] {
  const from = periodStart(opts.period, opts.now);
  return history.filter((r) => r.completedAt >= from && matchesFilter(r, opts.filter)).sort((a, b) => b.completedAt - a.completedAt);
}

export function chargedAmount(r: TripReceipt): Kobo {
  return r.totalPaid || r.fare;
}

export interface HistorySummary {
  trips: number;
  spent: Kobo;
  distanceMeters: number;
  durationSeconds: number;
  /** Average charged per counted trip, rounded to whole naira; 0 when none. */
  average: Kobo;
  attention: number;
}

export function summariseHistory(list: TripReceipt[]): HistorySummary {
  const counted = list.filter((r) => r.paymentStatus !== 'failed' && r.paymentStatus !== 'reversed' && r.paymentStatus !== 'refunded');
  const spent = counted.reduce((s, r) => s + chargedAmount(r), 0);
  return {
    trips: list.length,
    spent: kobo(spent),
    distanceMeters: list.reduce((s, r) => s + r.distanceMeters, 0),
    durationSeconds: list.reduce((s, r) => s + r.durationSeconds, 0),
    average: kobo(counted.length ? Math.round(spent / counted.length / 100) * 100 : 0),
    attention: list.filter(needsAttention).length,
  };
}

/** Section title for a day: Today, Yesterday, or "Mon 20 Oct". */
export function dayLabel(t: number, now: number): string {
  const day = (x: number) => new Date(new Date(x).setHours(0, 0, 0, 0)).getTime();
  const diff = Math.round((day(now) - day(t)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Groups an already sorted list by day, keeping order. */
export function groupByDay(list: TripReceipt[], now: number): { title: string; data: TripReceipt[] }[] {
  const out: { title: string; data: TripReceipt[] }[] = [];
  for (const r of list) {
    const title = dayLabel(r.completedAt, now);
    const last = out[out.length - 1];
    if (last?.title === title) last.data.push(r);
    else out.push({ title, data: [r] });
  }
  return out;
}
