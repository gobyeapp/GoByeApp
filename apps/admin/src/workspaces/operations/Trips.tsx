import { useState } from 'react';
import { CITY_LABELS, type TripRecord, type TripStatus } from '@gobye/core';
import { count, money, when } from '@/data/format';
import { PAYMENT_STATE, TRIP_STATUS } from '@/data/records';
import { useScopedFilter } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, Empty, FilterBar, PageHead, Pill, SearchInput, Select, Table, Tabs, type Column } from '@/ui/kit';
import './operations.css';
import { DELAY_THRESHOLD_S, filterTrips, type TripFilter } from './logic';
import { TripSheet } from './TripSheet';

const PAGE = 25;
const STATUSES = Object.keys(TRIP_STATUS) as TripStatus[];
const EMPTY: TripFilter = { q: '', status: 'all', payment: 'all', mode: 'all', method: 'all' };

export type RideTab = 'all' | 'requests' | 'quick' | 'negotiations' | 'cancelled' | 'issues';
const TAB_LABEL: Record<RideTab, string> = { all: 'All rides', requests: 'Booking requests', quick: 'Quick Match', negotiations: 'Fare negotiations', cancelled: 'Cancelled', issues: 'Trip issues' };

/** Which rides a tab shows. Issues: no driver, delayed pickup, payment not confirmed or failed, or a linked case. */
export function inRideTab(t: TripRecord, tab: RideTab, caseTrips: ReadonlySet<string>): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'requests':
      return t.status === 'searching' || t.status === 'matched';
    case 'quick':
      return t.mode === 'quick_match';
    case 'negotiations':
      return t.mode === 'negotiate';
    case 'cancelled':
      return t.status === 'cancelled';
    case 'issues':
      return t.status === 'no_driver' || (t.status === 'en_route' && (t.pickupDelaySeconds ?? 0) > DELAY_THRESHOLD_S) || t.payment === 'failed' || t.status === 'payment_pending' || caseTrips.has(t.id);
  }
}

export function issueText(t: TripRecord, caseTrips: ReadonlySet<string>): string {
  const out: string[] = [];
  if (t.status === 'no_driver') out.push('No driver found');
  if (t.status === 'en_route' && (t.pickupDelaySeconds ?? 0) > DELAY_THRESHOLD_S) out.push(`Pickup ${Math.round((t.pickupDelaySeconds ?? 0) / 60)} min late`);
  if (t.payment === 'failed') out.push('Payment failed');
  else if (t.status === 'payment_pending') out.push(t.payment === 'processing' ? 'Payment confirming' : 'Payment due');
  if (caseTrips.has(t.id)) out.push('Has a support case');
  return out.join(' · ');
}

export default function Trips() {
  const d = useData();
  const { now } = usePlatform();
  const keepRow = useScopedFilter();
  const [tab, setTab] = useState<RideTab>('all');
  const [f, setF] = useState<TripFilter>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const t = now();
  const set = <K extends keyof TripFilter>(k: K, v: TripFilter[K]) => setF((x) => ({ ...x, [k]: v }));

  const pName = new Map(d.passengers.map((p) => [p.id, p.name]));
  const dName = new Map(d.drivers.map((x) => [x.id, x.name]));
  const caseTrips = new Set(d.cases.map((c) => c.links.tripId).filter((x): x is string => !!x));
  const scoped = d.trips.filter((x) => keepRow(x.city, x.requestedAt, t));
  const tabRows = (k: RideTab) => scoped.filter((x) => inRideTab(x, k, caseTrips));
  const rows = filterTrips(tabRows(tab), f, (x) => [pName.get(x.passengerId) ?? '', x.driverId ? dName.get(x.driverId) ?? '' : '']);
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const trip = selected ? d.trips.find((x) => x.id === selected) : undefined;

  const base: Column<TripRecord>[] = [
    { key: 'ref', label: 'Ride', sortValue: (x) => -x.requestedAt, render: (x) => (<><div className="cell-title">{x.ref}</div><div className="cell-sub">{CITY_LABELS[x.city]} · {when(x.requestedAt, t)}</div></>) },
    { key: 'route', label: 'Route', render: (x) => <span className="small">{x.pickup} to {x.destination}</span> },
    { key: 'people', label: 'Passenger and driver', render: (x) => (<><div>{pName.get(x.passengerId) ?? 'Unknown'}</div><div className="cell-sub">{x.driverId ? dName.get(x.driverId) : 'No driver'}</div></>) },
  ];
  const fareCol: Column<TripRecord> = {
    key: 'fare',
    label: 'Fare',
    align: 'right',
    sortValue: (x) => x.agreedFare ?? x.suggestedFare,
    render: (x) => (
      <>
        <div className="num strong">{x.agreedFare ? money(x.agreedFare) : x.mode === 'negotiate' ? 'No agreement' : money(x.suggestedFare)}</div>
        <div className="cell-sub">{x.mode === 'negotiate' ? <span className="mode-tag negotiate"><Icon name="exchange" size={12} />Negotiated</span> : <span className="mode-tag"><Icon name="check" size={12} />Quick Match</span>}</div>
      </>
    ),
  };
  const statusCol: Column<TripRecord> = { key: 'status', label: 'Status', sortValue: (x) => TRIP_STATUS[x.status].text, render: (x) => <Pill tone={TRIP_STATUS[x.status].tone}>{TRIP_STATUS[x.status].text}</Pill> };
  const payCol: Column<TripRecord> = { key: 'pay', label: 'Payment', render: (x) => (<><Pill tone={PAYMENT_STATE[x.payment].tone}>{PAYMENT_STATE[x.payment].text}</Pill><div className="cell-sub">{x.paymentMethod === 'wallet' ? 'Wallet' : x.paymentMethod === 'cash' ? 'Cash' : x.directToDriver ? 'Transfer to driver' : 'Bank transfer'}</div></>) };

  const negCols: Column<TripRecord>[] = [
    base[0]!,
    { key: 'sug', label: 'Suggested', align: 'right', sortValue: (x) => x.suggestedFare, render: (x) => <span className="num">{money(x.suggestedFare)}</span> },
    { key: 'offer', label: 'Rider offer', align: 'right', sortValue: (x) => x.negotiation?.riderOffer ?? 0, render: (x) => <span className="num">{x.negotiation ? money(x.negotiation.riderOffer) : 'None'}</span> },
    { key: 'resp', label: 'Driver responses', align: 'right', render: (x) => <span className="num">{x.negotiation ? count(x.negotiation.events.filter((e) => e.by === 'driver').length) : 0}</span> },
    { key: 'agreed', label: 'Agreed fare', align: 'right', sortValue: (x) => x.agreedFare ?? 0, render: (x) => <span className="num strong">{x.agreedFare ? money(x.agreedFare) : 'None'}</span> },
    { key: 'outcome', label: 'Outcome', render: (x) => (x.negotiation?.outcome === 'agreed' ? <Pill tone="success">Agreed</Pill> : x.negotiation?.outcome === 'open' ? <Pill tone="info">Open</Pill> : <Pill tone="neutral">Expired</Pill>) },
  ];
  const issueCols: Column<TripRecord>[] = [base[0]!, base[1]!, { key: 'issue', label: 'Issue', render: (x) => <span className="small strong">{issueText(x, caseTrips)}</span> }, statusCol, payCol];
  const columns = tab === 'negotiations' ? negCols : tab === 'issues' ? issueCols : [...base, fareCol, payCol, statusCol];

  return (
    <>
      <PageHead
        eyebrow="Ride management"
        title="Trips"
        sub="Every ride in your cities and date range. Open one for its timeline, fare, negotiation and payment. Fares belong to drivers: GoBye takes no commission."
      />
      <Tabs<RideTab> value={tab} onChange={(v) => setTab(v)} tabs={(Object.keys(TAB_LABEL) as RideTab[]).map((k) => ({ value: k, label: TAB_LABEL[k], count: tabRows(k).length }))} />
      <FilterBar count={`${count(rows.length)} rides`} end={filtered ? <Button size="sm" variant="ghost" icon="close" onClick={() => setF(EMPTY)}>Clear filters</Button> : null}>
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search rides or people" />
        <Select<TripFilter['status']> label="Status" value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'all', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: TRIP_STATUS[s].text }))]} />
        <Select<TripFilter['payment']> label="Payment state" value={f.payment} onChange={(v) => set('payment', v)} options={[{ value: 'all', label: 'Any payment state' }, ...(Object.keys(PAYMENT_STATE) as TripRecord['payment'][]).map((s) => ({ value: s, label: PAYMENT_STATE[s].text }))]} />
        <Select<TripFilter['method']> label="Payment method" value={f.method} onChange={(v) => set('method', v)} options={[{ value: 'all', label: 'Any method' }, { value: 'wallet', label: 'Wallet' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }]} />
      </FilterBar>
      <Card flush>
        <Table
          key={`${tab}-${JSON.stringify(f)}`}
          rows={rows}
          pageSize={PAGE}
          caption={TAB_LABEL[tab]}
          columns={columns}
          rowKey={(x) => x.id}
          onRowClick={(x) => setSelected(x.id)}
          empty={
            <Empty title={filtered ? 'No rides match' : `No ${TAB_LABEL[tab].toLowerCase()} in this period`} art="navigationPath">
              {filtered ? 'Clear the filters to see every ride.' : 'Try a longer date range or another city.'}
            </Empty>
          }
        />
      </Card>
      {trip ? <TripSheet trip={trip} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
