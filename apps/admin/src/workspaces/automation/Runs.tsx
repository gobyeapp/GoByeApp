import { useMemo, useState } from 'react';
import { AREA_LABEL, AUTOMATIONS, automationById, runSummary, type AutomationArea, type AutomationRun, type RunStatus } from '@gobye/core';
import { when } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Button, Card, Empty, FilterBar, PageHead, SearchInput, Select, Stat, Table, type Column } from '@/ui/kit';
import { NotConnected, RunDrawer, RunStatusPill } from './parts';
import { AUTOMATION_OPTIONS, RUN_STATUS, durationText, filterRuns, runDuration, runStart, type RunFilter } from './logic';

const ALL: RunFilter = { automationId: 'all', status: 'all', area: 'all', q: '' };

export default function Runs() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const [f, setF] = useState<RunFilter>(ALL);
  const [open, setOpen] = useState<AutomationRun | null>(null);
  const rows = useMemo(() => filterRuns(d.automationRuns, f).sort((a, b) => runStart(b) - runStart(a)), [d.automationRuns, f]);
  const s = runSummary(d.automationRuns);
  const set = (p: Partial<RunFilter>) => setF((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(f) !== JSON.stringify(ALL);

  const columns: Column<AutomationRun>[] = [
    { key: 'at', label: 'Started', sortValue: runStart, render: (r) => <span className="num">{when(runStart(r), t)}</span> },
    {
      key: 'auto',
      label: 'Workflow',
      sortValue: (r) => automationById(r.automationId)?.name ?? r.automationId,
      render: (r) => (
        <>
          <div className="cell-title">{automationById(r.automationId)?.name ?? r.automationId}</div>
          <div className="cell-sub">{r.subject?.label ?? r.triggeredBy.ref}</div>
        </>
      ),
    },
    { key: 'st', label: 'Status', sortValue: (r) => r.status, render: (r) => <RunStatusPill status={r.status} /> },
    { key: 'att', label: 'Attempts', align: 'right', sortValue: (r) => r.attempts.length, render: (r) => r.attempts.length },
    { key: 'dur', label: 'Duration', align: 'right', sortValue: (r) => runDuration(r) ?? -1, render: (r) => durationText(runDuration(r)) },
    { key: 'key', label: 'Idempotency key', render: (r) => <span className="auto-cell-key">{r.idempotencyKey}</span> },
  ];

  return (
    <>
      <PageHead eyebrow="Automation" title="Execution history" sub="Every run, its attempts and what happened. Simulated test data until a job runner is connected." />
      <div className="auto-top">
        <NotConnected />
        <div className="grid cols-4">
          <Stat icon="history" label="Runs" value={s.total} sub={`${s.queued} queued or running`} />
          <Stat icon="checkCircle" label="Succeeded" value={s.succeeded} onClick={() => set({ status: 'succeeded' })} />
          <Stat icon="refresh" tone={s.retrying ? 'warning' : undefined} label="Retrying" value={s.retrying} onClick={() => set({ status: 'retry_scheduled' })} />
          <Stat icon="alert" tone={s.failed + s.needsLookup ? 'danger' : undefined} label="Need a person" value={s.failed + s.needsLookup} sub={`${s.needsLookup} with an unknown result`} onClick={() => set({ status: s.needsLookup ? 'needs_lookup' : 'failed' })} />
        </div>
      </div>
      <FilterBar count={`${rows.length} runs`} end={dirty ? <Button size="sm" variant="ghost" icon="close" onClick={() => setF(ALL)}>Clear filters</Button> : undefined}>
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Search subject, key or run" />
        <Select label="Workflow" value={f.automationId} onChange={(v) => set({ automationId: v })} options={[{ value: 'all', label: 'All workflows' }, ...AUTOMATION_OPTIONS]} />
        <Select<RunStatus | 'all'> label="Status" value={f.status} onChange={(v) => set({ status: v })} options={[{ value: 'all', label: 'Any status' }, ...(Object.keys(RUN_STATUS) as RunStatus[]).map((k) => ({ value: k, label: RUN_STATUS[k].text }))]} />
        <Select<AutomationArea | 'all'> label="Area" value={f.area} onChange={(v) => set({ area: v })} options={[{ value: 'all', label: 'All areas' }, ...(Object.keys(AREA_LABEL) as AutomationArea[]).map((a) => ({ value: a, label: AREA_LABEL[a] }))]} />
      </FilterBar>
      <Card flush>
        <Table rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={setOpen} pageSize={25} caption="Automation runs" empty={<Empty title="No runs match" icon="search">{AUTOMATIONS.length} workflows are defined; try clearing the filters.</Empty>} />
      </Card>
      {open ? <RunDrawer run={d.automationRuns.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
