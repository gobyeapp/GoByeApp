import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { can as canDo, createPlatformDataset, manualActionCheck, type AutomationRun, type Permission } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import AuditHistory from './AuditHistory';
import Failed from './Failed';
import Registry from './Registry';
import Runs from './Runs';
import Schedules from './Schedules';
import Settings from './Settings';
import { applyManualAction, failedQueue, isAutomationAudit, proposeSettingChange } from './logic';

function mount(Page: ComponentType, staffId: string) {
  const s = TEST_STAFF.find((x) => x.id === staffId)!;
  return render(
    <SessionProvider initialStaffId={staffId}>
      <PlatformProvider actor={{ kind: 'staff', id: s.id, name: s.name }} initial={createPlatformDataset()}>
        <ToastProvider>
          <FilterProvider>
            <MemoryRouter>
              <RecordProvider>
                <Page />
              </RecordProvider>
            </MemoryRouter>
          </FilterProvider>
        </ToastProvider>
      </PlatformProvider>
    </SessionProvider>,
  );
}

const PAGES: [string, ComponentType][] = [
  ['Workflow registry', Registry],
  ['Scheduled jobs', Schedules],
  ['Execution history', Runs],
  ['Failed jobs', Failed],
  ['Automation settings', Settings],
  ['Audit history', AuditHistory],
];

afterEach(cleanup);

describe('Automation Centre pages render', () => {
  for (const staff of ['stf-owner', 'stf-dev', 'stf-fin', 'stf-ops', 'stf-audit']) {
    for (const [title, Page] of PAGES) {
      it(`${title} as ${staff}`, () => {
        mount(Page, staff);
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
        // Honest state on every page.
        expect(document.body.textContent).toMatch(/No job runner is connected yet/);
        expect(document.body.textContent).not.toMatch(/!/);
      });
    }
  }

  it('shows "Not connected" for every definition and never invents a next run time', () => {
    mount(Schedules, 'stf-owner');
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(3);
    expect(screen.getAllByText('Not scheduled: no job runner').length).toBeGreaterThan(0);
  });

  it('read-only roles see why actions are unavailable', () => {
    mount(Failed, 'stf-ops');
    expect(document.body.textContent).toMatch(/Read only for your role/);
  });
});

const staffCan = (id: string) => {
  const s = TEST_STAFF.find((x) => x.id === id)!;
  return (p: Permission) => canDo(s, p);
};
const actor = (id: string) => {
  const s = TEST_STAFF.find((x) => x.id === id)!;
  return { kind: 'staff' as const, id: s.id, name: s.name };
};

describe('protected actions', () => {
  it('a succeeded run can never be retried', () => {
    const d = createPlatformDataset();
    const ok = d.automationRuns.find((r) => r.status === 'succeeded')!;
    expect(manualActionCheck(ok, 'retry', staffCan('stf-dev')).allowed).toBe(false);
    const r = applyManualAction(d, ok.id, 'retry', { now: d.generatedAt, actor: actor('stf-dev'), reason: 'try', can: staffCan('stf-dev') });
    expect(r.ok).toBe(false);
  });

  it('a run with an unknown result can be looked up but not retried', () => {
    const d = createPlatformDataset();
    const run = d.automationRuns.find((r) => r.status === 'needs_lookup')!;
    expect(manualActionCheck(run, 'retry', staffCan('stf-fin')).allowed).toBe(false);
    const before = d.automationRuns.length;
    expect(applyManualAction(d, run.id, 'retry', { now: d.generatedAt, actor: actor('stf-fin'), reason: 'x', can: staffCan('stf-fin') }).ok).toBe(false);
    expect(applyManualAction(d, run.id, 'lookup', { now: d.generatedAt, actor: actor('stf-fin'), reason: 'Check with provider', can: staffCan('stf-fin') })).toEqual({ ok: true });
    expect(d.automationRuns.length).toBe(before);
    expect(run.status).toBe('needs_lookup');
    expect(run.handledBy?.action).toBe('looked_up');
  });

  it('retrying a failed run queues a new simulated run with the same idempotency key', () => {
    const d = createPlatformDataset();
    const run = d.automationRuns.find((r) => r.status === 'failed' && r.automationId === 'support.escalate')!;
    const r = applyManualAction(d, run.id, 'retry', { now: d.generatedAt, actor: actor('stf-dev'), reason: 'Template added', can: staffCan('stf-dev') });
    expect(r).toEqual({ ok: true });
    const fresh = d.automationRuns[0] as AutomationRun;
    expect(fresh).toMatchObject({ status: 'queued', idempotencyKey: run.idempotencyKey, simulated: true, triggeredBy: { kind: 'staff_retry', ref: run.id } });
  });

  it('roles without automation.retry cannot act', () => {
    const d = createPlatformDataset();
    const run = d.automationRuns.find((r) => r.status === 'failed')!;
    expect(applyManualAction(d, run.id, 'retry', { now: d.generatedAt, actor: actor('stf-ops'), reason: 'x', can: staffCan('stf-ops') }).ok).toBe(false);
  });

  it('failed queue puts unknown results first', () => {
    const q = failedQueue(createPlatformDataset().automationRuns);
    expect(q[0]!.status).toBe('needs_lookup');
  });
});

describe('settings proposals', () => {
  it('a valid proposal creates a pending change and an approval for someone else', () => {
    const d = createPlatformDataset();
    const r = proposeSettingChange(d, { automationId: 'drivers.documents.expiry', key: 'warnDays', to: 21, reason: 'More notice' }, { now: d.generatedAt, actor: actor('stf-onb'), roles: ['onboarding'], can: staffCan('stf-onb'), current: 14 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const change = d.automationChanges.find((c) => c.id === r.changeId)!;
    expect(change).toMatchObject({ status: 'pending_approval', from: 14, to: 21 });
    const ap = d.approvals.find((a) => a.id === r.approvalId)!;
    expect(ap).toMatchObject({ kind: 'automation_config', status: 'pending', note: change.id, target: { type: 'automation', id: 'drivers.documents.expiry' } });
    expect(ap.approverRoles).toEqual(['owner', 'admin']);
  });

  it('refuses out-of-bounds values, duplicates and roles that do not own the workflow', () => {
    const d = createPlatformDataset();
    const ctx = { now: d.generatedAt, actor: actor('stf-onb'), roles: ['onboarding' as const], can: staffCan('stf-onb'), current: 14 };
    expect(proposeSettingChange(d, { automationId: 'drivers.documents.expiry', key: 'warnDays', to: 500, reason: 'x' }, ctx).ok).toBe(false);
    expect(proposeSettingChange(d, { automationId: 'drivers.documents.expiry', key: 'warnDays', to: 21, reason: '' }, ctx).ok).toBe(false);
    expect(proposeSettingChange(d, { automationId: 'support.escalate', key: 'urgentMinutes', to: 10, reason: 'x' }, ctx).ok).toBe(false);
    // The seeded data already has a pending change to this reminder.
    expect(proposeSettingChange(d, { automationId: 'subscription.reminder', key: 'dailyHoursBefore', to: 4, reason: 'x' }, { ...ctx, actor: actor('stf-dev'), roles: ['developer'], can: staffCan('stf-dev'), current: 2 }).ok).toBe(false);
  });

  it('audit filter keeps automation and payment configuration only', () => {
    expect(isAutomationAudit({ action: 'automation.run_retried', target: { type: 'automation_run', id: 'r', label: 'r' } })).toBe(true);
    expect(isAutomationAudit({ action: 'integration.credential_rotated', target: { type: 'integration', id: 'i', label: 'i' } })).toBe(true);
    expect(isAutomationAudit({ action: 'driver.rejected', target: { type: 'driver', id: 'd', label: 'd' } })).toBe(false);
  });
});
