import { useState } from 'react';
import { CITY_LABELS, type TripRecord, type TripStatus } from '@gobye/core';
import { count, money, when } from '@/data/format';
import { PAYMENT_STATE, TRIP_STATUS, useOpenRecord } from '@/data/records';
import { useScopedFilter } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Button, Card, Empty, PageHead, Pill, SearchInput, Select, Table, type Column } from '@/ui/kit';
import { countByStatus, filterTrips, type TripFilter } from './logic';

const PAGE = 50;
const STATUSES = Object.keys(TRIP_STATUS) as TripStatus[];
const EMPTY: TripFilter = { q: '', status: 'all', payment: 'all', mode: 'all', method: 'all' };

export default function Trips() {
  const d = useData();
  const { now } = usePlatform();
  const keepRow = useScopedFilter();
  const openRecord = useOpenRecord();
  const [f, setF] = useState<TripFilter>(EMPTY);
  const [shown, setShown] = useState(PAGE);
  const t = now();
  const set = <K extends keyof TripFilter>(k: K, v: TripFilter[K]) => { setF((x) => ({ ...x, [k]: v })); setShown(PAGE); };

  const pName = new Map(d.passengers.map((p) => [p.id, p.name]));
  const dName = new Map(d.drivers.map((x) => [x.id, x.name]));
  const scoped = d.trips.filter((x) => keepRow(x.city, x.requestedAt, t));
  const counts = countByStatus(scoped);
  const rows = filterTrips(scoped, f, (x) => [pName.get(x.passengerId) ?? '', x.driverId ? dName.get(x.driverId) ?? '' : '']);
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY);

  const columns: Column<TripRecord>[] = [
    { key: 'ref', label: 'Trip', render: (x) => (<><div className="cell-title">{x.ref}</div><div className="cell-sub">{CITY_LABELS[x.city]} · {when(x.requestedAt, t)}</div></>) },
    { key: 'route', label: 'Route', render: (x) => <span className="small">{x.pickup} to {x.destination}</span> },
    { key: 'pas', label: 'Passenger', render: (x) => pName.get(x.passengerId) ?? 'Unknown' },
    { key: 'drv', label: 'Driver', render: (x) => (x.driverId ? dName.get(x.driverId) : <span className="muted">None</span>) },
    {
      key: 'fare',
      label: 'Fare',
      align: 'right',
      render: (x) =>
        x.mode === 'negotiate' ? (
          <>
            <div className="num strong">{x.agreedFare ? money(x.agreedFare) : 'No agreement'}</div>
            <div className="cell-sub">Negotiated · suggested {money(x.suggestedFare)}</div>
          </>
        ) : (
          <>
            <div className="num strong">{money(x.agreedFare ?? x.suggestedFare)}</div>
            <div className="cell-sub">Quick Match</div>
          </>
        ),
    },
    { key: 'pay', label: 'Payment', render: (x) => (<><Pill tone={PAYMENT_STATE[x.payment].tone}>{PAYMENT_STATE[x.payment].text}</Pill><div className="cell-sub">{x.paymentMethod === 'wallet' ? 'Wallet' : x.paymentMethod === 'cash' ? 'Cash' : x.directToDriver ? 'Transfer to driver' : 'Bank transfer'}</div></>) },
    { key: 'status', label: 'Status', render: (x) => <Pill tone={TRIP_STATUS[x.status].tone}>{TRIP_STATUS[x.status].text}</Pill> },
  ];

  return (
    <>
      <PageHead title="Trips" sub="Every trip in your cities and date range. Open one for its timeline, fare, payment and linked cases." />
      <div className="row wrap" style={{ gap: 6, marginBottom: 14 }} role="group" aria-label="Filter by status">
        <button className={`pill ${f.status === 'all' ? 'brand' : 'neutral'}`} style={{ border: 0, cursor: 'pointer' }} aria-pressed={f.status === 'all'} onClick={() => set('status', 'all')}>
          All {count(scoped.length)}
        </button>
        {STATUSES.filter((s) => counts[s]).map((s) => (
          <button key={s} className={`pill ${f.status === s ? 'brand' : 'neutral'}`} style={{ border: 0, cursor: 'pointer' }} aria-pressed={f.status === s} onClick={() => set('status', f.status === s ? 'all' : s)}>
            {TRIP_STATUS[s].text} {count(counts[s]!)}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search ref, place, passenger or driver" />
        <Select<TripFilter['status']> label="Status" value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'all', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: TRIP_STATUS[s].text }))]} />
        <Select<TripFilter['payment']> label="Payment state" value={f.payment} onChange={(v) => set('payment', v)} options={[{ value: 'all', label: 'Any payment' }, ...(Object.keys(PAYMENT_STATE) as TripRecord['payment'][]).map((s) => ({ value: s, label: PAYMENT_STATE[s].text }))]} />
        <Select<TripFilter['mode']> label="Booking mode" value={f.mode} onChange={(v) => set('mode', v)} options={[{ value: 'all', label: 'Any mode' }, { value: 'quick_match', label: 'Quick Match' }, { value: 'negotiate', label: 'Negotiated' }]} />
        <Select<TripFilter['method']> label="Payment method" value={f.method} onChange={(v) => set('method', v)} options={[{ value: 'all', label: 'Any method' }, { value: 'wallet', label: 'Wallet' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }]} />
        {filtered ? <Button size="sm" variant="ghost" onClick={() => { setF(EMPTY); setShown(PAGE); }}>Clear filters</Button> : null}
        <span className="muted small">{count(rows.length)} trips</span>
      </div>
      <Table
        rows={rows.slice(0, shown)}
        columns={columns}
        rowKey={(x) => x.id}
        onRowClick={(x) => openRecord({ type: 'trip', id: x.id })}
        empty={
          <Card>
            <Empty title={filtered ? 'No trips match' : 'No trips in this period'} icon="route">
              {filtered ? 'Clear the filters to see every trip.' : 'Try a longer date range or another city.'}
            </Empty>
          </Card>
        }
      />
      {rows.length > shown ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</Button>
        </div>
      ) : null}
    </>
  );
}
