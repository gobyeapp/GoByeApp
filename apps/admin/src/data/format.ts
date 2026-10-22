import { CITY_LABELS, formatNaira, type CityId, type Kobo } from '@gobye/core';

export const money = (k: Kobo | number) => formatNaira(k as Kobo);
export const signedMoney = (k: Kobo | number) => formatNaira(k as Kobo, { signed: true });
export const city = (c: CityId) => CITY_LABELS[c];

export function when(ms: number | undefined, now = Date.now()) {
  if (!ms) return 'Not set';
  const d = new Date(ms);
  const diff = now - ms;
  if (diff >= 0 && diff < 60_000) return 'Just now';
  if (diff >= 0 && diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff >= 0 && diff < 86_400_000 && d.getDate() === new Date(now).getDate()) return `Today, ${d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function date(ms: number | undefined) {
  if (!ms) return 'Not set';
  return new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const count = (n: number) => n.toLocaleString('en-NG');

/** "under_review" → "Under review" */
export const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

export function initials(name: string) {
  return name
    .replace(/[^\p{L} ]/gu, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Download rows as CSV (exports and reports). */
export function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  if (!rows.length) return;
  const head = Object.keys(rows[0]!);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [head.map(esc).join(','), ...rows.map((r) => head.map((h) => esc(r[h] ?? '')).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
