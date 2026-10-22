import type { Actor, AuditEvent, RecordType } from '@gobye/core';

export const actorKey = (a: Actor) => ('id' in a ? `${a.kind}:${a.id}` : `${a.kind}:${a.name}`);
export const actorLabel = (a: Actor) => (a.kind === 'staff' ? a.name : a.kind === 'system' ? `${a.name} (system)` : a.kind === 'provider' ? `${a.name} (provider)` : `${a.name} (${a.kind})`);

export interface AuditFilter {
  q: string;
  actor: string;
  type: RecordType | 'all';
}

export function filterAudit(events: readonly AuditEvent[], f: AuditFilter): AuditEvent[] {
  const q = f.q.trim().toLowerCase();
  return events
    .filter((e) => (f.actor === 'all' || actorKey(e.actor) === f.actor) && (f.type === 'all' || e.target.type === f.type))
    .filter((e) => !q || [e.action, e.summary, e.target.label, e.target.id, e.reason ?? '', e.actor.name].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => b.at - a.at);
}

/** Distinct actors for the filter, sorted by name. */
export function auditActors(events: readonly AuditEvent[]): { value: string; label: string }[] {
  const m = new Map<string, string>();
  for (const e of events) m.set(actorKey(e.actor), actorLabel(e.actor));
  return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function auditCsvRows(events: readonly AuditEvent[]): Record<string, string>[] {
  return events.map((e) => ({
    time: new Date(e.at).toISOString(),
    actor: actorLabel(e.actor),
    action: e.action,
    target_type: e.target.type,
    target_id: e.target.id,
    target: e.target.label,
    summary: e.summary,
    reason: e.reason ?? '',
    changes: (e.diff ?? []).map((x) => `${x.field}: ${x.from} to ${x.to}`).join('; '),
  }));
}
