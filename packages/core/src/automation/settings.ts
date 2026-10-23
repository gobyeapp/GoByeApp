import type { AutomationDefinition } from './registry';

/**
 * Changes to automation settings. Bounds come from the registry; every change needs a reason and a
 * second person's approval (approval kind `automation_config`), and is kept as history.
 */
export interface AutomationSettingChange {
  id: string;
  automationId: string;
  key: string;
  from: number | boolean;
  to: number | boolean;
  reason: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  requestedBy: { id: string; name: string };
  requestedAt: number;
  decidedBy?: { id: string; name: string };
  decidedAt?: number;
}


/** The value in force: the latest approved change for this setting, else the registry default. */
export function paramValue(def: Pick<AutomationDefinition, 'id' | 'params'>, key: string, changes: readonly AutomationSettingChange[]): number | boolean | undefined {
  const approved = changes.filter((c) => c.automationId === def.id && c.key === key && c.status === 'approved').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))[0];
  return approved ? approved.to : def.params.find((p) => p.key === key)?.value;
}

/** Apply an approval decision to a pending change. Returns an error and changes nothing if it isn't pending. */
export function decideSettingChange(change: AutomationSettingChange | undefined, decision: 'approved' | 'rejected', by: { id: string; name: string }, now: number): { ok: true } | { ok: false; error: string } {
  if (!change) return { ok: false, error: 'Setting change not found' };
  if (change.status !== 'pending_approval') return { ok: false, error: `This change is already ${change.status.replace(/_/g, ' ')}` };
  if (change.requestedBy.id === by.id) return { ok: false, error: 'Nobody decides their own change' };
  change.status = decision;
  change.decidedBy = by;
  change.decidedAt = now;
  return { ok: true };
}
