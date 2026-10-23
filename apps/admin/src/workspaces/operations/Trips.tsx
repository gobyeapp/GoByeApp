import { useState } from 'react';
import { CITY_LABELS, type TripRecord, type TripStatus } from '@gobye/core';
import { count, money, when } from '@/data/format';
import { PAYMENT_STATE, TRIP_STATUS, useOpenRecord } from '@/data/records';
import { useScopedFilter } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, Empty, FilterBar, PageHead, Pill, SearchInput, Select, Stat, Table, type Column } from '@/ui/kit';
import './operations.css';
import { countByStatus, filterTrips, type TripFilter } from './logic';

const PAGE = 25;
const STATUSES = Object.keys(TRIP_STATUS) as TripStatus[];
const EMPTY: TripFilter = { q: '', status: 'all', payment: 'all', mode: 'all', method: 'all' };

export default function Trips() {
  const d = useData();
  const { now } = usePlatform();
  const keepRow = useScopedFilter();
  const openRecord = useOpenRecord();
  const [f, setF] = useState<TripFilter>(EMPTY);
  const t = now();
  const set = <K extends keyof TripFilter>(k: K, v: TripFilter[K]) => setF((x) => ({ ...x, [k]: v }));

  const pName = new Map(d.passengers.map((p) => [p.id, p.name]));
  const dName = new Map(d.drivers.map((x) => [x.id, x.name]));
  const scoped = d.trips.filter((x) => keepRow(x.city, x.requestedAt, t));
  const counts = countByStatus(scoped);
  const rows = filterTrips(scoped, f, (x) => [pName.get(x.passengerId) ?? '', x.driverId ? dName.get(x.driverId) ?? '' : '']);
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const negotiated = scoped.filter((x) => x.mode === 'negotiate');
  const agreed = negotiated.filter((x) => x.agreedFare !== undefined);
  const completed = scoped.filter((x) => x.status === 'completed');

  const columns: Column<TripRecord>[] = [
    { key: 'ref', label: 'Trip', sortValue: (x) => -x.requestedAt, render: (x) => (<><div className="cell-title">{x.ref}</div><div className="cell-sub">{CITY_LABELS[x.city]} · {when(x.requestedAt, t)}</div></>) },
    { key: 'route', label: 'Route', render: (x) => <span className="small">{x.pickup} to {x.destination}</span> },
    { key: 'pas', label: 'Passenger', render: (x) => pName.get(x.passengerId) ?? 'Unknown' },
    { key: 'drv', label: 'Driver', render: (x) => (x.driverId ? dName.get(x.driverId) : <span className="muted">None</span>) },
    {
      key: 'fare',
      label: 'Fare',
      align: 'right',
      sortValue: (x) => x.agreedFare ?? x.suggestedFare,
      render: (x) =>
        x.mode === 'negotiate' ? (
          <>
            <div className="num strong">{x.agreedFare ? money(x.agreedFare) : 'No agreement'}</div>
            <div className="cell-sub"><span className="mode-tag negotiate"><Icon name="exchange" size={12} />Negotiated</span></div>
            <div className="cell-sub num">Suggested {money(x.suggestedFare)}</div>
          </>
        ) : (
          <>
            <div className="num strong">{money(x.agreedFare ?? x.suggestedFare)}</div>
            <div className="cell-sub"><span className="mode-tag"><Icon name="check" size={12} />Quick Match</span></div>
          </>
        ),
    },
    { key: 'pay', label: 'Payment', render: (x) => (<><Pill tone={PAYMENT_STATE[x.payment].tone}>{PAYMENT_STATE[x.payment].text}</Pill><div className="cell-sub">{x.paymentMethod === 'wallet' ? 'Wallet' : x.paymentMethod === 'cash' ? 'Cash' : x.directToDriver ? 'Transfer to driver' : 'Bank transfer'}</div></>) },
    { key: 'status', label: 'Status', sortValue: (x) => TRIP_STATUS[x.status].text, render: (x) => <Pill tone={TRIP_STATUS[x.status].tone}>{TRIP_STATUS[x.status].text}</Pill> },
  ];

  return (
    <>
      <PageHead title="Trips" sub="Every trip in your cities and date range. Open one for its timeline, fare, payment and linked cases." />
      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        <Stat label="Trips in this period" value={count(scoped.length)} icon="route" sub={`${count(completed.length)} completed`} />
        <Stat label="Quick Match" value={count(scoped.length - negotiated.length)} icon="check" sub="Platform fare accepted" />
        <Stat label="Negotiated" value={count(negotiated.length)} icon="exchange" sub={`${count(agreed.length)} reached an agreed fare`} />
        <Stat label="Payment due" value={count(counts.payment_pending ?? 0)} icon="wallet" tone={counts.payment_pending ? 'warning' : undefined} sub="Trip ended, payment not confirmed" />
      </div>
      <div className="chips" role="group" aria-label="Filter by status">
        <button className="chip" aria-pressed={f.status === 'all'} onClick={() => set('status', 'all')}>
          All <span className="n">{count(scoped.length)}</span>
        </button>
        {STATUSES.filter((s) => counts[s]).map((s) => (
          <button key={s} className="chip" aria-pressed={f.status === s} onClick={() => set('status', f.status === s ? 'all' : s)}>
            {TRIP_STATUS[s].text} <span className="n">{count(counts[s]!)}</span>
          </button>
        ))}
      </div>
      <FilterBar
        count={`${count(rows.length)} trips`}
        end={filtered ? <Button size="sm" variant="ghost" icon="close" onClick={() => setF(EMPTY)}>Clear filters</Button> : null}
      >
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search ref, place, passenger or driver" />
        <Select<TripFilter['status']> label="Status" value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'all', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: TRIP_STATUS[s].text }))]} />
        <Select<TripFilter['payment']> label="Payment state" value={f.payment} onChange={(v) => set('payment', v)} options={[{ value: 'all', label: 'Any payment' }, ...(Object.keys(PAYMENT_STATE) as TripRecord['payment'][]).map((s) => ({ value: s, label: PAYMENT_STATE[s].text }))]} />
        <Select<TripFilter['mode']> label="Booking mode" value={f.mode} onChange={(v) => set('mode', v)} options={[{ value: 'all', label: 'Any mode' }, { value: 'quick_match', label: 'Quick Match' }, { value: 'negotiate', label: 'Negotiated' }]} />
        <Select<TripFilter['method']> label="Payment method" value={f.method} onChange={(v) => set('method', v)} options={[{ value: 'all', label: 'Any method' }, { value: 'wallet', label: 'Wallet' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }]} />
      </FilterBar>
      <Card flush>
      <Table
        key={JSON.stringify(f)}
        rows={rows}
        pageSize={PAGE}
        caption="Trips"
        columns={columns}
        rowKey={(x) => x.id}
        onRowClick={(x) => openRecord({ type: 'trip', id: x.id })}
        empty={
          <Empty title={filtered ? 'No trips match' : 'No trips in this period'} icon="route">
              {filtered ? 'Clear the filters to see every trip.' : 'Try a longer date range or another city.'}
          </Empty>
        }
      />
      </Card>
    </>
  );
}
