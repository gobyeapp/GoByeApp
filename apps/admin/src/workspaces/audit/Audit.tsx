import { useState } from 'react';
import type { AuditEvent, RecordType } from '@gobye/core';
import { date, downloadCsv, initials, label, lagosDay, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { RANGE_MS, useFilters, useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, Drawer, Empty, FilterBar, KV, PageHead, Pill, SearchInput, Segmented, Select, Table, type Column } from '@/ui/kit';
import { actorLabel, auditActors, auditCsvRows, filterAudit } from './logic';

const TYPES: RecordType[] = ['approval', 'announcement', 'campaign', 'case', 'collection', 'config', 'driver', 'event', 'integration', 'ledger_entry', 'package', 'passenger', 'refund', 'staff', 'trip', 'withdrawal'];
const PAGE = 40;

export default function Audit() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const { range } = useFilters();
  const [q, setQ] = useState('');
  const [actor, setActor] = useState('all');
  const [type, setType] = useState<RecordType | 'all'>('all');
  const [shown, setShown] = useState(PAGE);
  const [view, setView] = useState<'timeline' | 'table'>('timeline');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? d.audit.find((e) => e.id === openId) : undefined;
  const t = now();
  const inRange = d.audit.filter((e) => t - e.at <= RANGE_MS[range]);
  const rows = filterAudit(inRange, { q, actor, type });
  const actors = auditActors(d.audit);
  const filtered = q || actor !== 'all' || type !== 'all';

  return (
    <>
      <PageHead
        eyebrow="Administration"
        title="Activity and audit"
        sub="Every change, who made it, when and why. Read only: entries can’t be edited or deleted."
        actions={
          can('reports.export') ? (
            <Button icon="download" onClick={() => downloadCsv(`gobye-audit-test-data-${new Date(t).toISOString().slice(0, 10)}.csv`, auditCsvRows(rows))} disabledReason={rows.length ? undefined : 'Nothing to export'}>
              Export CSV
            </Button>
          ) : null
        }
      />
      <FilterBar
        count={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · date range applies · Lagos time`}
        end={<Segmented label="View" value={view} onChange={setView} options={[{ value: 'timeline', label: 'Timeline' }, { value: 'table', label: 'Table' }]} />}
      >
        <SearchInput value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search action, record, summary or reason" />
        <Select label="Actor" value={actor} onChange={(v) => { setActor(v); setShown(PAGE); }} options={[{ value: 'all', label: 'Everyone' }, ...actors]} />
        <Select<RecordType | 'all'> label="Record type" value={type} onChange={(v) => { setType(v); setShown(PAGE); }} options={[{ value: 'all', label: 'All records' }, ...TYPES.map((x) => ({ value: x, label: label(x) }))]} />
        {filtered ? <Button size="sm" variant="ghost" icon="close" onClick={() => { setQ(''); setActor('all'); setType('all'); }}>Clear filters</Button> : null}
      </FilterBar>
      {rows.length && view === 'table' ? (
        <Card flush>
          <AuditTable rows={rows} now={t} onOpen={(e) => setOpenId(e.id)} />
        </Card>
      ) : rows.length ? (
        <Card flush>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.slice(0, shown).map((e, i, all) => {
              const day = lagosDay(e.at);
              const newDay = i === 0 || lagosDay(all[i - 1]!.at) !== day;
              return (
                <li key={e.id} style={{ listStyle: 'none' }}>
                  {newDay ? (
                    <div className="small strong muted" style={{ padding: '10px 16px', background: 'var(--muted)', borderTop: i ? '1px solid var(--border)' : undefined, borderBottom: '1px solid var(--border)' }}>
                      {day === lagosDay(t) ? 'Today' : day === lagosDay(t) - 1 ? 'Yesterday' : date(e.at)}
                    </div>
                  ) : null}
                  <AuditRow e={e} first={newDay} now={t} />
                </li>
              );
            })}
          </ol>
          {rows.length > shown ? (
            <div className="row" style={{ justifyContent: 'center', padding: 12, borderTop: '1px solid var(--border)' }}>
              <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card>
          <Empty title={filtered ? 'No entries match' : 'No activity in this period'} icon="history">
            {filtered ? 'Clear the filters or widen the date range.' : 'Changes made anywhere in the platform appear here.'}
          </Empty>
        </Card>
      )}
      {open ? <AuditDrawer e={open} now={t} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function AuditTable({ rows, now, onOpen }: { rows: AuditEvent[]; now: number; onOpen: (e: AuditEvent) => void }) {
  const columns: Column<AuditEvent>[] = [
    { key: 'at', label: 'When', sortValue: (e) => e.at, render: (e) => <span className="num" style={{ whiteSpace: 'nowrap' }}>{when(e.at, now)}</span> },
    { key: 'actor', label: 'Who', sortValue: (e) => actorLabel(e.actor), render: (e) => actorLabel(e.actor) },
    { key: 'action', label: 'Action', sortValue: (e) => e.action, render: (e) => <Pill tone="neutral" icon={null}>{e.action}</Pill> },
    { key: 'record', label: 'Record', sortValue: (e) => `${e.target.type} ${e.target.label}`, render: (e) => (<><div className="cell-title">{e.target.label}</div><div className="cell-sub">{label(e.target.type)}</div></>) },
    { key: 'summary', label: 'Summary', render: (e) => (<><div>{e.summary}</div>{e.reason ? <div className="cell-sub">Reason: {e.reason}</div> : null}</>) },
  ];
  return <Table rows={rows} columns={columns} rowKey={(e) => e.id} onRowClick={onOpen} pageSize={25} caption="Audit entries" />;
}

function AuditDrawer({ e, now, onClose }: { e: AuditEvent; now: number; onClose: () => void }) {
  return (
    <Drawer title={e.summary} sub={`${e.action} · ${when(e.at, now)}`} onClose={onClose}>
      <KV
        items={[
          ['Who', actorLabel(e.actor)],
          ['When', `${when(e.at, now)} (Lagos time)`],
          ['Action', e.action],
          ['Record', <Target e={e} />],
          ['Reason', e.reason ?? <span className="muted">None given</span>],
        ]}
      />
      {e.diff?.length ? (
        <div className="table-wrap card flush">
          <table className="table">
            <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {e.diff.map((x, i) => (
                <tr key={i}><td>{x.field}</td><td className="muted">{x.from}</td><td className="strong">{x.to}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="muted small row" style={{ gap: 6 }}><Icon name="lock" size={14} /> Audit entries are read only. They can’t be edited or deleted.</div>
    </Drawer>
  );
}

function Target({ e }: { e: AuditEvent }) {
  const { type, id, label: name } = e.target;
  if (type === 'trip' || type === 'passenger' || type === 'driver') return <RecordLink type={type} id={id}>{name}</RecordLink>;
  return <span className="strong">{name}</span>;
}

function AuditRow({ e, first, now }: { e: AuditEvent; first: boolean; now: number }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', padding: '14px 16px', borderTop: first ? undefined : '1px solid var(--border)', gap: 12 }}>
      <span className="avatar" aria-hidden>{e.actor.kind === 'staff' ? initials(e.actor.name) : <Icon name={e.actor.kind === 'provider' ? 'webhook' : e.actor.kind === 'system' ? 'server' : 'user'} size={16} />}</span>
      <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="strong">{actorLabel(e.actor)}</span>
          <Pill tone="neutral" icon={null}>{e.action}</Pill>
          <span className="muted small">{label(e.target.type)}:</span>
          <Target e={e} />
          <span className="muted small" style={{ marginLeft: 'auto' }}>{when(e.at, now)}</span>
        </div>
        <div>{e.summary}</div>
        {e.reason ? <div className="small"><span className="muted">Reason:</span> {e.reason}</div> : null}
        {e.diff?.length ? (
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="table">
              <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {e.diff.map((x, i) => (
                  <tr key={i}><td>{x.field}</td><td className="muted">{x.from}</td><td className="strong">{x.to}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
