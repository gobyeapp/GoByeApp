import { APPROVAL_RULES, MOCK_SERVICE_CONFIG, versionInForce, type Actor, type ApprovalRequest, type CityId, type ConfigKey, type ConfigVersion, type LedgerEntry, type PlatformDataset } from '@gobye/core';

/**
 * Pure logic for the configuration workspace. Every setting is a series of ConfigVersion records:
 * draft → pending_approval → (approved) → scheduled / in force → superseded. An active version is
 * never edited; a change is always a new version with its own effective date and author.
 *
 * Units: config values hold WHOLE NAIRA (the shared test dataset seeds them that way, e.g. fares
 * `{ base: 500 }` and the audit diff "₦180 → ₦190"). Screens convert with `naira()` before `money()`.
 */

export type Described = { label: string; text: string }[];
export type Diff = { field: string; from: string; to: string }[];
export type DerivedStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'in_force' | 'superseded' | 'rejected';
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const HOUR = 3_600_000;
const LAGOS_OFFSET = HOUR; // West Africa Time, UTC+1, no daylight saving.

/* ---------- Dates (Lagos calendar days) ---------- */

/** "2026-10-21" for the Lagos calendar day containing `ms`. */
export function dayKey(ms: number): string {
  return new Date(ms + LAGOS_OFFSET).toISOString().slice(0, 10);
}

/** Lagos midnight at the start of `key`, or NaN if the key is not a date. */
export function startOfDay(key: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return Number.NaN;
  return Date.parse(`${key}T00:00:00Z`) - LAGOS_OFFSET;
}

/** Effective dates must be today or later. Returns an error message, or null when valid. */
export function validateEffectiveDay(key: string, now: number): string | null {
  if (!key || Number.isNaN(startOfDay(key))) return 'Choose an effective date.';
  if (key < dayKey(now)) return 'Effective date can’t be in the past. Choose today or a later date.';
  return null;
}

/** Today means "from now"; a later day means from Lagos midnight that day. */
export function effectiveFromDay(key: string, now: number): number {
  return key === dayKey(now) ? now : startOfDay(key);
}

/** `<input type="datetime-local">` value in Lagos time, and back. */
export function toLocalInput(ms: number): string {
  return new Date(ms + LAGOS_OFFSET).toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return Number.NaN;
  return Date.parse(`${v}:00Z`) - LAGOS_OFFSET;
}

/* ---------- Version selection ---------- */

export function versionsOf<T = unknown>(all: readonly ConfigVersion[], key: ConfigKey): ConfigVersion<T>[] {
  return (all.filter((v) => v.key === key) as ConfigVersion<T>[]).sort((a, b) => b.version - a.version);
}

const PUBLISHED = new Set<ConfigVersion['status']>(['active', 'scheduled', 'superseded']);
export const isPublished = (v: Pick<ConfigVersion, 'status'>) => PUBLISHED.has(v.status);

/** The newest approval request for a version (a version may be submitted again after a rejection). */
export function approvalFor(approvals: readonly ApprovalRequest[], versionId: string): ApprovalRequest | undefined {
  return approvals.filter((a) => a.kind === 'config_publish' && a.target.id === versionId).sort((a, b) => b.requestedAt - a.requestedAt)[0];
}

/**
 * What a version means right now. Stored status is the source for draft/pending/rejected; for
 * published versions the clock decides (a scheduled version becomes "in force" on its date).
 * An approval decided elsewhere (Approvals workspace) is reflected here.
 */
export function deriveStatus<T>(v: ConfigVersion<T>, versions: readonly ConfigVersion<T>[], approvals: readonly ApprovalRequest[], now: number): DerivedStatus {
  if (v.status === 'draft') return 'draft';
  if (v.status === 'rejected') return 'rejected';
  if (v.status === 'pending_approval') {
    const a = approvalFor(approvals, v.id);
    if (a?.status === 'approved') return 'approved';
    if (a?.status === 'rejected') return 'rejected';
    return 'pending_approval';
  }
  const inForce = versionInForce(versions, now);
  if (inForce?.id === v.id) return 'in_force';
  return v.effectiveFrom > now ? 'scheduled' : 'superseded';
}

/** The next published version that takes effect after `now` (earliest first). */
export function nextScheduled<T>(versions: readonly ConfigVersion<T>[], now: number): ConfigVersion<T> | undefined {
  return versions.filter((v) => isPublished(v) && v.effectiveFrom > now).sort((a, b) => a.effectiveFrom - b.effectiveFrom || b.version - a.version)[0];
}

/** The published version immediately before `v` (by version number), for "before" in a diff. */
export function previousPublished<T>(versions: readonly ConfigVersion<T>[], v: ConfigVersion<T>): ConfigVersion<T> | undefined {
  return versions.filter((x) => isPublished(x) && x.version < v.version).sort((a, b) => b.version - a.version)[0];
}

export function nextVersionNumber(versions: readonly ConfigVersion[]): number {
  return versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

/** Field by field differences between two descriptions (matched by label). */
export function diffDescribed(before: Described | null, after: Described): Diff {
  const prev = new Map((before ?? []).map((x) => [x.label, x.text]));
  const out: Diff = [];
  for (const { label, text } of after) {
    const from = prev.get(label);
    if (from !== text) out.push({ field: label, from: from ?? 'Not set', to: text });
    prev.delete(label);
  }
  for (const [label, text] of prev) out.push({ field: label, from: text, to: 'Removed' });
  return out;
}

/* ---------- Changes (apply to a draft copy of the dataset inside act()) ---------- */

type Ctx = { now: number; actor: Actor };
const find = (d: PlatformDataset, id: string) => d.configVersions.find((v) => v.id === id);

/**
 * Keep stored statuses consistent with the clock after a publish: the version in force is `active`,
 * older published ones are `superseded`, future ones `scheduled`.
 */
export function settle(d: PlatformDataset, key: ConfigKey, now: number) {
  const vs = d.configVersions.filter((v) => v.key === key);
  const inForce = versionInForce(vs, now);
  for (const v of vs) {
    if (!isPublished(v)) continue;
    v.status = v.id === inForce?.id ? 'active' : v.effectiveFrom > now ? 'scheduled' : 'superseded';
  }
}

export function saveDraft(d: PlatformDataset, input: { id?: string; key: ConfigKey; value: unknown; note: string; effectiveFrom: number }, ctx: Ctx): Result<{ id: string }> {
  if (!input.note.trim()) return { ok: false, error: 'Add a note that explains the change.' };
  if (input.id) {
    const v = find(d, input.id);
    if (!v) return { ok: false, error: 'This draft no longer exists.' };
    if (v.status !== 'draft') return { ok: false, error: 'Only drafts can be edited. Create a new version instead.' };
    v.value = input.value;
    v.note = input.note.trim();
    v.effectiveFrom = input.effectiveFrom;
    return { ok: true, id: v.id };
  }
  const version = nextVersionNumber(d.configVersions.filter((v) => v.key === input.key));
  const id = `cfg-${input.key}-${version}-${ctx.now.toString(36)}`;
  d.configVersions.push({ id, key: input.key, version, value: input.value, status: 'draft', effectiveFrom: input.effectiveFrom, createdBy: ctx.actor, createdAt: ctx.now, note: input.note.trim() });
  return { ok: true, id };
}

export function submitForApproval(d: PlatformDataset, id: string, title: string, ctx: Ctx): Result {
  const v = find(d, id);
  if (!v) return { ok: false, error: 'Version not found.' };
  if (v.status !== 'draft') return { ok: false, error: 'Only drafts can be sent for approval.' };
  v.status = 'pending_approval';
  d.approvals.unshift({
    id: `apr-${ctx.now.toString(36)}-${v.version}`,
    kind: 'config_publish',
    title,
    requestedBy: ctx.actor,
    requestedAt: ctx.now,
    target: { type: 'config', id: v.id, label: title.replace(/^Publish /, '') },
    status: 'pending',
    approverRoles: [...APPROVAL_RULES.config_publish.approverRoles],
  });
  return { ok: true };
}

function publish(d: PlatformDataset, v: ConfigVersion, by: Actor, now: number) {
  // A version whose date passed while it waited takes effect from the moment it is published.
  if (v.effectiveFrom < now) v.effectiveFrom = now;
  v.approvedBy = by;
  v.status = v.effectiveFrom > now ? 'scheduled' : 'active';
  settle(d, v.key, now);
}

/** Owners (config.publish) may publish without a second person; the audit entry records it. */
export function publishDirect(d: PlatformDataset, id: string, ctx: Ctx): Result {
  const v = find(d, id);
  if (!v) return { ok: false, error: 'Version not found.' };
  if (v.status !== 'draft' && v.status !== 'pending_approval') return { ok: false, error: 'This version was already decided.' };
  const a = approvalFor(d.approvals, id);
  if (a && a.status === 'pending') {
    // Close the open request so the Approvals queue does not show a decision that was already made.
    a.status = 'approved';
    a.decidedBy = ctx.actor;
    a.decidedAt = ctx.now;
    a.note = 'Owner published directly';
  }
  publish(d, v, ctx.actor, ctx.now);
  return { ok: true };
}

/** Decide the approval and apply its outcome to the version in one change. */
export function decideVersion(d: PlatformDataset, id: string, approve: boolean, note: string, ctx: Ctx): Result {
  const v = find(d, id);
  if (!v) return { ok: false, error: 'Version not found.' };
  if (v.status !== 'pending_approval') return { ok: false, error: 'This version is not waiting for approval.' };
  const a = approvalFor(d.approvals, id);
  if (!a) return { ok: false, error: 'No approval request found for this version.' };
  if (a.status === 'pending') {
    if (a.requestedBy.kind === 'staff' && ctx.actor.kind === 'staff' && a.requestedBy.id === ctx.actor.id) return { ok: false, error: 'You can’t approve your own request.' };
    a.status = approve ? 'approved' : 'rejected';
    a.decidedBy = ctx.actor;
    a.decidedAt = ctx.now;
    if (note) a.note = note;
  } else if ((a.status === 'approved') !== approve) {
    return { ok: false, error: `This request was already ${a.status}.` };
  }
  if (approve) publish(d, v, a.decidedBy ?? ctx.actor, ctx.now);
  else v.status = 'rejected';
  return { ok: true };
}

/** Drafts never took effect, so they can be removed (the audit entry keeps the record). */
export function discardDraft(d: PlatformDataset, id: string): Result {
  const v = find(d, id);
  if (!v) return { ok: false, error: 'Version not found.' };
  if (v.status !== 'draft') return { ok: false, error: 'Only drafts can be discarded.' };
  d.configVersions = d.configVersions.filter((x) => x.id !== id);
  return { ok: true };
}

/* ---------- Number helpers ---------- */

export const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const nairaText = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;

/* ---------- Fares ---------- */

export interface FareRules {
  base: number;
  perKm: number;
  perMin: number;
  minimum: number;
  /** Suggested fares round up to this many naira. */
  rounding: number;
}
export const FARE_DEFAULTS: FareRules = { base: 500, perKm: 180, perMin: 25, minimum: 1200, rounding: 50 };

export function normalizeFares(raw: unknown): FareRules {
  const r = (raw ?? {}) as Partial<FareRules>;
  return { base: num(r.base, FARE_DEFAULTS.base), perKm: num(r.perKm, FARE_DEFAULTS.perKm), perMin: num(r.perMin, FARE_DEFAULTS.perMin), minimum: num(r.minimum, FARE_DEFAULTS.minimum), rounding: num(r.rounding, FARE_DEFAULTS.rounding) };
}

export function describeFares(f: FareRules): Described {
  return [
    { label: 'Base fare', text: nairaText(f.base) },
    { label: 'Per km', text: nairaText(f.perKm) },
    { label: 'Per minute', text: nairaText(f.perMin) },
    { label: 'Minimum fare', text: nairaText(f.minimum) },
    { label: 'Round up to', text: f.rounding > 0 ? nairaText(f.rounding) : 'Nearest naira' },
  ];
}

export function validateFares(f: FareRules): string[] {
  const e: string[] = [];
  if (![f.base, f.perKm, f.perMin, f.minimum, f.rounding].every(isWhole)) e.push('Use whole naira amounts of 0 or more.');
  if (f.perKm <= 0) e.push('Per km must be more than ₦0.');
  if (f.minimum < f.base) e.push('Minimum fare must be at least the base fare.');
  if (f.rounding > 500) e.push('Round up to ₦500 or less.');
  return e;
}

/** Suggested fare in naira: max(minimum, base + perKm × km + perMin × min), rounded up. */
export function suggestedFare(f: FareRules, km: number, minutes: number): number {
  const raw = f.base + f.perKm * km + f.perMin * minutes;
  const pre = Math.max(f.minimum, raw);
  return f.rounding > 0 ? Math.ceil(Math.round(pre * 100) / 100 / f.rounding) * f.rounding : Math.round(pre);
}

export const EXAMPLE_TRIPS = [
  { km: 5, min: 15 },
  { km: 12, min: 30 },
  { km: 27, min: 74 },
] as const;

export function farePreview(current: FareRules, proposed: FareRules) {
  return EXAMPLE_TRIPS.map((t) => {
    const a = suggestedFare(current, t.km, t.min);
    const b = suggestedFare(proposed, t.km, t.min);
    return { label: `${t.km} km, ${t.min} min`, current: a, proposed: b, change: b - a, pct: a ? (b - a) / a : 0 };
  });
}

/* ---------- Waiting and cancellation ---------- */

export interface CancellationRules {
  /** Passengers can cancel free for this many minutes after a driver accepts. */
  freeMinutes: number;
  fee: number;
  /** Free waiting at pickup before waiting is charged. */
  waitingFreeMinutes: number;
  /** Charge per minute after free waiting; 0 = waiting is not charged. */
  waitingPerMin: number;
}
export const CANCELLATION_DEFAULTS: CancellationRules = { freeMinutes: 2, fee: 300, waitingFreeMinutes: 5, waitingPerMin: 0 };

export function normalizeCancellation(raw: unknown): CancellationRules {
  const r = (raw ?? {}) as Partial<CancellationRules>;
  return {
    freeMinutes: num(r.freeMinutes, CANCELLATION_DEFAULTS.freeMinutes),
    fee: num(r.fee, CANCELLATION_DEFAULTS.fee),
    waitingFreeMinutes: num(r.waitingFreeMinutes, CANCELLATION_DEFAULTS.waitingFreeMinutes),
    waitingPerMin: num(r.waitingPerMin, CANCELLATION_DEFAULTS.waitingPerMin),
  };
}

export function describeCancellation(c: CancellationRules): Described {
  return [
    { label: 'Free cancellation window', text: `${c.freeMinutes} min after a driver accepts` },
    { label: 'Cancellation fee', text: nairaText(c.fee) },
    { label: 'Free waiting', text: `${c.waitingFreeMinutes} min at pickup` },
    { label: 'Waiting charge', text: c.waitingPerMin > 0 ? `${nairaText(c.waitingPerMin)} per min` : 'Not charged' },
  ];
}

export function validateCancellation(c: CancellationRules): string[] {
  const e: string[] = [];
  if (![c.freeMinutes, c.fee, c.waitingFreeMinutes, c.waitingPerMin].every(isWhole)) e.push('Use whole numbers of 0 or more.');
  if (c.freeMinutes > 30) e.push('Free cancellation window must be 30 minutes or less.');
  if (c.waitingFreeMinutes > 30) e.push('Free waiting must be 30 minutes or less.');
  if (c.fee > 5000) e.push('Cancellation fee must be ₦5,000 or less.');
  return e;
}

/* ---------- Service areas ---------- */

export interface CityArea {
  id: CityId;
  name: string;
  status: 'active' | 'paused';
  allDay: boolean;
  /** "HH:MM" Lagos time; ignored when allDay. */
  opens: string;
  closes: string;
  zones: string[];
}
export interface ServiceAreas {
  cities: CityArea[];
}

/** Starting zones for cities the seed lists by name only (test data). */
const DEFAULT_ZONES: Record<CityId, string[]> = {
  lagos: ['Ikeja', 'Yaba', 'Surulere', 'Victoria Island', 'Lekki Phase 1', 'Ikoyi'],
  abuja: ['Wuse', 'Garki', 'Maitama', 'Asokoro', 'Gwarinpa', 'Central Business District'],
};
const CITY_IDS: Record<string, CityId> = { lagos: 'lagos', abuja: 'abuja' };

export function normalizeAreas(raw: unknown): ServiceAreas {
  const list = ((raw ?? {}) as { cities?: unknown[] }).cities ?? ['Lagos', 'Abuja'];
  const cities = list
    .map((c): CityArea | null => {
      if (typeof c === 'string') {
        const id = CITY_IDS[c.toLowerCase()];
        return id ? { id, name: c, status: 'active', allDay: true, opens: '05:00', closes: '23:00', zones: [...DEFAULT_ZONES[id]] } : null;
      }
      const x = c as Partial<CityArea>;
      if (!x.id || !CITY_IDS[x.id]) return null;
      return { id: x.id, name: x.name ?? x.id, status: x.status === 'paused' ? 'paused' : 'active', allDay: x.allDay ?? true, opens: x.opens ?? '05:00', closes: x.closes ?? '23:00', zones: Array.isArray(x.zones) ? [...x.zones] : [] };
    })
    .filter((c): c is CityArea => !!c);
  return { cities };
}

export function describeAreas(a: ServiceAreas): Described {
  return a.cities.flatMap((c) => [
    { label: `${c.name} status`, text: c.status === 'active' ? 'Active' : 'Paused' },
    { label: `${c.name} hours`, text: c.allDay ? 'All day' : `${c.opens} to ${c.closes}` },
    { label: `${c.name} zones`, text: c.zones.length ? c.zones.join(', ') : 'None' },
  ]);
}

export function validateAreas(a: ServiceAreas): string[] {
  const e: string[] = [];
  for (const c of a.cities) {
    const names = c.zones.map((z) => z.trim().toLowerCase());
    if (names.some((z) => !z)) e.push(`${c.name}: zone names can’t be blank.`);
    if (new Set(names).size !== names.length) e.push(`${c.name}: each zone name must be different.`);
    if (c.status === 'active' && c.zones.length === 0) e.push(`${c.name}: an active city needs at least one zone.`);
    if (!c.allDay) {
      if (!/^\d{2}:\d{2}$/.test(c.opens) || !/^\d{2}:\d{2}$/.test(c.closes)) e.push(`${c.name}: set opening and closing times.`);
      else if (c.opens === c.closes) e.push(`${c.name}: opening and closing times must differ.`);
    }
  }
  return e;
}

/** Cities that are paused in `next` but were not paused in `prev`. */
export function newlyPaused(prev: ServiceAreas | null, next: ServiceAreas): CityArea[] {
  return next.cities.filter((c) => c.status === 'paused' && prev?.cities.find((p) => p.id === c.id)?.status !== 'paused');
}

/* ---------- Vehicle categories ---------- */

export interface CategoryItem {
  id: string;
  name: string;
  kind: 'car' | 'tricycle';
  seats: number;
  description: string;
  /** Illustration key in the apps. Only `sedan` artwork exists today. */
  image: string;
  sortOrder: number;
  enabled: boolean;
}
export interface Categories {
  items: CategoryItem[];
  /** Owner's note allowing more than one car category before launch policy changes. */
  launchOverride?: { note: string; by: string };
}
export const IMAGE_KEYS = ['sedan'] as const;

export function normalizeCategories(raw: unknown): Categories {
  const r = (raw ?? {}) as { enabled?: string[]; items?: CategoryItem[]; launchOverride?: Categories['launchOverride'] };
  if (Array.isArray(r.items)) return { items: r.items.map((i) => ({ ...i })), launchOverride: r.launchOverride };
  const enabled = new Set(r.enabled ?? []);
  return {
    items: MOCK_SERVICE_CONFIG.categories.map((c) => ({ id: c.id, name: c.name, kind: c.id === 'keke' ? 'tricycle' : 'car', seats: c.seats, description: c.description, image: c.image, sortOrder: c.sortOrder, enabled: r.enabled ? enabled.has(c.name) : c.enabled })),
  };
}

export function describeCategories(c: Categories): Described {
  const rows: Described = [...c.items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({ label: i.name, text: `${i.enabled ? 'Enabled' : 'Off'} · ${i.kind === 'car' ? 'Car' : 'Tricycle'} · ${i.seats} seats · order ${i.sortOrder} · ${i.description}` }));
  rows.push({ label: 'Launch override', text: c.launchOverride ? `${c.launchOverride.note} (${c.launchOverride.by})` : 'None' });
  return rows;
}

/** Launch rule (brief §3): one car category enabled at launch, unless the owner records an override. */
export function launchRule(c: Categories): { enabledCars: string[]; violates: boolean; overridden: boolean } {
  const enabledCars = c.items.filter((i) => i.enabled && i.kind === 'car').map((i) => i.name);
  const violates = enabledCars.length > 1;
  return { enabledCars, violates, overridden: violates && !!c.launchOverride?.note.trim() };
}

export function validateCategories(c: Categories, opts: { canOverride: boolean }): string[] {
  const e: string[] = [];
  const names = c.items.map((i) => i.name.trim().toLowerCase());
  if (names.some((n) => !n)) e.push('Every category needs a name.');
  if (new Set(names).size !== names.length) e.push('Category names must be different.');
  if (new Set(c.items.map((i) => i.id)).size !== c.items.length) e.push('Category ids must be different.');
  if (c.items.some((i) => !Number.isInteger(i.seats) || i.seats < 1 || i.seats > 8)) e.push('Seats must be between 1 and 8.');
  if (c.items.some((i) => !i.description.trim())) e.push('Every category needs a short description.');
  if (c.items.some((i) => i.description.length > 60)) e.push('Descriptions must be 60 characters or fewer.');
  if (!c.items.some((i) => i.enabled)) e.push('Enable at least one category, or booking screens will have nothing to show.');
  const rule = launchRule(c);
  if (rule.violates && !rule.overridden) {
    e.push(opts.canOverride ? 'Only one car category can be enabled at launch. Add a launch override note to continue.' : 'Only one car category can be enabled at launch. Only the owner can add an override.');
  }
  return e;
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'category';
}

/* ---------- Driver access packages ---------- */

export interface PackageRule {
  id: 'daily' | 'monthly';
  name: string;
  price: number;
  durationDays: number;
  /** When access starts after payment is confirmed. */
  activation: 'on_payment' | 'next_midnight';
  /** Percent off a driver's first ever package purchase; 0 = no promotion. */
  firstPurchaseDiscountPct: number;
}
export interface Packages {
  items: PackageRule[];
  /** Reminder before access ends, in hours. */
  renewalReminderHours: number;
  /** Buying again before expiry adds time to the end of current access. */
  earlyRenewal: 'extends' | 'not_allowed';
  /** Prices still waiting for the owner's final decision (D-024). */
  provisional: boolean;
}

export function normalizePackages(raw: unknown): Packages {
  const r = (raw ?? {}) as Partial<Packages> & { daily?: number; monthly?: number };
  if (Array.isArray(r.items)) return { items: r.items.map((i) => ({ ...i })), renewalReminderHours: num(r.renewalReminderHours, 12), earlyRenewal: r.earlyRenewal ?? 'extends', provisional: r.provisional ?? true };
  return {
    items: [
      { id: 'daily', name: 'Daily access', price: num(r.daily, 2000), durationDays: 1, activation: 'on_payment', firstPurchaseDiscountPct: 0 },
      { id: 'monthly', name: 'Monthly access', price: num(r.monthly, 60000), durationDays: 30, activation: 'on_payment', firstPurchaseDiscountPct: 0 },
    ],
    renewalReminderHours: 12,
    earlyRenewal: 'extends',
    provisional: true,
  };
}

export const ACTIVATION_LABEL: Record<PackageRule['activation'], string> = { on_payment: 'As soon as payment is confirmed', next_midnight: 'From the next midnight' };

export function describePackages(p: Packages): Described {
  return [
    ...p.items.flatMap((i) => [
      { label: `${i.name} price`, text: nairaText(i.price) },
      { label: `${i.name} duration`, text: `${i.durationDays} day${i.durationDays === 1 ? '' : 's'}` },
      { label: `${i.name} starts`, text: ACTIVATION_LABEL[i.activation] },
      { label: `${i.name} first purchase offer`, text: i.firstPurchaseDiscountPct > 0 ? `${i.firstPurchaseDiscountPct}% off (${nairaText(discounted(i))})` : 'None' },
    ]),
    { label: 'Eligibility', text: 'Approved drivers only' },
    { label: 'Renewal reminder', text: `${p.renewalReminderHours} hours before access ends` },
    { label: 'Early renewal', text: p.earlyRenewal === 'extends' ? 'Adds time after current access' : 'Not allowed until access ends' },
    { label: 'Prices', text: p.provisional ? 'Provisional (D-024)' : 'Confirmed' },
  ];
}

export const discounted = (i: PackageRule) => Math.round((i.price * (100 - i.firstPurchaseDiscountPct)) / 100);

export function validatePackages(p: Packages): string[] {
  const e: string[] = [];
  for (const i of p.items) {
    if (!isWhole(i.price) || i.price < 100) e.push(`${i.name}: price must be a whole amount of at least ₦100.`);
    if (!Number.isInteger(i.durationDays) || i.durationDays < 1 || i.durationDays > 31) e.push(`${i.name}: duration must be 1 to 31 days.`);
    if (!Number.isInteger(i.firstPurchaseDiscountPct) || i.firstPurchaseDiscountPct < 0 || i.firstPurchaseDiscountPct > 50) e.push(`${i.name}: first purchase discount must be 0 to 50%.`);
  }
  if (!Number.isInteger(p.renewalReminderHours) || p.renewalReminderHours < 1 || p.renewalReminderHours > 72) e.push('Renewal reminder must be 1 to 72 hours.');
  return e;
}

/* ---------- Referrals ---------- */

export interface ReferralRules {
  enabled: boolean;
  qualifying: 'first_completed_paid_trip';
  reward: number;
  maxRewarded: number;
  inviteExpiryDays: number;
  rewardExpiryDays: number;
  budget: number;
}

export function normalizeReferrals(raw: unknown): ReferralRules {
  const r = (raw ?? {}) as Partial<ReferralRules>;
  return {
    enabled: r.enabled ?? true,
    qualifying: 'first_completed_paid_trip',
    reward: num(r.reward, 500),
    maxRewarded: num(r.maxRewarded, 10),
    inviteExpiryDays: num(r.inviteExpiryDays, 30),
    rewardExpiryDays: num(r.rewardExpiryDays, 90),
    budget: num(r.budget, 500_000),
  };
}

export function describeReferrals(r: ReferralRules): Described {
  return [
    { label: 'Programme', text: r.enabled ? 'On' : 'Off' },
    { label: 'Qualifies when', text: 'Friend completes their first paid trip' },
    { label: 'Reward', text: `${nairaText(r.reward)} to the referrer’s wallet` },
    { label: 'Most rewarded referrals', text: `${r.maxRewarded} per person` },
    { label: 'Invite expires', text: `${r.inviteExpiryDays} days after sharing` },
    { label: 'Reward expires', text: `${r.rewardExpiryDays} days after it is earned` },
    { label: 'Campaign budget', text: nairaText(r.budget) },
  ];
}

export function validateReferrals(r: ReferralRules, spentNaira: number): string[] {
  const e: string[] = [];
  if (!isWhole(r.reward) || r.reward < 50) e.push('Reward must be a whole amount of at least ₦50.');
  if (r.reward > 10_000) e.push('Reward must be ₦10,000 or less.');
  if (!Number.isInteger(r.maxRewarded) || r.maxRewarded < 1 || r.maxRewarded > 100) e.push('Most rewarded referrals must be 1 to 100.');
  if (!Number.isInteger(r.inviteExpiryDays) || r.inviteExpiryDays < 1 || r.inviteExpiryDays > 365) e.push('Invite expiry must be 1 to 365 days.');
  if (!Number.isInteger(r.rewardExpiryDays) || r.rewardExpiryDays < 1 || r.rewardExpiryDays > 365) e.push('Reward expiry must be 1 to 365 days.');
  if (!isWhole(r.budget)) e.push('Budget must be a whole amount.');
  else if (r.budget < spentNaira) e.push(`Budget can’t be below what is already spent (${nairaText(spentNaira)}).`);
  return e;
}

/** Referral rewards paid, from the ledger: promotions_expense entries of kind referral_reward (kobo). */
export function referralSpend(ledger: readonly LedgerEntry[]): { spentKobo: number; rewards: number; lastAt?: number } {
  const xs = ledger.filter((l) => l.kind === 'referral_reward' && l.account.kind === 'promotions_expense');
  const reversed = new Set(ledger.filter((l) => l.reverses).map((l) => l.reverses));
  const live = xs.filter((l) => !reversed.has(l.id) && !l.reverses);
  return { spentKobo: live.reduce((s, l) => s + Math.abs(l.amount), 0), rewards: live.length, lastAt: live.reduce<number | undefined>((m, l) => (m === undefined || l.at > m ? l.at : m), undefined) };
}
