import { useState, type ReactNode } from 'react';
import { ROLE_LABELS, automationById, manualActionCheck, type AutomationDefinition, type AutomationRun, type ManualAction } from '@gobye/core';
import { when } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, ConfirmDialog, Drawer, KV, Notice, Pill } from '@/ui/kit';
import { FAILURE_LABEL, MANUAL_LABEL, RUN_STATUS, TRIGGER_LABEL, applyManualAction, durationText, escalationText, retryText, runDuration, runStart } from './logic';
import './automation.css';

/** Shown at the top of every Automation Centre page. */
export function NotConnected() {
  return (
    <Notice tone="warning" icon="plugin">
      No job runner is connected yet. Definitions are the contract for the backend; run history is simulated test data.
    </Notice>
  );
}

export function RunStatusPill({ status }: { status: AutomationRun['status'] }) {
  const m = RUN_STATUS[status];
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {m.text}
    </Pill>
  );
}

export function RuntimePill() {
  return (
    <Pill tone="neutral" icon="plugin">
      Not connected
    </Pill>
  );
}

export const roleLabel = (r: keyof typeof ROLE_LABELS) => ROLE_LABELS[r];

export function DefinitionFacts({ def }: { def: AutomationDefinition }) {
  return (
    <KV
      items={[
        ['Trigger', `${TRIGGER_LABEL[def.trigger.type]}: ${def.trigger.source}`],
        ...(def.trigger.schedule ? ([['Schedule', `${def.trigger.schedule} (Lagos time)`]] as [string, ReactNode][]) : []),
        ['Runs on', 'GoBye servers only'],
        ['Money', def.financial ? 'Moves money or balances: durable, idempotent, reconciled' : 'No money moves'],
        ['Idempotency key', def.idempotencyKey],
        ['Retry policy', retryText(def)],
        ['Timeout', durationText(def.timeoutMs)],
        ['Escalation', escalationText(def, roleLabel)],
        ['Owner', roleLabel(def.ownerRole)],
        ['Manual retry', MANUAL_LABEL[def.manualRetry]],
        ['Runtime', <RuntimePill key="rt" />],
      ]}
    />
  );
}

export function StepList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="auto-steps">
      <h3 className="small strong">{title}</h3>
      <ol>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ol>
    </div>
  );
}

/** Run details with the protected actions. Buttons stay visible but disabled with the exact reason. */
export function RunDrawer({ run, onClose, actions = true }: { run: AutomationRun; onClose: () => void; actions?: boolean }) {
  const def = automationById(run.automationId);
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const [pending, setPending] = useState<ManualAction | null>(null);
  const t = now();
  const check = (a: ManualAction) => manualActionCheck(run, a, can);
  const LABEL: Record<ManualAction, string> = { retry: 'Retry', lookup: 'Look up result', cancel: 'Cancel' };
  const footer = actions ? (
    <>
      {(['lookup', 'retry', 'cancel'] as ManualAction[]).map((a) => {
        const c = check(a);
        return (
          <Button key={a} variant={a === 'retry' ? 'primary' : a === 'cancel' ? 'ghost' : 'secondary'} icon={a === 'retry' ? 'refresh' : a === 'lookup' ? 'search' : 'close'} disabledReason={c.allowed ? undefined : c.message} onClick={() => setPending(a)}>
            {LABEL[a]}
          </Button>
        );
      })}
    </>
  ) : undefined;

  return (
    <>
      <Drawer title={def?.name ?? run.automationId} sub={`${run.id} · ${run.subject?.label ?? 'No subject'}`} onClose={onClose} footer={footer}>
        <div className="row wrap">
          <RunStatusPill status={run.status} />
          {def?.financial ? <Pill tone="brand" icon="wallet">Moves money</Pill> : null}
          <Pill tone="neutral" icon="info">Simulated</Pill>
        </div>
        {run.status === 'needs_lookup' ? (
          <Notice tone="danger" icon="search">
            The result is unknown: the request may have reached the provider. Look it up by its reference before anything else. Retrying could pay or credit twice.
          </Notice>
        ) : null}
        {run.status === 'succeeded' ? <Notice tone="success">Finished successfully. Successful runs are never replayed; a new run only starts from a new event.</Notice> : null}
        <KV
          items={[
            ['Started by', `${run.triggeredBy.kind === 'staff_retry' ? `Staff retry by ${run.triggeredBy.staffName ?? 'staff'}` : run.triggeredBy.kind}: ${run.triggeredBy.ref}`],
            ['Idempotency key', <code key="k">{run.idempotencyKey}</code>],
            ['Queued', when(run.queuedAt, t)],
            ['Started', run.startedAt ? when(run.startedAt, t) : 'Not started'],
            ['Duration', durationText(runDuration(run))],
            ...(run.nextAttemptAt ? ([['Next attempt', when(run.nextAttemptAt, t)]] as [string, ReactNode][]) : []),
            ...(run.escalated ? ([['Escalated', `${when(run.escalated.at, t)} to ${run.escalated.toRoles.join(', ')}`]] as [string, ReactNode][]) : []),
            ...(run.handledBy ? ([['Handled by', `${run.handledBy.name}, ${when(run.handledBy.at, t)}: ${run.handledBy.action.replace('_', ' ')} (“${run.handledBy.reason}”)`]] as [string, ReactNode][]) : []),
          ]}
        />
        <div className="stack">
          <h3 className="small strong">Attempts</h3>
          {run.attempts.length ? (
            <ol className="timeline">
              {run.attempts.map((a) => (
                <li key={a.n}>
                  <div className="strong">
                    Attempt {a.n}: {a.outcome === 'succeeded' ? 'succeeded' : `failed (${FAILURE_LABEL[a.failure?.class ?? ''] ?? 'Unknown'})`}
                  </div>
                  <div className="when">
                    {when(a.startedAt, t)} · {durationText(a.finishedAt ? a.finishedAt - a.startedAt : null)}
                  </div>
                  {a.failure ? (
                    <div className="small muted">
                      <code>{a.failure.code}</code> {a.failure.message}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <div className="small muted">No attempts yet.</div>
          )}
        </div>
        {!can('automation.retry') && actions ? <Notice icon="lock">Read only for your role. Acting on runs needs automation retry access (developer or finance).</Notice> : null}
        <div className="small muted">Started {when(runStart(run), t)}. Times in Lagos time.</div>
      </Drawer>
      {pending ? (
        <ConfirmDialog
          title={pending === 'retry' ? 'Retry this run' : pending === 'lookup' ? 'Look up the result' : 'Cancel this run'}
          body={
            <>
              <p>{check(pending).message}</p>
              {pending === 'lookup' ? <p style={{ marginTop: 8 }}>This prototype can’t reach a provider, so the request is recorded only.</p> : null}
              {pending === 'retry' ? <p style={{ marginTop: 8 }}>This prototype queues a new simulated run; nothing runs on a server.</p> : null}
            </>
          }
          confirmLabel={LABEL[pending]}
          danger={pending === 'cancel'}
          requireReason
          onCancel={() => setPending(null)}
          onConfirm={async (reason) => {
            const a = pending;
            const r = await act({
              label: `${LABEL[a]} ${run.id}`,
              apply: (draft, ctx) => applyManualAction(draft, run.id, a, { ...ctx, reason, can }),
              audit: () => ({ action: `automation.run_${a === 'lookup' ? 'lookup_requested' : a === 'retry' ? 'retried' : 'cancelled'}`, target: { type: 'automation_run', id: run.id, label: `${def?.name ?? run.automationId} ${run.id}` }, summary: `${LABEL[a]}: ${def?.name ?? run.automationId} (${run.idempotencyKey})`, reason }),
            });
            setPending(null);
            if (r.ok) onClose();
          }}
        />
      ) : null}
    </>
  );
}

export function SectionIcon({ name }: { name: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <span className="auto-ico">
      <Icon name={name} size={16} />
    </span>
  );
}
