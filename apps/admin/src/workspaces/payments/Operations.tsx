import { useMemo, useState } from 'react';
import { count, label, money, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { useData, usePlatform } from '@/data/store';
import { Card, Drawer, Empty, FilterBar, KV, Notice, PageHead, Pill, SearchInput, Section, Select, Stat, Table, type Column } from '@/ui/kit';
import { COLLECTION_TONE, Rule, WITHDRAWAL_TONE } from '../finance/parts';
import { MOVEMENT_LABEL, movementRows, type MovementRow, type MovementType } from './model';
import './payments.css';

type TypeFilter = MovementType | 'all';
type StatusFilter = 'all' | 'pending' | 'done' | 'failed' | 'stuck';

const statusTone = (r: MovementRow) => (r.source === 'collection' ? COLLECTION_TONE[r.status as keyof typeof COLLECTION_TONE] : WITHDRAWAL_TONE[r.status as keyof typeof WITHDRAWAL_TONE]);
const DONE = ['successful'];
const FAILED = ['failed', 'abandoned', 'reversed', 'rejected'];
const amount = (v: number | null) => (v === null ? <span className="muted">Not yet</span> : <span className="num">{money(v)}</span>);

export default function Operations() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const rows = useMemo(() => movementRows(d, t), [d, t]);
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<MovementRow | null>(null);

  const shown = rows.filter((r) => {
    if (type !== 'all' && r.type !== type) return false;
    if (status === 'stuck' && !r.stuck) return false;
    if (status === 'done' && !DONE.includes(r.status)) return false;
    if (status === 'failed' && !FAILED.includes(r.status)) return false;
    if (status === 'pending' && (DONE.includes(r.status) || FAILED.includes(r.status))) return false;
    const s = q.trim().toLowerCase();
    return !s || r.reference.toLowerCase().includes(s) || r.id.toLowerCase().includes(s) || r.personId.toLowerCase().includes(s);
  });
  const stuck = rows.filter((r) => r.stuck).length;
  const done = rows.filter((r) => DONE.includes(r.status));
  const providerCharges = done.reduce((s, r) => s + (r.providerCharge ?? 0), 0);

  const columns: Column<MovementRow>[] = [
    {
      key: 'what',
      label: 'Payment',
      render: (r) => (
        <div>
          <div className="cell-title">{MOVEMENT_LABEL[r.type]}</div>
          <div className="cell-sub">{r.reference}</div>
        </div>
      ),
      sortValue: (r) => r.type,
    },
    { key: 'status', label: 'Status', render: (r) => <span className="row" style={{ gap: 6 }}><Pill tone={statusTone(r)}>{label(r.status)}</Pill>{r.stuck ? <Pill tone="danger" icon="time">Stuck</Pill> : null}</span>, sortValue: (r) => r.status },
    { key: 'gross', label: 'Gross', align: 'right', render: (r) => amount(r.gross), sortValue: (r) => r.gross },
    { key: 'pc', label: 'Provider charge', align: 'right', render: (r) => amount(r.providerCharge), sortValue: (r) => r.providerCharge ?? -1 },
    { key: 'fee', label: 'GoBye fee', align: 'right', render: () => <span className="num">₦0</span> },
    { key: 'mv', label: 'Wallet or earnings', align: 'right', render: (r) => (r.movement === null ? <span className="muted">No movement</span> : <span className="num">{r.movement < 0 ? `minus ${money(-r.movement)}` : money(r.movement)}</span>), sortValue: (r) => r.movement ?? 0 },
    { key: 'st', label: 'Settlement', align: 'right', render: (r) => amount(r.settlement), sortValue: (r) => r.settlement ?? -1 },
    { key: 'at', label: 'Started', render: (r) => when(r.at, t), sortValue: (r) => r.at },
  ];

  return (
    <>
      <PageHead
        eyebrow="Payments"
        title="Payment operations"
        sub="Every payment in and payout out, with each figure kept apart: gross, provider charge, GoBye fee, wallet or earnings movement and settlement."
        meta={<Pill tone="warning" icon="info">Test data · Paystack (test)</Pill>}
      />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="exchange" label="Payments and payouts" value={count(rows.length)} sub={`${count(done.length)} completed`} />
        <Stat icon="bill" label="Provider charges" value={money(providerCharges)} sub="On completed payments (test provider)" />
        <Stat icon="ticket" label="GoBye fees" value="₦0" sub="No fee schedule approved" />
        <Stat icon="time" label="Stuck" value={count(stuck)} sub="Pending over 30 minutes" tone={stuck ? 'danger' : undefined} onClick={stuck ? () => setStatus('stuck') : undefined} />
      </div>
      <Notice tone="info" icon="shield">
        A payment is credited only after the provider confirms it by lookup, once per reference. A payout is never sent twice: if its result is unknown, it is looked up by reference.
      </Notice>

      <Section title="Money movement">
        <FilterBar count={`${count(shown.length)} of ${count(rows.length)}`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search reference or id" />
          <Select<TypeFilter> label="Type" value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, ...(Object.keys(MOVEMENT_LABEL) as MovementType[]).map((k) => ({ value: k, label: MOVEMENT_LABEL[k] }))]} />
          <Select<StatusFilter>
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Any status' },
              { value: 'pending', label: 'In progress' },
              { value: 'done', label: 'Completed' },
              { value: 'failed', label: 'Failed or reversed' },
              { value: 'stuck', label: 'Stuck over 30 min' },
            ]}
          />
        </FilterBar>
        <Card flush>
          <Table rows={shown} columns={columns} rowKey={(r) => `${r.source}:${r.id}`} onRowClick={setOpen} pageSize={25} empty={<Empty title="No payments match" icon="exchange">Try another type or status.</Empty>} />
        </Card>
      </Section>

      {open ? <MovementDrawer row={open} now={t} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function MovementDrawer({ row, now, onClose }: { row: MovementRow; now: number; onClose: () => void }) {
  return (
    <Drawer title={MOVEMENT_LABEL[row.type]} sub={`${row.reference} · ${row.provider}`} onClose={onClose}>
      <div className="row wrap">
        <Pill tone={statusTone(row)}>{label(row.status)}</Pill>
        {row.stuck ? <Pill tone="danger" icon="time">Stuck</Pill> : null}
        <Pill tone="warning" icon="info">Test data</Pill>
      </div>
      <Card title="Breakdown">
        <dl className="breakdown">
          <dt>Gross {row.type === 'withdrawal' ? 'requested' : 'paid by the customer'}</dt>
          <dd>{money(row.gross)}</dd>
          <dt>Provider charge</dt>
          <dd>{row.providerCharge === null ? 'Not reported yet' : money(row.providerCharge)}</dd>
          <dt>GoBye fee</dt>
          <dd>₦0 (no fee schedule)</dd>
          <dt>{row.movementLabel}</dt>
          <dd>{row.movement === null ? 'No movement' : row.movement < 0 ? `minus ${money(-row.movement)}` : money(row.movement)}</dd>
          <dt className="total">Settlement</dt>
          <dd className="total">{row.settlement === null ? 'Not settled' : money(row.settlement)}</dd>
        </dl>
      </Card>
      <KV
        items={[
          ['Reference', row.reference],
          ['Record', row.id],
          [row.personType === 'driver' ? 'Driver' : 'Passenger', <RecordLink key="p" type={row.personType} id={row.personId}>{row.personId}</RecordLink>],
          ['Provider', row.provider],
          ['Started', when(row.at, now)],
        ]}
      />
      <Rule icon={row.type === 'withdrawal' ? 'refresh' : 'shield'}>{row.safety}</Rule>
    </Drawer>
  );
}
