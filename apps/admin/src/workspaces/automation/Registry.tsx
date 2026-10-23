import { useMemo, useState } from 'react';
import { AREA_LABEL, AUTOMATIONS, consecutiveFailures, type AutomationArea, type AutomationDefinition } from '@gobye/core';
import { when } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Drawer, Empty, FilterBar, PageHead, Pill, SearchInput, Section, Select, Stat, Table, type Column } from '@/ui/kit';
import { DefinitionFacts, NotConnected, RunDrawer, RunStatusPill, RuntimePill, StepList, roleLabel } from './parts';
import { TRIGGER_LABEL, durationText, lastRun, runDuration, runStart, runsFor } from './logic';
import type { AutomationRun } from '@gobye/core';

const AREAS = Object.keys(AREA_LABEL) as AutomationArea[];

export default function Registry() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const [q, setQ] = useState('');
  const [area, setArea] = useState<AutomationArea | 'all'>('all');
  const [open, setOpen] = useState<AutomationDefinition | null>(null);
  const [run, setRun] = useState<AutomationRun | null>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return AUTOMATIONS.filter((a) => (area === 'all' || a.area === area) && (!s || `${a.name} ${a.purpose} ${a.id} ${a.trigger.source}`.toLowerCase().includes(s)));
  }, [q, area]);
  const failing = AUTOMATIONS.filter((a) => consecutiveFailures(d.automationRuns, a.id) > 0).length;

  return (
    <>
      <PageHead eyebrow="Automation" title="Workflow registry" sub="Every background process GoBye relies on: how it starts, what it does on the server, how it retries and who is told when it fails." />
      <div className="auto-top">
        <NotConnected />
        <div className="grid cols-4">
          <Stat icon="layout" label="Workflows defined" value={AUTOMATIONS.length} sub="All run on GoBye servers only" />
          <Stat icon="wallet" label="Move money" value={AUTOMATIONS.filter((a) => a.financial).length} sub="Durable, idempotent, reconciled" />
          <Stat icon="calendar" label="On a schedule" value={AUTOMATIONS.filter((a) => a.trigger.type === 'schedule').length} sub="Plus event, webhook and timer triggers" />
          <Stat icon="alert" tone={failing ? 'danger' : undefined} label="Failing now" value={failing} sub="Last run failed (simulated history)" />
        </div>
      </div>

      <Section title="Workflows">
        <FilterBar count={`${shown.length} of ${AUTOMATIONS.length}`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search workflows" />
          <Select<AutomationArea | 'all'> label="Area" value={area} onChange={setArea} options={[{ value: 'all', label: 'All areas' }, ...AREAS.map((a) => ({ value: a, label: AREA_LABEL[a] }))]} />
        </FilterBar>
        {shown.length ? (
          AREAS.filter((a) => shown.some((x) => x.area === a)).map((a) => (
            <div key={a} style={{ marginBottom: 24 }}>
              <h3 className="small strong muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{AREA_LABEL[a]}</h3>
              <div className="auto-grid">
                {shown.filter((x) => x.area === a).map((def) => {
                  const last = lastRun(d.automationRuns, def.id);
                  const fails = consecutiveFailures(d.automationRuns, def.id);
                  return (
                    <button key={def.id} className="card auto-card" onClick={() => setOpen(def)} aria-label={`${def.name}: details`}>
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <span className="auto-name" style={{ flex: 1 }}>{def.name}</span>
                        <RuntimePill />
                      </div>
                      <span className="auto-purpose">{def.purpose}</span>
                      <span className="auto-meta">
                        <Pill tone="info" icon={def.trigger.type === 'schedule' ? 'calendar' : def.trigger.type === 'webhook' ? 'webhook' : def.trigger.type === 'event' ? 'link' : 'time'}>{TRIGGER_LABEL[def.trigger.type]}</Pill>
                        {def.financial ? <Pill tone="brand" icon="wallet">Moves money</Pill> : null}
                        {fails ? <Pill tone="danger">{fails} failed in a row</Pill> : null}
                      </span>
                      <span className="auto-foot">
                        <span>Owner: {roleLabel(def.ownerRole)}</span>
                        <span>Retries: {def.retry.maxAttempts <= 1 ? 'none' : def.retry.maxAttempts - 1}</span>
                        <span>Timeout: {durationText(def.timeoutMs)}</span>
                        <span>Last run: {last ? `${last.status === 'succeeded' ? 'succeeded' : last.status.replace('_', ' ')}, ${when(runStart(last), t)}` : 'none'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <Empty title="No workflows match" icon="search">Try another search or area.</Empty>
        )}
      </Section>

      {open ? <DefinitionDrawer def={open} onClose={() => setOpen(null)} onRun={setRun} /> : null}
      {run ? <RunDrawer run={run} onClose={() => setRun(null)} /> : null}
    </>
  );
}

function DefinitionDrawer({ def, onClose, onRun }: { def: AutomationDefinition; onClose: () => void; onRun: (r: AutomationRun) => void }) {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const recent = runsFor(d.automationRuns, def.id).sort((a, b) => runStart(b) - runStart(a)).slice(0, 8);
  const cols: Column<AutomationRun>[] = [
    { key: 'at', label: 'Started', render: (r) => when(runStart(r), t) },
    { key: 'sub', label: 'Subject', render: (r) => r.subject?.label ?? 'None' },
    { key: 'st', label: 'Status', render: (r) => <RunStatusPill status={r.status} /> },
    { key: 'dur', label: 'Duration', align: 'right', render: (r) => durationText(runDuration(r)) },
  ];
  return (
    <Drawer title={def.name} sub={def.purpose} onClose={onClose}>
      <DefinitionFacts def={def} />
      <StepList title="Starts when" items={def.trigger.conditions} />
      <StepList title="What the server does" items={def.action} />
      {def.rules.length ? <StepList title="Rules" items={def.rules} /> : null}
      {def.params.length ? <StepList title="Settings staff can change (with approval)" items={def.params.map((p) => `${p.label}: ${p.value}${p.confirmed ? '' : ' (placeholder)'}`)} /> : null}
      <div className="stack">
        <h3 className="small strong">Recent runs (simulated)</h3>
        <Table rows={recent} columns={cols} rowKey={(r) => r.id} onRowClick={(r) => (onClose(), onRun(r))} empty={<Empty title="No runs yet" icon="history" />} />
      </div>
    </Drawer>
  );
}
