/**
 * Pay per use services (D-068): what each one costs per use, what we have used and what is left.
 *
 * Providers such as QoreID (identity checks) and the SMS gateway charge per use from a prepaid balance.
 * Staff and the stakeholders read the balance, spend and "how many more can we do" in our own admin
 * (D-067), not in the provider's portal. Until a provider's balance API is connected, the figures come
 * from our own record of calls times the agreed unit price, and the UI says which source it is.
 */
import type { Kobo } from '../types';
import type { IntegrationRecord } from './types';

export interface UnitPrice {
  item: string;
  label: string;
  price: Kobo;
}

export interface ServiceUsage {
  billing: 'prepaid';
  /** Where the numbers come from: the provider's own balance API, our call log, or demo data. */
  source: 'provider_api' | 'our_records' | 'simulated';
  /** False until the provider has confirmed these prices in writing. */
  pricesConfirmed: boolean;
  unitPrices: UnitPrice[];
  /** Total paid in so far (all top ups). */
  toppedUp: Kobo;
  /** Uses so far, by item, with how many happened this month. */
  used: { item: string; total: number; thisMonth: number }[];
  /** Warn when the balance falls below this. */
  lowBalanceAt: Kobo;
  /** Items that make up one "unit of work" in plain words (for example one driver checked fully). */
  bundle?: { label: string; items: string[] };
  asOf: number;
}

export interface UsageSummary {
  spent: Kobo;
  spentThisMonth: Kobo;
  usesThisMonth: number;
  balance: Kobo;
  low: boolean;
  /** How many more of each item the balance pays for. */
  left: { item: string; label: string; count: number }[];
  /** Cost of one bundle and how many bundles the balance pays for (for example drivers that can still be checked). */
  bundleCost?: Kobo;
  bundlesLeft?: number;
}

const priceOf = (u: ServiceUsage, item: string): Kobo => (u.unitPrices.find((p) => p.item === item)?.price ?? 0) as Kobo;

export function usageSummary(u: ServiceUsage): UsageSummary {
  const spent = u.used.reduce((s, x) => s + x.total * priceOf(u, x.item), 0) as Kobo;
  const spentThisMonth = u.used.reduce((s, x) => s + x.thisMonth * priceOf(u, x.item), 0) as Kobo;
  const usesThisMonth = u.used.reduce((s, x) => s + x.thisMonth, 0);
  const balance = Math.max(0, u.toppedUp - spent) as Kobo;
  const left = u.unitPrices.map((p) => ({ item: p.item, label: p.label, count: p.price > 0 ? Math.floor(balance / p.price) : 0 }));
  const out: UsageSummary = { spent, spentThisMonth, usesThisMonth, balance, low: balance < u.lowBalanceAt, left };
  if (u.bundle) {
    const bundleCost = u.bundle.items.reduce((s, i) => s + priceOf(u, i), 0) as Kobo;
    out.bundleCost = bundleCost;
    out.bundlesLeft = bundleCost > 0 ? Math.floor(balance / bundleCost) : 0;
  }
  return out;
}

/** Integrations that charge per use, with their summaries, lowest balance first. */
export function payPerUseServices(list: IntegrationRecord[]): { integration: IntegrationRecord; usage: ServiceUsage; summary: UsageSummary }[] {
  return list
    .filter((i): i is IntegrationRecord & { usage: ServiceUsage } => !!i.usage)
    .map((i) => ({ integration: i, usage: i.usage, summary: usageSummary(i.usage) }))
    .sort((a, b) => Number(b.summary.low) - Number(a.summary.low) || a.summary.balance - b.summary.balance);
}
