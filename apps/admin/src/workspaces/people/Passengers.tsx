import { useState } from 'react';
import { CITY_LABELS, type CityId, type PassengerRecord } from '@gobye/core';
import { count, date, label, when } from '@/data/format';
import { useOpenRecord } from '@/data/records';
import { useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, ConfirmDialog, Empty, FeaturedStat, Field, FilterBar, Notice, PageHead, Pill, SearchInput, Select, Stat, Table, Tabs, type Column } from '@/ui/kit';
import './people.css';
import { liftRestriction, restrictPassenger, searchPassengers } from './logic';

type Tab = 'all' | 'active' | 'restricted' | 'never';
type Activity = 'any' | 'recent' | 'inactive';
const DAY = 86_400_000;

export default function Passengers() {
  const d = useData();
  const { now } = usePlatform();
  const { can, inScope } = useSession();
  const keepRow = useScopedFilter();
  const openRecord = useOpenRecord();
  const act = useAction();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [activity, setActivity] = useState<Activity>('any');
  const [cityF, setCityF] = useState<CityId | 'all'>('all');
  const [restricting, setRestricting] = useState<PassengerRecord | null>(null);
  const [lifting, setLifting] = useState<PassengerRecord | null>(null);
  const t = now();
  const canContact = can('passengers.contact_details');
  const canRestrict = can('passengers.restrict');
  const cities = (['lagos', 'abuja'] as CityId[]).filter(inScope);

  // People lists follow the city filter and your city scope, not the date range.
  const scoped = d.passengers.filter((p) => keepRow(p.city, undefined, t));
  const inTab: Record<Tab, (p: PassengerRecord) => boolean> = {
    all: () => true,
    active: (p) => p.status === 'active',
    restricted: (p) => p.status === 'restricted',
    never: (p) => p.trips === 0,
  };
  const recent = (p: PassengerRecord) => !!p.lastTripAt && t - p.lastTripAt <= 30 * DAY;
  const rows = searchPassengers(scoped, q, canContact)
    .filter(inTab[tab])
    .filter((p) => activity === 'any' || (activity === 'recent' ? recent(p) : !recent(p)))
    .filter((p) => cityF === 'all' || p.city === cityF)
    .sort((a, b) => (b.lastTripAt ?? b.joinedAt) - (a.lastTripAt ?? a.joinedAt));
  const restrictedCount = scoped.filter((p) => p.status === 'restricted').length;
  const activeCount = scoped.filter((p) => p.status === 'active').length;
  const recentCount = scoped.filter(recent).length;
  const repeat = scoped.filter((p) => p.trips >= 2).length;
  const newThisMonth = scoped.filter((p) => t - p.joinedAt <= 30 * DAY).length;
  const never = scoped.filter((p) => p.trips === 0).length;
  const filtered = !!q || activity !== 'any' || cityF !== 'all';
  const clear = () => (setQ(''), setActivity('any'), setCityF('all'));

  const lift = async (reason: string) => {
    if (!lifting) return;
    const p = lifting;
    const r = await act(
      {
        label: 'Lift restriction',
        apply: (draft) => liftRestriction(draft.passengers.find((x) => x.id === p.id)),
        audit: () => ({ action: 'passenger.restriction_lifted', target: { type: 'passenger', id: p.id, label: p.name }, summary: `Lifted restriction on ${p.name}`, diff: [{ field: 'Status', from: 'Restricted', to: 'Active' }], reason }),
      },
      'Restriction lifted. They can book again.',
    );
    if (r.ok) setLifting(null);
  };

  const columns: Column<PassengerRecord>[] = [
    { key: 'name', label: 'Rider', sortValue: (p) => p.name, render: (p) => (<><div className="cell-title">{p.name}</div><div className="cell-sub">{p.id}{canContact ? ` · ${p.phone}` : ''}</div></>) },
    { key: 'city', label: 'City', sortValue: (p) => CITY_LABELS[p.city], render: (p) => CITY_LABELS[p.city] },
    { key: 'joined', label: 'Registered', sortValue: (p) => p.joinedAt, render: (p) => <span className="small">{date(p.joinedAt)}</span> },
    { key: 'trips', label: 'Trips', align: 'right', sortValue: (p) => p.trips, render: (p) => (<><div className="num">{count(p.trips)}</div><div className="cell-sub">{p.lastTripAt ? `Last ${when(p.lastTripAt, t)}` : 'None yet'}</div></>) },
    { key: 'rating', label: 'Rating', align: 'right', sortValue: (p) => p.rating, render: (p) => <span className="num">{p.rating.toFixed(1)}</span> },
    {
      key: 'status',
      label: 'Status',
      sortValue: (p) => p.status,
      render: (p) => (
        <>
          <Pill tone={p.status === 'active' ? 'success' : p.status === 'restricted' ? 'danger' : 'neutral'} icon={p.status === 'restricted' ? 'userForbid' : undefined}>{label(p.status)}</Pill>
          {p.restriction ? <div className="cell-sub">{p.restriction.until ? (p.restriction.until > t ? `Until ${date(p.restriction.until)}` : 'End date passed') : 'No end date'}</div> : null}
        </>
      ),
    },
    ...(canRestrict
      ? [
          {
            key: 'act',
            label: 'Action',
            align: 'right' as const,
            render: (p: PassengerRecord) => (
              <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {p.status === 'active' ? (
                  <Button size="sm" variant="ghost" icon="userForbid" onClick={() => setRestricting(p)}>Restrict</Button>
                ) : p.status === 'restricted' ? (
                  <Button size="sm" variant="ghost" icon="refresh" onClick={() => setLifting(p)}>Lift</Button>
                ) : null}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHead eyebrow="People" title="Passengers" sub="Find a rider, see their rides, payments and support history, and restrict misuse. Restricted riders can’t book." />
      <div className="grid featured">
        <FeaturedStat label="Active riders" value={count(recentCount)} sub={`Rode in the last 30 days · ${count(repeat)} with 2 or more trips`} art="riderAccount" onClick={() => (setTab('all'), setActivity('recent'))} />
        <Stat icon="user" label="Registered" value={count(scoped.length)} sub={`${count(newThisMonth)} joined in the last 30 days`} onClick={() => (setTab('all'), clear())} />
        <Stat icon="checkCircle" label="Can book" value={count(activeCount)} sub="Account active" onClick={() => setTab('active')} />
        <Stat icon="userForbid" label="Restricted" value={count(restrictedCount)} sub="Can’t book until lifted" tone={restrictedCount ? 'danger' : undefined} onClick={() => setTab('restricted')} />
      </div>
      <div style={{ marginTop: 32 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: 'All riders', count: scoped.length },
            { value: 'active', label: 'Active', count: activeCount },
            { value: 'restricted', label: 'Restricted', count: restrictedCount },
            { value: 'never', label: 'No rides yet', count: never },
          ]}
        />
      </div>
      <FilterBar count={`${count(rows.length)} riders · city filter applies, date range doesn’t`} end={filtered ? <Button size="sm" variant="ghost" icon="close" onClick={clear}>Clear filters</Button> : undefined}>
        <SearchInput value={q} onChange={setQ} placeholder={canContact ? 'Search name, phone or ID' : 'Search name or ID'} />
        <Select<Activity> label="Ride activity" value={activity} onChange={setActivity} options={[{ value: 'any', label: 'Any activity' }, { value: 'recent', label: 'Rode in last 30 days' }, { value: 'inactive', label: 'No ride in 30 days' }]} />
        {cities.length > 1 ? <Select<CityId | 'all'> label="City" value={cityF} onChange={setCityF} options={[{ value: 'all', label: 'Every city' }, ...cities.map((c) => ({ value: c, label: CITY_LABELS[c] }))]} /> : null}
      </FilterBar>
      {!canContact ? <div style={{ marginBottom: 16 }}><Notice icon="lock">Phone numbers are hidden for your role, so search works by name and ID only.</Notice></div> : null}
      <Card flush>
        <Table
          caption="Passengers"
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          pageSize={25}
          onRowClick={(p) => openRecord({ type: 'passenger', id: p.id })}
          empty={
            filtered || tab !== 'all' ? (
              <Empty title="No riders match" icon="filter" action={filtered ? <Button size="sm" onClick={clear}>Clear filters</Button> : undefined}>
                {q ? (canContact ? 'Check the spelling or try part of the phone number.' : 'Check the spelling or search by rider ID.') : 'Try another tab or filter.'}
              </Empty>
            ) : (
              <Empty title="No riders in your cities" art="riderAccount">Change the city filter to see more.</Empty>
            )
          }
        />
      </Card>
      {restricting ? <RestrictDialog p={restricting} onClose={() => setRestricting(null)} /> : null}
      {lifting ? (
        <ConfirmDialog
          title={`Lift restriction on ${lifting.name}?`}
          body={lifting.restriction ? `Restricted for: ${lifting.restriction.reason}. They will be able to book again straight away.` : 'They will be able to book again straight away.'}
          confirmLabel="Lift restriction"
          requireReason
          onConfirm={lift}
          onCancel={() => setLifting(null)}
        />
      ) : null}
    </>
  );
}

function RestrictDialog({ p, onClose }: { p: PassengerRecord; onClose: () => void }) {
  const { staff } = useSession();
  const { now } = usePlatform();
  const act = useAction();
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const t = now();
  const untilMs = until ? new Date(`${until}T23:59:00`).getTime() : undefined;
  const dateError = untilMs !== undefined && untilMs <= t ? 'Choose a date in the future' : undefined;
  const save = async () => {
    const r = await act(
      {
        label: 'Restrict passenger',
        apply: (draft, ctx) => restrictPassenger(draft.passengers.find((x) => x.id === p.id), { reason, until: untilMs, by: staff?.name ?? ctx.actor.name }, ctx.now),
        audit: () => ({
          action: 'passenger.restricted',
          target: { type: 'passenger', id: p.id, label: p.name },
          summary: `Restricted ${p.name}${untilMs ? ` until ${date(untilMs)}` : ' with no end date'}`,
          diff: [{ field: 'Status', from: 'Active', to: 'Restricted' }],
          reason: reason.trim(),
        }),
      },
      'Passenger restricted. They can’t book until it is lifted.',
    );
    if (r.ok) onClose();
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Restrict ${p.name}`}>
        <h2>Restrict {p.name}?</h2>
        <div className="muted">Restricted passengers can’t book trips. Trips already in progress continue. The passenger sees that their account is restricted.</div>
        <Field label="Reason" hint="Saved to the audit trail.">
          {(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
        </Field>
        <Field label="End date (optional)" hint="Leave empty to keep it until someone lifts it." error={dateError}>
          {(id) => <input id={id} className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={save} disabledReason={!reason.trim() ? 'Add a reason first' : dateError}>Restrict</Button>
        </div>
      </div>
    </>
  );
}
