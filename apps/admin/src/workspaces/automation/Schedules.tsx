import { useState } from 'react';
import { AUTOMATIONS, type AutomationDefinition, type AutomationRun } from '@gobye/core';
import { when } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Card, Empty, PageHead, Pill, Section, Stat, Table, type Column } from '@/ui/kit';
import { NotConnected, RunDrawer, RunStatusPill, RuntimePill, roleLabel } from './parts';
import { TRIGGER_LABEL, lastRun, nextQueued, runStart } from './logic';

/** Scheduled and timer-driven workflows. A next run is shown only when the (simulated) queue has one. */
export default function Schedules() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const [run, setRun] = useState<AutomationRun | null>(null);
  const scheduled = AUTOMATIONS.filter((a) => a.trigger.type === 'schedule');
  const timers = AUTOMATIONS.filter((a) => a.trigger.type === 'condition');

  const columns: Column<AutomationDefinition>[] = [
    {
      key: 'name',
      label: 'Workflow',
      sortValue: (a) => a.name,
      render: (a) => (
        <>
          <div className="cell-title">{a.name}</div>
          <div className="cell-sub">{a.trigger.schedule ? `${a.trigger.schedule} (Lagos time)` : a.trigger.source}</div>
        </>
      ),
    },
    { key: 'owner', label: 'Owner', sortValue: (a) => roleLabel(a.ownerRole), render: (a) => roleLabel(a.ownerRole) },
    {
      key: 'last',
      label: 'Last run',
      sortValue: (a) => { const l = lastRun(d.automationRuns, a.id); return l ? runStart(l) : 0; },
      render: (a) => {
        const l = lastRun(d.automationRuns, a.id);
        return l ? (
          <button className="btn ghost sm" onClick={(e) => (e.stopPropagation(), setRun(l))}>
            <RunStatusPill status={l.status} /> <span className="small muted">{when(runStart(l), t)}</span>
          </button>
        ) : (
          <span className="muted">No runs</span>
        );
      },
    },
    {
      key: 'next',
      label: 'Next run',
      render: (a) => {
        const n = nextQueued(d.automationRuns, a.id);
        return n ? (
          <span>
            <Pill tone="neutral" icon="time">{n.status === 'retry_scheduled' ? 'Retry' : 'Queued'}</Pill> <span className="small">{when(n.nextAttemptAt ?? n.queuedAt, t)}</span>
          </span>
        ) : (
          <span className="muted small">Not scheduled: no job runner</span>
        );
      },
    },
    { key: 'rt', label: 'Runtime', render: () => <RuntimePill /> },
  ];

  return (
    <>
      <PageHead eyebrow="Automation" title="Scheduled jobs" sub="Workflows that run on a timetable or when a timer runs out. Times are Lagos time." />
      <div className="auto-top">
        <NotConnected />
        <div className="grid cols-4">
          <Stat icon="calendar" label="On a timetable" value={scheduled.length} />
          <Stat icon="time" label="Timer driven" value={timers.length} sub="Booking and offer expiry, alerts" />
          <Stat icon="list" label="Queued (simulated)" value={d.automationRuns.filter((r) => r.status === 'queued').length} />
          <Stat icon="refresh" tone="warning" label="Waiting to retry" value={d.automationRuns.filter((r) => r.status === 'retry_scheduled').length} />
        </div>
      </div>
      <Section title="On a timetable" desc="The schedule is the contract for the backend. Nothing runs it yet, so no next time is shown unless a run is already queued.">
        <Card flush>
          <Table rows={scheduled} columns={columns} rowKey={(a) => a.id} empty={<Empty title="No scheduled workflows" />} />
        </Card>
      </Section>
      <Section title="Timers and conditions" desc="Started by a record’s own timer (a booking searching too long, an offer expiring) or a health condition.">
        <Card flush>
          <Table rows={timers} columns={columns.map((c) => (c.key === 'name' ? { ...c, render: (a: AutomationDefinition) => (<><div className="cell-title">{a.name}</div><div className="cell-sub">{TRIGGER_LABEL[a.trigger.type]}: {a.trigger.conditions[0]}</div></>) } : c))} rowKey={(a) => a.id} />
        </Card>
      </Section>
      {run ? <RunDrawer run={run} onClose={() => setRun(null)} /> : null}
    </>
  );
}
