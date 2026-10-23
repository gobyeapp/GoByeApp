import type { CityId, Permission, PlatformDataset, TripRecord } from '@gobye/core';
import { CARE_RESPONSE_TARGET_MIN, isOpen, overResponseTarget } from '@/workspaces/care/logic';
import { REVIEW_STATES } from '@/workspaces/people/logic';
import { ACTIVE_STATUSES, DELAY_THRESHOLD_S, driverAvailability } from '@/workspaces/operations/logic';
import type { TrendValue, Severity } from '@/ui/kit';
import type { IconName } from '@/ui/Icon';

/**
 * Home and "My work" figures (owner brief §13, §23). Pure functions over the shared test dataset so the
 * definitions are tested and the backend can serve the same numbers later. Nothing here invents data:
 * a trend is only returned when there is a complete earlier period of the same length to compare.
 */

const DAY = 86_400_000;
const WAT = 3_600_000;
export const ON_TRIP: readonly TripRecord['status'][] = ['matched', 'en_route', 'arrived', 'in_progress'];

/** City scope for current-state figures (no date range). */
export type InScope = (c: CityId) => boolean;

export interface PlatformActivity {
  activeRides: number;
  activeByStatus: { label: string; n: number }[];
  completed: number;
  completedTrend?: TrendValue;
  availableDrivers: number;
  busyDrivers: number;
  pendingRequests: number;
  oldestPendingMin?: number;
}

/**
 * Trend vs the previous equal period, from real records. `rangeMs` Infinity (all time) has no earlier
 * period. Returns undefined when the earlier period has no data at all (nothing honest to compare).
 */
export function periodTrend(times: readonly number[], now: number, rangeMs: number, vs: string, dataStart?: number): TrendValue | undefined {
  if (!Number.isFinite(rangeMs)) return undefined;
  // The earlier period must be fully covered by records, or the comparison is meaningless.
  if (dataStart !== undefined && dataStart > now - 2 * rangeMs) return undefined;
  const cur = times.filter((t) => t > now - rangeMs && t <= now).length;
  const prev = times.filter((t) => t > now - 2 * rangeMs && t <= now - rangeMs).length;
  if (!prev) return undefined;
  return { delta: (cur - prev) / prev, vs };
}

export function platformActivity(d: PlatformDataset, now: number, inScope: InScope, cityFilter: CityId | 'all', rangeMs: number, rangeLabel: string): PlatformActivity {
  const here = (c: CityId) => inScope(c) && (cityFilter === 'all' || cityFilter === c);
  const trips = d.trips.filter((t) => here(t.city));
  const active = trips.filter((t) => ON_TRIP.includes(t.status));
  const completedTimes = trips.filter((t) => t.status === 'completed' && t.completedAt).map((t) => t.completedAt!);
  const completed = completedTimes.filter((t) => now - t <= rangeMs).length;
  const cities = (['lagos', 'abuja'] as CityId[]).filter(here);
  const avail = driverAvailability(d.drivers, d.trips, now, cities);
  const pending = trips.filter((t) => t.status === 'searching');
  const label: Record<string, string> = { matched: 'Matched', en_route: 'On the way', arrived: 'At pickup', in_progress: 'On trip' };
  return {
    activeRides: active.length,
    activeByStatus: ON_TRIP.map((s) => ({ label: label[s]!, n: active.filter((t) => t.status === s).length })).filter((x) => x.n),
    completed,
    completedTrend: periodTrend(completedTimes, now, rangeMs, `vs previous ${rangeLabel.toLowerCase().replace(/^last /, '')}`, d.trips.length ? Math.min(...d.trips.map((x) => x.requestedAt)) : undefined),
    availableDrivers: avail.reduce((s, a) => s + a.available, 0),
    busyDrivers: avail.reduce((s, a) => s + a.busy, 0),
    pendingRequests: pending.length,
    oldestPendingMin: pending.length ? Math.round((now - Math.min(...pending.map((t) => t.requestedAt))) / 60_000) : undefined,
  };
}

/* ---------- Ride activity series ---------- */

export interface DayPoint {
  /** Start of the Lagos day (ms). */
  day: number;
  requested: number;
  completed: number;
  quickMatch: number;
  negotiated: number;
}

/** Requests and completions per Lagos calendar day, oldest first, ending today. */
export function rideActivity(trips: readonly TripRecord[], now: number, days: number, keep: (t: TripRecord) => boolean): DayPoint[] {
  const end = Math.floor((now + WAT) / DAY) * DAY + DAY - WAT;
  const out: DayPoint[] = Array.from({ length: days }, (_, i) => ({ day: end - (days - i) * DAY, requested: 0, completed: 0, quickMatch: 0, negotiated: 0 }));
  const idx = (at: number) => days - Math.ceil((end - at) / DAY);
  for (const t of trips) {
    if (!keep(t)) continue;
    const r = idx(t.requestedAt);
    if (r >= 0 && r < days) {
      out[r]!.requested += 1;
      if (t.mode === 'negotiate') out[r]!.negotiated += 1;
      else out[r]!.quickMatch += 1;
    }
    if (t.status === 'completed' && t.completedAt) {
      const c = idx(t.completedAt);
      if (c >= 0 && c < days) out[c]!.completed += 1;
    }
  }
  return out;
}

/* ---------- Operational attention ---------- */

export interface HomeAttention {
  key: string;
  title: string;
  count: number;
  severity: Severity;
  context: string;
  path: string;
  action: string;
}

/** The brief's four operational items plus waiting decisions, most severe first; zero counts dropped. */
export function homeAttention(d: PlatformDataset, now: number, inScope: InScope): HomeAttention[] {
  const unmatched = d.trips.filter((t) => inScope(t.city) && t.status === 'searching');
  const longest = unmatched.length ? Math.round((now - Math.min(...unmatched.map((t) => t.requestedAt))) / 60_000) : 0;
  const verify = d.drivers.filter((x) => inScope(x.city) && REVIEW_STATES.includes(x.verification));
  const care = d.cases.filter((c) => inScope(c.city) && c.team === 'care' && isOpen(c.status));
  const careUrgent = care.filter((c) => c.status === 'escalated' || c.priority === 'urgent' || overResponseTarget(c, now));
  const safety = d.cases.filter((c) => inScope(c.city) && c.team === 'safety' && isOpen(c.status));
  const safetyNew = safety.filter((c) => c.status === 'new');
  const approvals = d.approvals.filter((a) => a.status === 'pending');
  const items: HomeAttention[] = [
    { key: 'safety', title: 'Safety incidents needing action', count: safety.length, severity: 'high', context: safetyNew.length ? `${safetyNew.length} not yet acknowledged` : 'All acknowledged, still open', path: '/safety', action: 'Open safety' },
    { key: 'unmatched', title: 'Unmatched ride requests', count: unmatched.length, severity: longest > 5 ? 'high' : 'medium', context: unmatched.length ? `Longest waiting ${longest} min` : '', path: '/live', action: 'Open live operations' },
    { key: 'support', title: 'Urgent support escalations', count: careUrgent.length, severity: 'medium', context: `Escalated, urgent or past target (${CARE_RESPONSE_TARGET_MIN.urgent} min for urgent)`, path: '/cases', action: 'Open support' },
    { key: 'verification', title: 'Drivers pending verification', count: verify.length, severity: 'low', context: `${verify.filter((x) => x.verification === 'documents_pending').length} waiting on documents`, path: '/drivers', action: 'Review drivers' },
    { key: 'approvals', title: 'Decisions waiting for approval', count: approvals.length, severity: 'medium', context: 'Two-person rule: never the requester', path: '/approvals', action: 'Review approvals' },
  ];
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return items.filter((i) => i.count > 0).sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/* ---------- Recent activity ---------- */

export interface ActivityEvent {
  key: string;
  at: number;
  icon: IconName;
  title: string;
  detail: string;
  kind: 'trip' | 'verification' | 'subscription' | 'case' | 'funding';
  /** Permission needed to see it. */
  needs: Permission;
}

/** Newest first. The caller filters by permission (`needs`) and then takes as many as it shows. */
export function recentActivity(d: PlatformDataset, now: number, inScope: InScope): ActivityEvent[] {
  const name = new Map<string, string>([...d.passengers.map((p) => [p.id, p.name] as const), ...d.drivers.map((x) => [x.id, x.name] as const)]);
  const cityOfPayer = new Map<string, CityId>([...d.passengers.map((p) => [p.id, p.city] as const), ...d.drivers.map((x) => [x.id, x.city] as const)]);
  const out: ActivityEvent[] = [];
  for (const t of d.trips)
    if (t.status === 'completed' && t.completedAt && t.completedAt <= now && inScope(t.city))
      out.push({ key: `t-${t.id}`, at: t.completedAt, icon: 'route', title: `Trip ${t.ref} completed`, detail: `${t.pickup} to ${t.destination} · ${t.mode === 'negotiate' ? 'Negotiated' : 'Quick Match'}`, kind: 'trip', needs: 'trips.view' });
  for (const x of d.drivers)
    if (REVIEW_STATES.includes(x.verification) && x.appliedAt <= now && inScope(x.city))
      out.push({ key: `v-${x.id}`, at: x.appliedAt, icon: 'fileCheck', title: 'Driver verification submitted', detail: `${x.name} · ${x.vehicle.make} ${x.vehicle.model}`, kind: 'verification', needs: 'drivers.view' });
  for (const c of d.collections) {
    if (c.status !== 'successful' || !c.verifiedAt || c.verifiedAt > now) continue;
    const city = cityOfPayer.get(c.payerId);
    if (city && !inScope(city)) continue;
    if (c.purpose === 'package_purchase')
      out.push({ key: `s-${c.id}`, at: c.verifiedAt, icon: 'ticket', title: 'Subscription activated', detail: `${name.get(c.payerId) ?? 'Driver'} · ${c.amount >= 6_000_000 ? 'Monthly, 30 days' : 'Daily, 24 hours'}`, kind: 'subscription', needs: 'finance.view' });
    if (c.purpose === 'wallet_funding')
      out.push({ key: `f-${c.id}`, at: c.verifiedAt, icon: 'wallet', title: 'Wallet funding processed', detail: `${name.get(c.payerId) ?? 'Passenger'} · verified with the provider (test)`, kind: 'funding', needs: 'finance.view' });
  }
  for (const c of d.cases)
    if (c.openedAt <= now && inScope(c.city))
      out.push({ key: `c-${c.id}`, at: c.openedAt, icon: c.team === 'safety' ? 'safeAlert' : 'headphone', title: c.team === 'safety' ? 'Safety case opened' : 'Support case opened', detail: `${c.ref} · ${c.subject}`, kind: 'case', needs: c.team === 'safety' ? 'safety.view' : 'cases.view' });
  return out.sort((a, b) => b.at - a.at);
}

/* ---------- My work panels (brief §23) ---------- */

export type PanelKey = 'operations' | 'verification' | 'finance' | 'support' | 'safety' | 'technical';

/** Which focused panels a staff member gets: their responsibility permission, not just read access. */
export function workspacePanels(can: (p: Permission) => boolean): PanelKey[] {
  const out: PanelKey[] = [];
  if (can('live.view')) out.push('operations');
  if (can('drivers.verify')) out.push('verification');
  if (can('cases.work')) out.push('support');
  if (can('safety.view')) out.push('safety');
  if (can('finance.view')) out.push('finance');
  if (can('integrations.view')) out.push('technical');
  return out;
}

export function operationsWork(d: PlatformDataset, inScope: InScope) {
  const trips = d.trips.filter((t) => inScope(t.city));
  return {
    active: trips.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
    unmatched: trips.filter((t) => t.status === 'searching').length,
    delayed: trips.filter((t) => t.status === 'en_route' && (t.pickupDelaySeconds ?? 0) > DELAY_THRESHOLD_S).length,
  };
}

export function verificationWork(d: PlatformDataset, now: number, inScope: InScope) {
  const ds = d.drivers.filter((x) => inScope(x.city));
  return {
    documentsPending: ds.filter((x) => x.verification === 'documents_pending').length,
    inReview: ds.filter((x) => x.verification === 'applied' || x.verification === 'in_review').length,
    expiring: ds.filter((x) => x.verification === 'approved' && x.documents.some((doc) => doc.expiresAt !== undefined && doc.expiresAt < now + 14 * DAY)).length,
    queue: ds.filter((x) => REVIEW_STATES.includes(x.verification)).sort((a, b) => a.appliedAt - b.appliedAt),
  };
}

export function financeWork(d: PlatformDataset) {
  return {
    pendingCollections: d.collections.filter((c) => c.status === 'pending' || c.status === 'initiated').length,
    failedCollections: d.collections.filter((c) => c.status === 'failed').length,
    reconciliationFailures: d.automationRuns.filter((r) => r.automationId === 'payments.reconcile.daily' && (r.status === 'failed' || r.status === 'needs_lookup')).length,
    expenseApprovals: d.expenses.filter((e) => e.status === 'pending_approval').length,
    payoutsWaiting: d.withdrawals.filter((w) => w.status === 'requested' || w.status === 'under_review').length,
    payoutsProcessing: d.withdrawals.filter((w) => w.status === 'processing').length,
  };
}

export function supportWork(d: PlatformDataset, now: number, inScope: InScope, meId: string | undefined) {
  const care = d.cases.filter((c) => inScope(c.city) && c.team === 'care' && isOpen(c.status));
  return {
    mine: care.filter((c) => c.ownerId && c.ownerId === meId).length,
    escalated: care.filter((c) => c.status === 'escalated').length,
    unresolved: care.length,
    overdue: care.filter((c) => overResponseTarget(c, now)).length,
  };
}

export function safetyWork(d: PlatformDataset, inScope: InScope) {
  const s = d.cases.filter((c) => inScope(c.city) && c.team === 'safety' && isOpen(c.status));
  return { open: s.length, unacknowledged: s.filter((c) => c.status === 'new').length, urgent: s.filter((c) => c.priority === 'urgent').length };
}

export function technicalWork(d: PlatformDataset) {
  const runs = d.automationRuns;
  return {
    integrationsLive: d.integrations.filter((i) => i.state === 'live').length,
    integrationsTotal: d.integrations.length,
    degraded: d.integrations.filter((i) => i.state === 'degraded').length,
    openFailures: d.integrations.reduce((s, i) => s + i.failures.filter((f) => !f.resolved).length, 0),
    automationFailures: runs.filter((r) => r.status === 'failed' || r.status === 'needs_lookup').length,
    needsLookup: runs.filter((r) => r.status === 'needs_lookup').length,
  };
}
