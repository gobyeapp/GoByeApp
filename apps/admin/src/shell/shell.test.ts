import { describe, expect, it } from 'vitest';
import { can as canDo, createPlatformDataset, inCityScope, type CityId, type Permission } from '@gobye/core';
import { lagosDay, when } from '@/data/format';
import { ALL_ITEMS, NAV, groupOf } from '@/nav';
import { REVIEW_STATES } from '@/workspaces/people/logic';
import { attentionNotes } from './attention';
import { matchScore } from './CommandPalette';

const d = createPlatformDataset();
const staff = (id: string) => d.staff.find((s) => s.id === id)!;
const asStaff = (id: string) => ({ can: (p: Permission) => canDo(staff(id), p), inScope: (c: CityId) => inCityScope(staff(id), c) });

describe('navigation', () => {
  it('keeps every route path once and puts each in one group', () => {
    const paths = ALL_ITEMS.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(NAV.filter((g) => g.items.some((i) => i.path === p))).toHaveLength(1);
    expect(groupOf('/finance/ledger')?.title).toBe('Finance');
    expect(groupOf('/config/fares')?.subnav).toBe(true);
  });

  it('drivers badge counts the same review states as the review queue and the overview', () => {
    const item = ALL_ITEMS.find((i) => i.path === '/drivers')!;
    const expected = d.drivers.filter((x) => REVIEW_STATES.includes(x.verification)).length;
    expect(item.badge!(d, d.generatedAt, () => true)).toBe(expected);
  });

  it('badges respect the staff member city scope', () => {
    const item = ALL_ITEMS.find((i) => i.path === '/drivers')!;
    const lagos = item.badge!(d, d.generatedAt, (c) => c === 'lagos');
    const all = item.badge!(d, d.generatedAt, () => true);
    expect(lagos).toBe(d.drivers.filter((x) => x.city === 'lagos' && REVIEW_STATES.includes(x.verification)).length);
    expect(lagos).toBeLessThanOrEqual(all);
  });
});

describe('notifications panel', () => {
  it('lists only pages the role can open, most serious first', () => {
    const owner = d.staff.find((s) => s.roles.includes('owner'))!;
    const o = asStaff(owner.id);
    const notes = attentionNotes(d, d.generatedAt, o.can, o.inScope);
    expect(notes.length).toBeGreaterThan(0);
    const rank = { danger: 0, warning: 1, info: 2, brand: 3, success: 4, neutral: 5 };
    for (let i = 1; i < notes.length; i++) expect(rank[notes[i]!.tone]).toBeGreaterThanOrEqual(rank[notes[i - 1]!.tone]);
    for (const n of notes) expect(n.text).toMatch(/^\d+ /);
  });

  it('a developer sees no money or care items', () => {
    const dev = d.staff.find((s) => s.roles.length === 1 && s.roles[0] === 'developer')!;
    const x = asStaff(dev.id);
    const paths = attentionNotes(d, d.generatedAt, x.can, x.inScope).map((n) => n.path);
    expect(paths).not.toContain('/finance/withdrawals');
    expect(paths).not.toContain('/cases');
    expect(paths).not.toContain('/safety');
  });
});

describe('command palette matching', () => {
  it('matches word starts, all words required', () => {
    expect(matchScore('fare', 'Fare settings')).toBeGreaterThan(0);
    expect(matchScore('fare set', 'Fare settings')).toBeGreaterThan(matchScore('fare', 'Fare settings'));
    expect(matchScore('fare zzz', 'Fare settings')).toBe(0);
    expect(matchScore('', 'anything')).toBe(0);
  });
  it('label matches beat keyword matches', () => {
    expect(matchScore('drivers', 'Drivers', 'People')).toBeGreaterThan(matchScore('drivers', 'Driver earnings', 'Finance', 'payouts drivers'));
  });
});

describe('Lagos time', () => {
  it('uses WAT (UTC+1) for "today", whatever the computer time zone', () => {
    const lateUtc = Date.UTC(2026, 9, 21, 23, 30); // 00:30 on 22 Oct in Lagos
    expect(lagosDay(lateUtc)).toBe(lagosDay(Date.UTC(2026, 9, 22, 8)));
    expect(when(lateUtc, Date.UTC(2026, 9, 22, 8))).toMatch(/^Today, /);
    expect(when(lateUtc, Date.UTC(2026, 9, 22, 8))).toMatch(/12:30|0:30/);
  });
});
