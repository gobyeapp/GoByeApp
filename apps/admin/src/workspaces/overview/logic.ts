import type { CityId, LedgerEntry, PlatformDataset } from '@gobye/core';

/**
 * Business overview metrics (owner brief §2). Pure functions over the shared dataset so the numbers can
 * be tested and later computed by the backend with the same definitions.
 *
 * Four money figures are kept apart on purpose:
 *  - trip value: what passengers paid drivers for completed trips (0% commission, not company money),
 *  - company revenue: driver access package purchases (company_revenue ledger account),
 *  - wallet deposits: money held for passengers to spend later (a liability, never revenue),
 *  - driver earnings: trip money credited to drivers' GoBye earnings.
 */

/** Row filter: city may be unknown for ledger lines that can't be tied to a person or trip. */
export type Keep = (city: CityId | undefined, at: number | undefined) => boolean;

const DAY = 86_400_000;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Best effort city for a ledger entry: trip, withdrawal, refund, collection reference, then journal siblings. */
export function ledgerCityResolver(d: PlatformDataset): (e: LedgerEntry) => CityId | undefined {
  const tripCity = new Map(d.trips.map((t) => [t.id, t.city]));
  const pasCity = new Map(d.passengers.map((p) => [p.id, p.city]));
  const drvCity = new Map(d.drivers.map((x) => [x.id, x.city]));
  const wdDriver = new Map(d.withdrawals.map((w) => [w.id, w.driverId]));
  const refPassenger = new Map(d.refunds.map((r) => [r.id, r.passengerId]));
  const colByRef = new Map(d.collections.map((c) => [c.reference, c]));
  const byJournal = new Map<string, LedgerEntry[]>();
  for (const e of d.ledger) byJournal.set(e.journalId, [...(byJournal.get(e.journalId) ?? []), e]);
  const ownerCity = (e: LedgerEntry) =>
    'ownerId' in e.account ? (e.account.kind === 'passenger_wallet' ? pasCity.get(e.account.ownerId) : drvCity.get(e.account.ownerId)) : undefined;
  return (e) => {
    if (e.links?.tripId && tripCity.has(e.links.tripId)) return tripCity.get(e.links.tripId);
    if (e.links?.withdrawalId) {
      const drv = wdDriver.get(e.links.withdrawalId);
      if (drv) return drvCity.get(drv);
    }
    if (e.links?.refundId) {
      const p = refPassenger.get(e.links.refundId);
      if (p) return pasCity.get(p);
    }
    if (e.reference) {
      const c = colByRef.get(e.reference) ?? colByRef.get(e.reference.replace(/-fee$/, ''));
      if (c) return c.payerType === 'passenger' ? pasCity.get(c.payerId) : drvCity.get(c.payerId);
    }
    const own = ownerCity(e);
    if (own) return own;
    for (const s of byJournal.get(e.journalId) ?? []) {
      const c = ownerCity(s);
      if (c) return c;
    }
    return undefined;
  };
}

export interface OverviewMetrics {
  completedTrips: number;
  requestedTrips: number;
  activeDrivers: number;
  activePassengers: number;
  repeatPassengers: number;
  /** Share of active passengers with two or more completed trips in range (0 when none). */
  repeatShare: number;
  tripValue: number;
  companyRevenue: number;
  packagePurchases: number;
  /** Drivers with more than one package purchase in range. */
  packageRenewals: number;
  walletDeposits: number;
  driverEarnings: number;
  /** Completed trips paid straight to the driver's own account: recorded, not credited. */
  directToDriverTrips: number;
  collections: number;
  collectionsCount: number;
  payouts: number;
  refunds: number;
  promotions: number;
  processingCosts: number;
  cancelled: number;
  noDriver: number;
  cancellationRate: number;
  matchingSuccess: number;
  unresolvedCases: number;
  openSafety: number;
  urgentSafety: number;
}

export function overviewMetrics(d: PlatformDataset, keep: Keep, now: number): OverviewMetrics {
  const trips = d.trips.filter((t) => keep(t.city, t.requestedAt));
  const completed = trips.filter((t) => t.status === 'completed');
  const cancelled = trips.filter((t) => t.status === 'cancelled').length;
  const noDriver = trips.filter((t) => t.status === 'no_driver').length;
  const withDriver = trips.filter((t) => !!t.driverId).length;

  const perPassenger = new Map<string, number>();
  for (const t of completed) perPassenger.set(t.passengerId, (perPassenger.get(t.passengerId) ?? 0) + 1);
  const repeatPassengers = [...perPassenger.values()].filter((n) => n >= 2).length;

  const activeDrivers = d.drivers.filter((x) => x.verification === 'approved' && !!x.access && x.access.expiresAt > now && keep(x.city, undefined)).length;

  const cityOf = ledgerCityResolver(d);
  const entries = d.ledger.filter((e) => keep(cityOf(e), e.at));
  const pos = (f: (e: LedgerEntry) => boolean) => sum(entries.filter((e) => f(e) && e.amount > 0).map((e) => e.amount));
  const all = (f: (e: LedgerEntry) => boolean) => sum(entries.filter(f).map((e) => e.amount));

  const pkgCols = d.collections.filter((c) => c.purpose === 'package_purchase' && c.status === 'successful' && keep(d.drivers.find((x) => x.id === c.payerId)?.city, c.createdAt));
  const perDriver = new Map<string, number>();
  for (const c of pkgCols) perDriver.set(c.payerId, (perDriver.get(c.payerId) ?? 0) + 1);

  const payerCity = (c: PlatformDataset['collections'][number]) =>
    c.payerType === 'passenger' ? d.passengers.find((p) => p.id === c.payerId)?.city : d.drivers.find((x) => x.id === c.payerId)?.city;
  const cols = d.collections.filter((c) => c.status === 'successful' && keep(payerCity(c), c.createdAt));

  const careOpen = d.cases.filter((c) => c.team === 'care' && c.status !== 'resolved' && c.status !== 'closed' && keep(c.city, undefined));
  const safetyOpen = d.cases.filter((c) => c.team === 'safety' && c.status !== 'resolved' && c.status !== 'closed' && keep(c.city, undefined));

  return {
    completedTrips: completed.length,
    requestedTrips: trips.length,
    activeDrivers,
    activePassengers: perPassenger.size,
    repeatPassengers,
    repeatShare: perPassenger.size ? repeatPassengers / perPassenger.size : 0,
    tripValue: sum(completed.map((t) => t.agreedFare ?? t.suggestedFare)),
    companyRevenue: all((e) => e.account.kind === 'company_revenue' && e.kind === 'package_purchase'),
    packagePurchases: pkgCols.length,
    packageRenewals: [...perDriver.values()].filter((n) => n > 1).length,
    walletDeposits: all((e) => e.account.kind === 'passenger_wallet' && e.kind === 'wallet_funding'),
    driverEarnings: pos((e) => e.account.kind === 'driver_earnings' && (e.kind === 'trip_charge' || e.kind === 'driver_trip_earning')),
    directToDriverTrips: completed.filter((t) => t.directToDriver).length,
    collections: sum(cols.map((c) => c.amount)),
    collectionsCount: cols.length,
    payouts: -all((e) => e.account.kind === 'driver_withdrawal_reserve' && e.kind === 'withdrawal_payout'),
    refunds: pos((e) => e.kind === 'refund' && e.account.kind === 'passenger_wallet'),
    promotions: Math.abs(all((e) => e.account.kind === 'promotions_expense' && e.kind !== 'refund')),
    processingCosts: Math.abs(all((e) => e.account.kind === 'processing_costs')),
    cancelled,
    noDriver,
    cancellationRate: trips.length ? cancelled / trips.length : 0,
    matchingSuccess: trips.length ? withDriver / trips.length : 0,
    unresolvedCases: careOpen.length,
    openSafety: safetyOpen.length,
    urgentSafety: safetyOpen.filter((c) => c.priority === 'urgent').length,
  };
}

/** Completed trips per day for the last `days` days (oldest first), by completion time. */
export function dailyCompleted(d: PlatformDataset, keep: Keep, now: number, days: number): { day: number; count: number }[] {
  const end = Math.floor(now / DAY) * DAY + DAY;
  const out = Array.from({ length: days }, (_, i) => ({ day: end - (days - i) * DAY, count: 0 }));
  for (const t of d.trips) {
    if (t.status !== 'completed' || !t.completedAt || !keep(t.city, undefined)) continue;
    const idx = days - Math.ceil((end - t.completedAt) / DAY);
    if (idx >= 0 && idx < days) out[idx]!.count += 1;
  }
  return out;
}

export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  path: string;
  tone: 'danger' | 'warning' | 'info';
}

/** "Needs attention" list: current state (not date filtered), only non zero items, most urgent first. */
export function needsAttention(d: PlatformDataset, keep: Keep): AttentionItem[] {
  const inCity = <T extends { city: CityId }>(x: T) => keep(x.city, undefined);
  const drvCity = new Map(d.drivers.map((x) => [x.id, x.city]));
  const items: AttentionItem[] = [
    { key: 'safety', label: 'Urgent safety cases open', count: d.cases.filter((c) => c.team === 'safety' && c.priority === 'urgent' && c.status !== 'resolved' && c.status !== 'closed' && inCity(c)).length, path: '/safety', tone: 'danger' },
    { key: 'approvals', label: 'Approvals waiting for a decision', count: d.approvals.filter((a) => a.status === 'pending').length, path: '/approvals', tone: 'warning' },
    { key: 'cases', label: 'New support cases not picked up', count: d.cases.filter((c) => c.team === 'care' && c.status === 'new' && inCity(c)).length, path: '/cases', tone: 'warning' },
    { key: 'withdrawals', label: 'Withdrawals awaiting review', count: d.withdrawals.filter((w) => (w.status === 'requested' || w.status === 'under_review') && keep(drvCity.get(w.driverId), undefined)).length, path: '/finance/withdrawals', tone: 'warning' },
    { key: 'drivers', label: 'Drivers awaiting review', count: d.drivers.filter((x) => (x.verification === 'applied' || x.verification === 'documents_pending' || x.verification === 'in_review') && inCity(x)).length, path: '/drivers', tone: 'info' },
    { key: 'integrations', label: 'Integrations degraded', count: d.integrations.filter((i) => i.state === 'degraded').length, path: '/developer', tone: 'danger' },
  ];
  return items.filter((i) => i.count > 0);
}

export interface IntegrationAlerts {
  notLive: number;
  total: number;
  degraded: { id: string; label: string }[];
  unresolvedFailures: { id: string; label: string; message: string; at: number }[];
}

export function integrationAlerts(d: PlatformDataset): IntegrationAlerts {
  const name = (i: PlatformDataset['integrations'][number]) => `${i.provider} (${i.area}, ${i.environment})`;
  return {
    notLive: d.integrations.filter((i) => i.state !== 'live').length,
    total: d.integrations.length,
    degraded: d.integrations.filter((i) => i.state === 'degraded').map((i) => ({ id: i.id, label: name(i) })),
    unresolvedFailures: d.integrations.flatMap((i) => i.failures.filter((f) => !f.resolved).map((f) => ({ id: i.id, label: name(i), message: f.message, at: f.at }))),
  };
}
