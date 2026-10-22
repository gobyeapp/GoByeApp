import { useState } from 'react';
import type { AuditEvent, RecordType } from '@gobye/core';
import { downloadCsv, initials, label, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { RANGE_MS, useFilters, useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, Empty, PageHead, Pill, SearchInput, Select } from '@/ui/kit';
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
  const t = now();
  const inRange = d.audit.filter((e) => t - e.at <= RANGE_MS[range]);
  const rows = filterAudit(inRange, { q, actor, type });
  const actors = auditActors(d.audit);
  const filtered = q || actor !== 'all' || type !== 'all';

  return (
    <>
      <PageHead
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
      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search action, record, summary or reason" />
        <Select label="Actor" value={actor} onChange={(v) => { setActor(v); setShown(PAGE); }} options={[{ value: 'all', label: 'Everyone' }, ...actors]} />
        <Select<RecordType | 'all'> label="Record type" value={type} onChange={(v) => { setType(v); setShown(PAGE); }} options={[{ value: 'all', label: 'All records' }, ...TYPES.map((x) => ({ value: x, label: label(x) }))]} />
        {filtered ? <Button size="sm" variant="ghost" onClick={() => { setQ(''); setActor('all'); setType('all'); }}>Clear filters</Button> : null}
        <span className="muted small">{rows.length} {rows.length === 1 ? 'entry' : 'entries'} · date range applies</span>
      </div>
      {rows.length ? (
        <Card flush>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.slice(0, shown).map((e, i) => (
              <AuditRow key={e.id} e={e} first={i === 0} now={t} />
            ))}
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
    </>
  );
}

function Target({ e }: { e: AuditEvent }) {
  const { type, id, label: name } = e.target;
  if (type === 'trip' || type === 'passenger' || type === 'driver') return <RecordLink type={type} id={id}>{name}</RecordLink>;
  return <span className="strong">{name}</span>;
}

function AuditRow({ e, first, now }: { e: AuditEvent; first: boolean; now: number }) {
  return (
    <li className="row" style={{ alignItems: 'flex-start', padding: '14px 16px', borderTop: first ? undefined : '1px solid var(--border)', gap: 12 }}>
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
    </li>
  );
}
