import { describe, expect, it } from 'vitest';
import { createPlatformDataset } from '@gobye/core';
import { auditActors, auditCsvRows, filterAudit } from './logic';

const { audit } = createPlatformDataset();

describe('filterAudit', () => {
  it('filters by record type, actor and text, newest first', () => {
    expect(filterAudit(audit, { q: '', actor: 'all', type: 'config' }).map((e) => e.id)).toEqual(['aud-1']);
    expect(filterAudit(audit, { q: '', actor: 'staff:stf-owner', type: 'all' }).every((e) => e.actor.name.startsWith('Liquid'))).toBe(true);
    expect(filterAudit(audit, { q: 'licence', actor: 'all', type: 'all' }).map((e) => e.id)).toEqual(['aud-5']);
    const all = filterAudit(audit, { q: '', actor: 'all', type: 'all' });
    expect(all[0]!.at).toBeGreaterThanOrEqual(all.at(-1)!.at);
  });
});

describe('auditActors and CSV', () => {
  it('lists distinct actors and flattens diffs', () => {
    expect(new Set(auditActors(audit).map((a) => a.value)).size).toBe(auditActors(audit).length);
    const row = auditCsvRows(audit.filter((e) => e.id === 'aud-1'))[0]!;
    expect(row.changes).toBe('Per km: ₦180 to ₦190');
    expect(row.reason).toBe('Fuel price change');
  });
});
