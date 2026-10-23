import type { CityId, Permission, PlatformDataset } from '@gobye/core';
import { ALL_ITEMS } from '@/nav';
import type { IconName } from '@/ui/Icon';
import type { Tone } from '@/ui/kit';

/**
 * What the notifications panel lists: the same "needs action" counts as the sidebar badges, worded as
 * sentences, only for pages the staff member can open and only for their cities. Built from the loaded
 * records; real push or email alerts to staff need the backend.
 */
export interface AttentionNote {
  key: string;
  path: string;
  icon: IconName;
  tone: Tone;
  count: number;
  text: string;
}

const WORDING: Record<string, { one: string; many: string; tone: Tone }> = {
  '/approvals': { one: 'approval is waiting for a decision', many: 'approvals are waiting for a decision', tone: 'warning' },
  '/live': { one: 'trip needs attention in live operations', many: 'trips need attention in live operations', tone: 'warning' },
  '/drivers': { one: 'driver is waiting for verification', many: 'drivers are waiting for verification', tone: 'info' },
  '/cases': { one: 'new support case is not picked up', many: 'new support cases are not picked up', tone: 'warning' },
  '/safety': { one: 'safety case is open', many: 'safety cases are open', tone: 'danger' },
  '/finance/withdrawals': { one: 'withdrawal is waiting for review', many: 'withdrawals are waiting for review', tone: 'warning' },
  '/developer': { one: 'integration is degraded', many: 'integrations are degraded', tone: 'danger' },
};

export function attentionNotes(d: PlatformDataset, now: number, can: (p: Permission) => boolean, inScope: (c: CityId) => boolean): AttentionNote[] {
  const out: AttentionNote[] = [];
  for (const i of ALL_ITEMS) {
    if (!i.badge || !i.anyOf.some((p) => can(p))) continue;
    const count = i.badge(d, now, inScope);
    if (!count) continue;
    const w = WORDING[i.path] ?? { one: `item in ${i.label}`, many: `items in ${i.label}`, tone: 'info' as Tone };
    out.push({ key: i.path, path: i.path, icon: i.icon, tone: w.tone, count, text: `${count} ${count === 1 ? w.one : w.many}` });
  }
  const rank: Record<Tone, number> = { danger: 0, warning: 1, info: 2, brand: 3, success: 4, neutral: 5 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || b.count - a.count);
}
