import { useMemo, useState } from 'react';
import { AREA_LABEL, AUTOMATIONS, consecutiveFailures, type AutomationArea, type AutomationDefinition, type AutomationRun } from '@gobye/core';
import { label as nice, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Drawer, Empty, FeaturedStat, FilterBar, Notice, PageHead, Pill, SearchInput, Section, Select, Stat, Table, Tabs, type Column } from '@/ui/kit';
import { DefinitionFacts, NotConnected, RunDrawer, RunStatusPill, RuntimePill, StepList, roleLabel } from './parts';
import {
  AREA_ICON,
  HEALTH_META,
  TRIGGER_LABEL,
  auditForAutomation,
  durationText,
  isRestricted,
  lastRun,
  nextQueued,
  overviewCounts,
  retryText,
  runDuration,
  runStart,
  runsFor,
  valueText,
  workflowHealth,
} from './logic';

const AREAS = Object.keys(AREA_LABEL) as AutomationArea[];

/** Who may act on restricted (financial or safety) workflows: holders of automation retry access. */
const RESTRICTED_TO = 'Finance and developer roles';

export default function Registry() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const [q, setQ] = useState('');
  const [area, setArea] = useState<AutomationArea | 'all'>('all');
  const [open, setOpen] = useState<AutomationDefinition | null>(null);
  const [run, setRun] = useState<AutomationRun | null>(null);
  const c = overviewCounts(d.automationRuns);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return AUTOMATIONS.filter((a) => (area === 'all' || a.area === area) && (!s || `${a.name} ${a.purpose} ${a.id} ${a.trigger.source}`.toLowerCase().includes(s)));
  }, [q, area]);

  return (
    <>
      <PageHead eyebrow="Automation" title="Workflow registry" sub="Every background process GoBye relies on: how it starts, what it does on the server, how it retries and who is told when it fails." />
      <NotConnected />

      <div className="grid featured" style={{ marginTop: 20 }}>
        <FeaturedStat art="automation" label="Configured workflows" value={c.total} sub={<span>{c.healthy} healthy · run on GoBye servers only</span>} />
        <Stat icon="alert" tone={c.failed ? 'danger' : undefined} label="Failed executions" value={c.failed} sub="Waiting for a person (simulated)" />
        <Stat icon="refresh" tone={c.pending ? 'warning' : undefined} label="Pending jobs" value={c.pending} sub="Queued or retrying" />
        <Stat icon="calendar" label="Upcoming scheduled" value={c.upcoming} sub={c.upcoming ? 'From queued runs only' : 'Not scheduled: no job runner'} />
      </div>

      <Section title="Workflows" desc="Grouped by area. Money and safety workflows have restricted controls.">
        <FilterBar count={`${shown.length} of ${AUTOMATIONS.length}`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search workflows" />
          <Select<AutomationArea | 'all'> label="Area" value={area} onChange={setArea} options={[{ value: 'all', label: 'All areas' }, ...AREAS.map((a) => ({ value: a, label: AREA_LABEL[a] }))]} />
        </FilterBar>
        {shown.length ? (
          AREAS.filter((a) => shown.some((x) => x.area === a)).map((a) => (
            <div key={a} style={{ marginBottom: 28 }}>
              <h3 className="auto-area">{AREA_LABEL[a]}</h3>
              <div className="auto-grid">
                {shown.filter((x) => x.area === a).map((def) => (
                  <WorkflowCard key={def.id} def={def} runs={d.automationRuns} now={t} canAct={can('automation.retry')} onOpen={() => setOpen(def)} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <Empty title="No workflows match" art="automation">Try another search or area.</Empty>
        )}
      </Section>

      {open ? <DefinitionDrawer def={open} onClose={() => setOpen(null)} onRun={setRun} /> : null}
      {run ? <RunDrawer run={run} onClose={() => setRun(null)} /> : null}
    </>
  );
}

function WorkflowCard({ def, runs, now, canAct, onOpen }: { def: AutomationDefinition; runs: readonly AutomationRun[]; now: number; canAct: boolean; onOpen: () => void }) {
  const last = lastRun(runs, def.id);
  const next = nextQueued(runs, def.id);
  const health = HEALTH_META[workflowHealth(runs, def.id)];
  const restricted = isRestricted(def);
  return (
    <article className="card auto-card" aria-label={def.name}>
      <div className="auto-head">
        <span className="auto-ico"><Icon name={AREA_ICON[def.area]} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="auto-name">{def.name}</div>
          <div className="auto-purpose">{def.purpose}</div>
        </div>
      </div>
      <div className="auto-meta">
        <Pill tone={health.tone} icon={health.icon}>{health.text}</Pill>
        <RuntimePill />
        {def.financial ? <Pill tone="brand" icon="wallet">Moves money</Pill> : null}
      </div>
      <dl className="auto-facts">
        <dt>Trigger</dt>
        <dd>{TRIGGER_LABEL[def.trigger.type]}{def.trigger.schedule ? `: ${def.trigger.schedule}` : ''}</dd>
        <dt>Last run</dt>
        <dd>{last ? `${nice(last.status)}, ${when(runStart(last), now)}` : 'None yet'}</dd>
        <dt>Next run</dt>
        <dd>{next ? when(next.nextAttemptAt ?? next.queuedAt, now) : 'Not scheduled: no job runner'}</dd>
        <dt>Owner</dt>
        <dd>{roleLabel(def.ownerRole)}</dd>
      </dl>
      <div className="auto-foot" style={{ alignItems: 'center' }}>
        {restricted ? (
          <span className="auto-lock" title={`Retry, look up and cancel: ${RESTRICTED_TO}`}>
            <Icon name="lock" size={14} /> Restricted: {RESTRICTED_TO.toLowerCase()}
            {canAct ? null : ' (view only for you)'}
          </span>
        ) : (
          <span>{retryText(def)}</span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <Button size="sm" variant="secondary" iconEnd="right" onClick={onOpen}>
            Details
          </Button>
        </span>
      </div>
    </article>
  );
}

type Tab = 'overview' | 'history' | 'errors' | 'config' | 'audit';

function DefinitionDrawer({ def, onClose, onRun }: { def: AutomationDefinition; onClose: () => void; onRun: (r: AutomationRun) => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const [tab, setTab] = useState<Tab>('overview');
  const runs = runsFor(d.automationRuns, def.id).sort((a, b) => runStart(b) - runStart(a));
  const failures = runs.flatMap((r) => r.attempts.filter((a) => a.failure).map((a) => ({ run: r, attempt: a }))).slice(0, 12);
  const audit = auditForAutomation(d, def.id);
  const fails = consecutiveFailures(d.automationRuns, def.id);
  const cols: Column<AutomationRun>[] = [
    { key: 'at', label: 'Started', sortValue: runStart, render: (r) => when(runStart(r), t) },
    { key: 'sub', label: 'Subject', render: (r) => r.subject?.label ?? 'None' },
    { key: 'st', label: 'Status', render: (r) => <RunStatusPill status={r.status} /> },
    { key: 'dur', label: 'Duration', align: 'right', render: (r) => <span className="num">{durationText(runDuration(r))}</span> },
  ];
  return (
    <Drawer title={def.name} sub={def.purpose} onClose={onClose}>
      <div className="row wrap">
        <Pill tone={HEALTH_META[workflowHealth(d.automationRuns, def.id)].tone} icon={HEALTH_META[workflowHealth(d.automationRuns, def.id)].icon}>{HEALTH_META[workflowHealth(d.automationRuns, def.id)].text}</Pill>
        <RuntimePill />
        {fails ? <Pill tone="danger">{fails} failed in a row</Pill> : null}
      </div>
      {isRestricted(def) ? (
        <Notice tone="info" icon="lock">
          {def.financial ? 'Moves money or balances.' : 'Safety critical.'} Retry, look up and cancel are restricted to {RESTRICTED_TO.toLowerCase()}
          {can('automation.retry') ? '.' : '; you can view only.'}
        </Notice>
      ) : null}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'history', label: 'Execution history', count: runs.length },
          { value: 'errors', label: 'Errors', count: failures.length },
          { value: 'config', label: 'Configuration' },
          { value: 'audit', label: 'Audit', count: audit.length },
        ]}
      />
      {tab === 'overview' ? (
        <>
          <DefinitionFacts def={def} />
          <StepList title="Starts when" items={def.trigger.conditions} />
          <StepList title="What the server does" items={def.action} />
          {def.rules.length ? <StepList title="Rules" items={def.rules} /> : null}
        </>
      ) : null}
      {tab === 'history' ? (
        <Table rows={runs} columns={cols} rowKey={(r) => r.id} pageSize={10} onRowClick={(r) => (onClose(), onRun(r))} empty={<Empty title="No runs yet" icon="history">Runs appear here once the job runner is connected. This history is simulated.</Empty>} />
      ) : null}
      {tab === 'errors' ? (
        failures.length ? (
          <ol className="timeline">
            {failures.map(({ run, attempt }) => (
              <li key={`${run.id}-${attempt.n}`}>
                <div className="strong">{attempt.failure!.message}</div>
                <div className="when">
                  {when(attempt.startedAt, t)} · attempt {attempt.n} · <code>{attempt.failure!.code}</code> · {nice(attempt.failure!.class)}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty title="No errors recorded" icon="checkCircle">Every simulated run of this workflow finished without a failed attempt.</Empty>
        )
      ) : null}
      {tab === 'config' ? (
        <>
          <StepList title="Retry policy" items={[retryText(def), `Timeout: ${durationText(def.timeoutMs)}`, `Idempotency key: ${def.idempotencyKey}`]} />
          {def.params.length ? (
            <StepList title="Settings staff can change (with approval)" items={def.params.map((p) => `${p.label}: ${valueText(p.kind, p.value)}${p.confirmed ? '' : ' (placeholder)'}`)} />
          ) : (
            <div className="small muted">This workflow has no settings to change.</div>
          )}
        </>
      ) : null}
      {tab === 'audit' ? (
        audit.length ? (
          <ol className="timeline">
            {audit.map((e) => (
              <li key={e.id}>
                <div className="strong">{e.summary}</div>
                <div className="when">
                  {when(e.at, t)} · {e.actor.name}
                  {e.reason ? ` · ${e.reason}` : ''}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty title="No audit entries yet" icon="history">Setting changes and staff actions on runs are recorded here.</Empty>
        )
      ) : null}
    </Drawer>
  );
}
