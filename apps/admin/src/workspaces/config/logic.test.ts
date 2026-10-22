import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type Actor, type ConfigVersion } from '@gobye/core';
import {
  approvalFor,
  dayKey,
  decideVersion,
  deriveStatus,
  describeFares,
  diffDescribed,
  discardDraft,
  effectiveFromDay,
  farePreview,
  launchRule,
  newlyPaused,
  nextScheduled,
  normalizeAreas,
  normalizeCategories,
  normalizeFares,
  normalizePackages,
  normalizeReferrals,
  publishDirect,
  referralSpend,
  saveDraft,
  startOfDay,
  submitForApproval,
  suggestedFare,
  validateAreas,
  validateCategories,
  validateEffectiveDay,
  validateFares,
  validatePackages,
  validateReferrals,
  versionsOf,
} from './logic';

const DAY = 86_400_000;
const admin: Actor = { kind: 'staff', id: 'stf-admin', name: 'Ifeoma Admin' };
const owner: Actor = { kind: 'staff', id: 'stf-owner', name: 'Akorede (Owner)' };

describe('dates', () => {
  const now = Date.UTC(2026, 9, 21, 20, 0); // 21:00 in Lagos
  it('uses the Lagos calendar day', () => {
    expect(dayKey(now)).toBe('2026-10-21');
    expect(dayKey(Date.UTC(2026, 9, 21, 23, 30))).toBe('2026-10-22'); // 00:30 Lagos
    expect(startOfDay('2026-10-22')).toBe(Date.UTC(2026, 9, 21, 23, 0));
  });
  it('rejects past effective dates with a message', () => {
    expect(validateEffectiveDay('2026-10-20', now)).toMatch(/past/);
    expect(validateEffectiveDay('', now)).toMatch(/Choose/);
    expect(validateEffectiveDay('2026-10-21', now)).toBeNull();
    expect(validateEffectiveDay('2026-11-01', now)).toBeNull();
  });
  it('today means from now; later days from Lagos midnight', () => {
    expect(effectiveFromDay('2026-10-21', now)).toBe(now);
    expect(effectiveFromDay('2026-10-25', now)).toBe(startOfDay('2026-10-25'));
  });
});

describe('version selection', () => {
  const d = createPlatformDataset();
  const now = d.generatedAt;
  const fares = versionsOf(d.configVersions, 'fares');
  it('sorts newest first and derives statuses from the clock and approvals', () => {
    expect(fares.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(fares.map((v) => deriveStatus(v, fares, d.approvals, now))).toEqual(['pending_approval', 'in_force', 'superseded']);
  });
  it('reflects an approval decided elsewhere', () => {
    const approvals = d.approvals.map((a) => (a.target.id === 'cfg-fares-3' ? { ...a, status: 'approved' as const } : a));
    expect(deriveStatus(fares[0]!, fares, approvals, now)).toBe('approved');
    const rejected = d.approvals.map((a) => (a.target.id === 'cfg-fares-3' ? { ...a, status: 'rejected' as const } : a));
    expect(deriveStatus(fares[0]!, fares, rejected, now)).toBe('rejected');
  });
  it('finds the next scheduled version', () => {
    const vs: ConfigVersion[] = [
      { ...fares[1]!, id: 'a', version: 4, status: 'scheduled', effectiveFrom: now + 9 * DAY },
      { ...fares[1]!, id: 'b', version: 5, status: 'scheduled', effectiveFrom: now + 3 * DAY },
      ...fares,
    ];
    expect(nextScheduled(vs, now)?.id).toBe('b');
    expect(deriveStatus(vs[0]!, vs, [], now)).toBe('scheduled');
    expect(deriveStatus(vs[1]!, vs, [], now + 4 * DAY)).toBe('in_force');
  });
});

describe('diff', () => {
  it('lists changed, added and removed fields', () => {
    const a = describeFares(normalizeFares({ base: 500, perKm: 190, perMin: 25, minimum: 1200 }));
    const b = describeFares(normalizeFares({ base: 500, perKm: 200, perMin: 28, minimum: 1300 }));
    expect(diffDescribed(a, b)).toEqual([
      { field: 'Per km', from: '₦190', to: '₦200' },
      { field: 'Per minute', from: '₦25', to: '₦28' },
      { field: 'Minimum fare', from: '₦1,200', to: '₦1,300' },
    ]);
    expect(diffDescribed(null, [{ label: 'X', text: '1' }])).toEqual([{ field: 'X', from: 'Not set', to: '1' }]);
    expect(diffDescribed([{ label: 'X', text: '1' }], [])).toEqual([{ field: 'X', from: '1', to: 'Removed' }]);
  });
});

describe('version changes', () => {
  it('draft → approval → approved by owner → scheduled, never touching the version in force', () => {
    const d = createPlatformDataset();
    const now = d.generatedAt;
    const s = saveDraft(d, { key: 'referrals', value: { reward: 700 }, note: 'Raise reward', effectiveFrom: now + 2 * DAY }, { now, actor: admin });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const before = structuredClone(d.configVersions.find((v) => v.id === 'cfg-ref-1'));
    expect(submitForApproval(d, s.id, 'Publish Referral rules v2', { now, actor: admin }).ok).toBe(true);
    const a = approvalFor(d.approvals, s.id)!;
    expect(a).toMatchObject({ kind: 'config_publish', status: 'pending', approverRoles: ['owner'] });
    expect(decideVersion(d, s.id, true, '', { now, actor: admin })).toEqual({ ok: false, error: 'You can’t approve your own request.' });
    expect(decideVersion(d, s.id, true, '', { now, actor: owner }).ok).toBe(true);
    const v = d.configVersions.find((x) => x.id === s.id)!;
    expect(v).toMatchObject({ status: 'scheduled', version: 2, approvedBy: owner });
    expect(d.configVersions.find((x) => x.id === 'cfg-ref-1')).toEqual(before);
    // Once its date passes it is in force and the old one superseded.
    const vs = versionsOf(d.configVersions, 'referrals');
    expect(deriveStatus(v, vs, d.approvals, now + 3 * DAY)).toBe('in_force');
    expect(deriveStatus(before!, vs, d.approvals, now + 3 * DAY)).toBe('superseded');
  });
  it('rejection keeps the version in force', () => {
    const d = createPlatformDataset();
    const now = d.generatedAt;
    expect(decideVersion(d, 'cfg-fares-3', false, 'Too steep', { now, actor: owner }).ok).toBe(true);
    expect(d.configVersions.find((v) => v.id === 'cfg-fares-3')!.status).toBe('rejected');
    expect(d.approvals.find((a) => a.id === 'apr-0001')).toMatchObject({ status: 'rejected', note: 'Too steep' });
    expect(d.configVersions.find((v) => v.id === 'cfg-fares-2')!.status).toBe('active');
  });
  it('owner publishes directly; effective now supersedes the old version', () => {
    const d = createPlatformDataset();
    const now = d.generatedAt;
    const s = saveDraft(d, { key: 'packages', value: { daily: 1800, monthly: 30000 }, note: 'Confirm prices', effectiveFrom: now }, { now, actor: owner });
    if (!s.ok) throw new Error(s.error);
    expect(publishDirect(d, s.id, { now, actor: owner }).ok).toBe(true);
    expect(d.configVersions.find((v) => v.id === s.id)!.status).toBe('active');
    expect(d.configVersions.find((v) => v.id === 'cfg-pkg-1')!.status).toBe('superseded');
  });
  it('a pending version whose date passed takes effect when approved', () => {
    const d = createPlatformDataset();
    const later = d.generatedAt + 6 * DAY;
    expect(decideVersion(d, 'cfg-fares-3', true, '', { now: later, actor: owner }).ok).toBe(true);
    const v = d.configVersions.find((x) => x.id === 'cfg-fares-3')!;
    expect(v.effectiveFrom).toBe(later);
    expect(v.status).toBe('active');
  });
  it('only drafts can be edited or discarded; a note is required', () => {
    const d = createPlatformDataset();
    const now = d.generatedAt;
    expect(saveDraft(d, { id: 'cfg-fares-2', key: 'fares', value: {}, note: 'x', effectiveFrom: now }, { now, actor: admin }).ok).toBe(false);
    expect(saveDraft(d, { key: 'fares', value: {}, note: ' ', effectiveFrom: now }, { now, actor: admin }).ok).toBe(false);
    expect(discardDraft(d, 'cfg-fares-2').ok).toBe(false);
    const s = saveDraft(d, { key: 'fares', value: {}, note: 'Try', effectiveFrom: now }, { now, actor: admin });
    if (!s.ok) throw new Error(s.error);
    expect(d.configVersions.find((v) => v.id === s.id)!.version).toBe(4);
    expect(discardDraft(d, s.id).ok).toBe(true);
    expect(d.configVersions.some((v) => v.id === s.id)).toBe(false);
  });
});

describe('fares', () => {
  const v2 = normalizeFares({ base: 500, perKm: 190, perMin: 25, minimum: 1200 });
  const v3 = normalizeFares({ base: 500, perKm: 200, perMin: 28, minimum: 1300 });
  it('computes suggested fares with minimum and rounding', () => {
    expect(suggestedFare(v2, 5, 15)).toBe(1850); // 500 + 950 + 375 = 1825 → 1850
    expect(suggestedFare(v2, 1, 1)).toBe(1200); // minimum
    expect(suggestedFare({ ...v2, rounding: 0 }, 5, 15)).toBe(1825);
  });
  it('previews example trips side by side', () => {
    const rows = farePreview(v2, v3);
    expect(rows.map((r) => r.label)).toEqual(['5 km, 15 min', '12 km, 30 min', '27 km, 74 min']);
    expect(rows[0]).toMatchObject({ current: 1850, proposed: 1950, change: 100 });
    expect(rows[2]).toMatchObject({ current: 7500, proposed: 8000 });
  });
  it('validates', () => {
    expect(validateFares(v2)).toEqual([]);
    expect(validateFares({ ...v2, minimum: 100 })).toContain('Minimum fare must be at least the base fare.');
    expect(validateFares({ ...v2, perKm: Number.NaN }).length).toBeGreaterThan(0);
  });
});

describe('categories launch rule', () => {
  const seed = normalizeCategories({ enabled: ['GoBye Car'] });
  it('reads the seed: one car enabled', () => {
    expect(seed.items.filter((i) => i.enabled).map((i) => i.name)).toEqual(['GoBye Car']);
    expect(launchRule(seed).violates).toBe(false);
    expect(validateCategories(seed, { canOverride: false })).toEqual([]);
  });
  it('blocks a second car category unless the owner adds an override', () => {
    const two = { ...seed, items: seed.items.map((i) => (i.id === 'comfort' ? { ...i, enabled: true } : i)) };
    expect(launchRule(two)).toMatchObject({ violates: true, overridden: false, enabledCars: ['GoBye Car', 'GoBye Comfort'] });
    expect(validateCategories(two, { canOverride: false }).join(' ')).toMatch(/Only the owner/);
    expect(validateCategories(two, { canOverride: true }).join(' ')).toMatch(/override note/);
    const ok = { ...two, launchOverride: { note: 'Airport pilot', by: 'Owner' } };
    expect(validateCategories(ok, { canOverride: true })).toEqual([]);
  });
  it('tricycles do not count as a car category', () => {
    const keke = { ...seed, items: seed.items.map((i) => (i.id === 'keke' ? { ...i, enabled: true } : i)) };
    expect(launchRule(keke).violates).toBe(false);
  });
  it('needs names, seats and at least one enabled', () => {
    const none = { ...seed, items: seed.items.map((i) => ({ ...i, enabled: false })) };
    expect(validateCategories(none, { canOverride: true }).join(' ')).toMatch(/at least one/);
    const bad = { ...seed, items: seed.items.map((i, k) => (k === 0 ? { ...i, seats: 0, name: '' } : i)) };
    expect(validateCategories(bad, { canOverride: true }).length).toBeGreaterThanOrEqual(2);
  });
});

describe('service areas', () => {
  const seed = normalizeAreas({ cities: ['Lagos', 'Abuja'] });
  it('expands the seed and validates zones and hours', () => {
    expect(seed.cities.map((c) => c.id)).toEqual(['lagos', 'abuja']);
    expect(validateAreas(seed)).toEqual([]);
    const bad = { cities: seed.cities.map((c) => ({ ...c, zones: [], allDay: false, opens: '06:00', closes: '06:00' })) };
    expect(validateAreas(bad).join(' ')).toMatch(/at least one zone/);
    expect(validateAreas(bad).join(' ')).toMatch(/must differ/);
  });
  it('detects newly paused cities', () => {
    const paused = { cities: seed.cities.map((c) => (c.id === 'abuja' ? { ...c, status: 'paused' as const } : c)) };
    expect(newlyPaused(seed, paused).map((c) => c.id)).toEqual(['abuja']);
    expect(newlyPaused(paused, paused)).toEqual([]);
  });
});

describe('packages and referrals', () => {
  it('reads seed package prices and validates', () => {
    const p = normalizePackages({ daily: 1500, monthly: 25000 });
    expect(p.items.map((i) => i.price)).toEqual([1500, 25000]);
    expect(p.provisional).toBe(true);
    expect(validatePackages(p)).toEqual([]);
    expect(validatePackages({ ...p, items: [{ ...p.items[0]!, firstPurchaseDiscountPct: 80 }] }).length).toBe(1);
  });
  it('sums referral spend from the ledger and keeps budget above spend', () => {
    const d = createPlatformDataset();
    const s = referralSpend(d.ledger);
    expect(s.rewards).toBe(6);
    expect(s.spentKobo).toBe(300_000); // 6 × ₦500
    const r = normalizeReferrals({ reward: 500, maxRewarded: 10 });
    expect(validateReferrals(r, 3000)).toEqual([]);
    expect(validateReferrals({ ...r, budget: 1000 }, 3000).join(' ')).toMatch(/already spent/);
  });
});
