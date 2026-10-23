import { useState } from 'react';
import { automationById, manualActionCheck, type AutomationRun, type RunStatus } from '@gobye/core';
import { when } from '@/data/format';
import { useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Button, Card, Empty, Notice, PageHead, Stat, Table, type Column } from '@/ui/kit';
import { NotConnected, RunDrawer, RunStatusPill } from './parts';
import { FAILURE_LABEL, failedQueue, runStart } from './logic';

const GROUPS: { status: RunStatus; title: string; desc: string }[] = [
  { status: 'needs_lookup', title: 'Unknown result: look up first', desc: 'The request may have reached the provider. Ask the provider by reference. Never retry these.' },
  { status: 'failed', title: 'Failed: needs a person', desc: 'Out of automatic attempts, or a permanent error. Fix the cause, then retry with the same reference.' },
  { status: 'retry_scheduled', title: 'Retrying automatically', desc: 'Temporary errors. The next attempt is already scheduled with backoff.' },
];

export default function Failed() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const [open, setOpen] = useState<AutomationRun | null>(null);
  const queue = failedQueue(d.automationRuns);
  const count = (s: RunStatus) => queue.filter((r) => r.status === s).length;

  const columns: Column<AutomationRun>[] = [
    {
      key: 'auto',
      label: 'Workflow',
      sortValue: (r) => automationById(r.automationId)?.name ?? '',
      render: (r) => (
        <>
          <div className="cell-title">{automationById(r.automationId)?.name ?? r.automationId}</div>
          <div className="cell-sub">{r.subject?.label ?? r.triggeredBy.ref}</div>
        </>
      ),
    },
    {
      key: 'err',
      label: 'Last error',
      render: (r) => {
        const f = r.attempts.at(-1)?.failure;
        return f ? (
          <>
            <div className="small strong">{FAILURE_LABEL[f.class] ?? f.class}</div>
            <div className="cell-sub">{f.message}</div>
          </>
        ) : (
          <span className="muted">None recorded</span>
        );
      },
    },
    { key: 'st', label: 'Status', render: (r) => <RunStatusPill status={r.status} /> },
    { key: 'at', label: 'When', sortValue: runStart, render: (r) => <span className="num small">{when(r.nextAttemptAt ?? runStart(r), t)}</span> },
    {
      key: 'act',
      label: 'Next step',
      render: (r) => {
        const primary = r.status === 'needs_lookup' ? 'lookup' : 'retry';
        const c = manualActionCheck(r, primary, can);
        return r.handledBy ? (
          <span className="small muted">{r.handledBy.action.replace('_', ' ')} by {r.handledBy.name}</span>
        ) : (
          <Button size="sm" variant={primary === 'lookup' ? 'secondary' : 'primary'} icon={primary === 'lookup' ? 'search' : 'refresh'} disabledReason={c.allowed ? undefined : c.message} onClick={() => setOpen(r)}>
            {primary === 'lookup' ? 'Look up' : 'Retry'}
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <PageHead eyebrow="Automation" title="Failed jobs" sub="Runs that need a person, unknown results first. Retries reuse the same idempotency key; successful runs are never replayed." />
      <div className="auto-top">
        <NotConnected />
        <div className="grid cols-4">
          <Stat icon="search" tone={count('needs_lookup') ? 'danger' : undefined} label="Unknown result" value={count('needs_lookup')} sub="Look up, never retry" />
          <Stat icon="alert" tone={count('failed') ? 'danger' : undefined} label="Failed" value={count('failed')} sub="Fix the cause, then retry" />
          <Stat icon="refresh" tone={count('retry_scheduled') ? 'warning' : undefined} label="Retrying" value={count('retry_scheduled')} sub="Automatic, with backoff" />
          <Stat icon="checkCircle" label="Handled" value={queue.filter((r) => r.handledBy).length} sub="Someone acted on it" />
        </div>
        {!can('automation.retry') ? <Notice icon="lock">Read only for your role. Retrying, looking up or cancelling runs needs automation retry access (developer or finance).</Notice> : null}
      </div>
      {queue.length ? (
        GROUPS.filter((g) => count(g.status)).map((g) => (
          <section key={g.status} aria-label={g.title}>
            <div className="auto-queue-head">
              <h2>{g.title}</h2>
              <RunStatusPill status={g.status} />
            </div>
            <p className="small muted" style={{ marginBottom: 10 }}>{g.desc}</p>
            <Card flush>
              <Table rows={queue.filter((r) => r.status === g.status)} columns={columns} rowKey={(r) => r.id} onRowClick={setOpen} pageSize={25} />
            </Card>
          </section>
        ))
      ) : (
        <Card>
          <Empty title="Nothing has failed" icon="checkCircle">Every simulated run finished or is still queued.</Empty>
        </Card>
      )}
      {open ? <RunDrawer run={d.automationRuns.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
