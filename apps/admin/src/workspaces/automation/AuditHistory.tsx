import { useMemo, useState } from 'react';
import type { ApprovalRequest, AuditEvent } from '@gobye/core';
import { when } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Card, Drawer, Empty, FilterBar, KV, PageHead, Pill, SearchInput, Section, Select, Stat, Table, type Column, type Tone } from '@/ui/kit';
import { NotConnected } from './parts';
import { automationAudit, relevantApprovals } from './logic';

type Area = 'all' | 'automation' | 'fees' | 'providers';
const areaOf = (e: AuditEvent): Exclude<Area, 'all'> => (e.action.startsWith('fee') || e.target.type === 'fee_schedule' ? 'fees' : e.action.startsWith('automation') || e.target.type === 'automation' || e.target.type === 'automation_run' ? 'automation' : 'providers');
const AREA_TEXT: Record<Exclude<Area, 'all'>, string> = { automation: 'Automation', fees: 'Fees', providers: 'Payment providers' };
const APPROVAL: Record<ApprovalRequest['status'], { tone: Tone; text: string }> = { pending: { tone: 'warning', text: 'Pending' }, approved: { tone: 'success', text: 'Approved' }, rejected: { tone: 'neutral', text: 'Rejected' } };
const KIND: Partial<Record<ApprovalRequest['kind'], string>> = { automation_config: 'Automation setting', fee_schedule: 'Fee schedule', payments_activation: 'Payments activation' };

export default function AuditHistory() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const [q, setQ] = useState('');
  const [area, setArea] = useState<Area>('all');
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const all = useMemo(() => automationAudit(d), [d]);
  const rows = all.filter((e) => (area === 'all' || areaOf(e) === area) && (!q.trim() || `${e.summary} ${e.action} ${e.actor.name} ${e.target.label} ${e.reason ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const approvals = relevantApprovals(d);

  const columns: Column<AuditEvent>[] = [
    { key: 'at', label: 'When', sortValue: (e) => e.at, render: (e) => <span className="num">{when(e.at, t)}</span> },
    { key: 'what', label: 'What happened', sortValue: (e) => e.summary, render: (e) => (<><div className="cell-title">{e.summary}</div><div className="cell-sub">{e.target.label}</div></>) },
    { key: 'area', label: 'Area', sortValue: (e) => areaOf(e), render: (e) => <Pill tone="neutral" icon={null}>{AREA_TEXT[areaOf(e)]}</Pill> },
    { key: 'who', label: 'By', sortValue: (e) => e.actor.name, render: (e) => e.actor.name },
  ];
  const apCols: Column<ApprovalRequest>[] = [
    { key: 'at', label: 'Requested', sortValue: (a) => a.requestedAt, render: (a) => <span className="num">{when(a.requestedAt, t)}</span> },
    { key: 'title', label: 'Request', render: (a) => (<><div className="cell-title">{a.title}</div><div className="cell-sub">{KIND[a.kind] ?? a.kind} · asked by {a.requestedBy.name}</div></>) },
    { key: 'st', label: 'Status', sortValue: (a) => a.status, render: (a) => (<><Pill tone={APPROVAL[a.status].tone}>{APPROVAL[a.status].text}</Pill>{a.decidedBy ? <div className="cell-sub">{a.decidedBy.name}, {when(a.decidedAt, t)}</div> : null}</>) },
  ];

  return (
    <>
      <PageHead eyebrow="Automation" title="Audit history" sub="Who changed automation settings, fees and payment providers, and who acted on automation runs. Nothing here can be edited." />
      <div className="auto-top">
        <NotConnected />
        <div className="grid cols-4">
          <Stat icon="fileCheck" label="Recorded changes" value={all.length} />
          <Stat icon="layout" label="Automation" value={all.filter((e) => areaOf(e) === 'automation').length} onClick={() => setArea('automation')} />
          <Stat icon="ticket" label="Fees" value={all.filter((e) => areaOf(e) === 'fees').length} onClick={() => setArea('fees')} />
          <Stat icon="bank" label="Payment providers" value={all.filter((e) => areaOf(e) === 'providers').length} onClick={() => setArea('providers')} />
        </div>
      </div>
      <Section title="Changes">
        <FilterBar count={`${rows.length} of ${all.length}`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search changes, people or reasons" />
          <Select<Area> label="Area" value={area} onChange={setArea} options={[{ value: 'all', label: 'All areas' }, { value: 'automation', label: 'Automation' }, { value: 'fees', label: 'Fees' }, { value: 'providers', label: 'Payment providers' }]} />
        </FilterBar>
        <Card flush>
          <Table rows={rows} columns={columns} rowKey={(e) => e.id} onRowClick={setOpen} pageSize={25} empty={<Empty title="No changes recorded" icon="fileCheck">Changes to automation settings, fees and providers appear here.</Empty>} />
        </Card>
      </Section>
      <Section title="Approvals" desc="Automation settings, fee schedules and provider activation all need a second person.">
        <Card flush>
          <Table rows={approvals} columns={apCols} rowKey={(a) => a.id} pageSize={15} empty={<Empty title="No approvals yet" icon="checkCircle" />} />
        </Card>
      </Section>
      {open ? (
        <Drawer title={open.summary} sub={`${when(open.at, t)} · ${open.actor.name}`} onClose={() => setOpen(null)}>
          <KV items={[['Action', <code key="a">{open.action}</code>], ['Record', open.target.label], ['By', open.actor.name], ['When', when(open.at, t)], ['Reason', open.reason ?? 'None given']]} />
          {open.diff?.length ? (
            <Table rows={open.diff} rowKey={(x) => x.field} columns={[{ key: 'f', label: 'Field', render: (x) => x.field }, { key: 'from', label: 'Before', render: (x) => x.from }, { key: 'to', label: 'After', render: (x) => x.to }]} />
          ) : (
            <div className="small muted">No field changes recorded.</div>
          )}
        </Drawer>
      ) : null}
    </>
  );
}
