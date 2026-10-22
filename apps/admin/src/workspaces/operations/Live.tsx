import { useState, type ReactNode } from 'react';
import { CITY_LABELS, type CityId, type TripRecord } from '@gobye/core';
import { count, when } from '@/data/format';
import { TRIP_STATUS, useOpenRecord } from '@/data/records';
import { useFilters, useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Empty, Field, Meter, Notice, PageHead, Pill, Section, Table, type Column } from '@/ui/kit';
import { ACTIVE_STATUSES, CANCELLABLE, PROBLEM_LABELS, cancelForPassenger, detectProblems, dismissedFromAudit, driverAvailability, elapsedLabel, type Keep, type Problem } from './logic';

type Contact = { trip: TripRecord; who: 'driver' | 'passenger' };
const LIVE_KINDS = new Set(['delayed_pickup', 'searching_long', 'payment_stuck']);

export default function Live() {
  const d = useData();
  const { now } = usePlatform();
  const { can, inScope } = useSession();
  const { city } = useFilters();
  const keepRow = useScopedFilter();
  const openRecord = useOpenRecord();
  const act = useAction();
  const [contact, setContact] = useState<Contact | null>(null);
  const [cancelling, setCancelling] = useState<TripRecord | null>(null);
  const [showAllPast, setShowAllPast] = useState(false);
  const t = now();
  const keep: Keep = (c, at) => keepRow(c, at, t);
  const canAct = can('live.dispatch') || can('trips.intervene');

  const problems = detectProblems(d.trips, t, keep, dismissedFromAudit(d.audit));
  const live = problems.filter((p) => LIVE_KINDS.has(p.kind));
  const past = problems.filter((p) => !LIVE_KINDS.has(p.kind));
  const cities = (['lagos', 'abuja'] as CityId[]).filter((c) => inScope(c) && (city === 'all' || city === c));
  const availability = driverAvailability(d.drivers, d.trips, t, cities);
  const active = d.trips.filter((x) => ACTIVE_STATUSES.includes(x.status) && keep(x.city, undefined)).sort((a, b) => a.requestedAt - b.requestedAt);
  const tripOf = (id: string) => d.trips.find((x) => x.id === id)!;

  const resolve = (p: Problem) =>
    act(
      {
        label: 'Mark problem resolved',
        apply: (draft) => (draft.trips.some((x) => x.id === p.tripId) ? { ok: true } : { ok: false, error: 'Trip not found' }),
        audit: () => ({
          action: 'live.problem_resolved',
          target: { type: 'trip', id: p.tripId, label: `Trip ${tripOf(p.tripId).ref}` },
          summary: `Marked "${PROBLEM_LABELS[p.kind]}" resolved on trip ${tripOf(p.tripId).ref}`,
          diff: [{ field: 'Problem', from: 'Open', to: p.key }],
        }),
        latency: 350,
      },
      'Marked resolved',
    );

  const cancel = async (reason: string) => {
    if (!cancelling) return;
    const trip = cancelling;
    const r = await act(
      {
        label: 'Cancel trip for passenger',
        apply: (draft, ctx) => cancelForPassenger(draft.trips.find((x) => x.id === trip.id), reason, ctx.now),
        audit: () => ({
          action: 'trip.cancelled_by_operations',
          target: { type: 'trip', id: trip.id, label: `Trip ${trip.ref}` },
          summary: `Cancelled trip ${trip.ref} for the passenger (no fee)`,
          diff: [{ field: 'Status', from: TRIP_STATUS[trip.status].text, to: 'Cancelled' }],
          reason,
        }),
      },
      'Trip cancelled. Passenger and driver apps update.',
    );
    if (r.ok) setCancelling(null);
  };

  const actions = (trip: TripRecord, p?: Problem) => (
    <div className="row wrap" style={{ gap: 6 }}>
      <Button size="sm" variant="ghost" icon="eye" onClick={() => openRecord({ type: 'trip', id: trip.id })}>Open trip</Button>
      {canAct ? (
        <>
          {trip.driverId ? <Button size="sm" variant="ghost" icon="phone" onClick={() => setContact({ trip, who: 'driver' })}>Contact driver</Button> : null}
          <Button size="sm" variant="ghost" icon="chat" onClick={() => setContact({ trip, who: 'passenger' })}>Contact passenger</Button>
          {CANCELLABLE.includes(trip.status) ? <Button size="sm" variant="danger-soft" icon="close" onClick={() => setCancelling(trip)}>Cancel trip for passenger</Button> : null}
          {p ? <Button size="sm" variant="ghost" icon="check" onClick={() => resolve(p)}>Mark resolved</Button> : null}
        </>
      ) : null}
    </div>
  );

  const columns: Column<TripRecord>[] = [
    { key: 'ref', label: 'Trip', render: (x) => (<><div className="cell-title">{x.ref}</div><div className="cell-sub">{CITY_LABELS[x.city]}</div></>) },
    { key: 'status', label: 'Status', render: (x) => <Pill tone={TRIP_STATUS[x.status].tone}>{TRIP_STATUS[x.status].text}</Pill> },
    { key: 'pas', label: 'Passenger', render: (x) => d.passengers.find((p) => p.id === x.passengerId)?.name ?? 'Unknown' },
    { key: 'drv', label: 'Driver', render: (x) => (x.driverId ? d.drivers.find((r) => r.id === x.driverId)?.name : <span className="muted">Not assigned</span>) },
    { key: 'route', label: 'Route', render: (x) => <span className="small">{x.pickup} to {x.destination}</span> },
    { key: 'elapsed', label: 'Elapsed', align: 'right', render: (x) => <span className="num">{elapsedLabel(x.requestedAt, t)}</span> },
  ];

  return (
    <>
      <PageHead title="Live operations" sub="Problems that need action come first. Driver locations and timings are simulated." />
      {!canAct ? <div style={{ marginBottom: 16 }}><Notice icon="lock">View only. Contacting people and cancelling trips needs dispatch access.</Notice></div> : null}

      <Section title={`Needs action now${live.length ? ` (${live.length})` : ''}`}>
        {live.length ? (
          <div className="stack">
            {live.map((p) => (
              <ProblemCard key={p.key} p={p} now={t}>{actions(tripOf(p.tripId), p)}</ProblemCard>
            ))}
          </div>
        ) : (
          <Card><Empty title="No live problems" icon="checkCircle">No delayed pickups, long searches or stuck payments right now.</Empty></Card>
        )}
      </Section>

      <Section
        title={`Matching failures and cancellations${past.length ? ` (${past.length})` : ''}`}
        actions={past.length > 6 ? <Button size="sm" variant="ghost" onClick={() => setShowAllPast((v) => !v)}>{showAllPast ? 'Show fewer' : `Show all ${past.length}`}</Button> : null}
      >
        {past.length ? (
          <div className="stack">
            {(showAllPast ? past : past.slice(0, 6)).map((p) => (
              <ProblemCard key={p.key} p={p} now={t}>{actions(tripOf(p.tripId), p)}</ProblemCard>
            ))}
          </div>
        ) : (
          <Card><Empty title="None in this period" icon="checkCircle">Trips that found no driver or were cancelled in the date range appear here.</Empty></Card>
        )}
      </Section>

      <Section title="Driver availability">
        {availability.length ? (
          <div className="grid cols-2">
            {availability.map((a) => (
              <Card key={a.city} title={CITY_LABELS[a.city]}>
                <div className="grid cols-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                  <Metric label="Available" value={a.available} />
                  <Metric label="On a trip" value={a.busy} />
                  <Metric label="With access" value={a.withAccess} />
                  <Metric label="Approved" value={a.approved} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Meter value={a.withAccess ? (a.available + a.busy) / a.withAccess : 0} label={`${CITY_LABELS[a.city]}: drivers online out of those with access`} />
                  <div className="small muted" style={{ marginTop: 6 }}>Online out of drivers with active access. Going online needs approval and an active access package.</div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card><Empty title="No cities in your scope" icon="mapPin" /></Card>
        )}
      </Section>

      <Section title={`Active journeys (${active.length})`}>
        <Table
          rows={active}
          columns={columns}
          rowKey={(x) => x.id}
          onRowClick={(x) => openRecord({ type: 'trip', id: x.id })}
          empty={<Card><Empty title="No active journeys" icon="route">Trips being searched, on the way or in progress appear here.</Empty></Card>}
        />
      </Section>

      {contact ? <ContactDialog c={contact} onClose={() => setContact(null)} /> : null}
      {cancelling ? (
        <ConfirmDialog
          title={`Cancel trip ${cancelling.ref}?`}
          body="The trip is cancelled on the passenger’s behalf with no fee. Both apps update and the trip timeline records it."
          confirmLabel="Cancel trip"
          danger
          requireReason
          onConfirm={cancel}
          onCancel={() => setCancelling(null)}
        />
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{count(value)}</span>
    </div>
  );
}

function ProblemCard({ p, now, children }: { p: Problem; now: number; children: ReactNode }) {
  return (
    <Card>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <Pill tone={p.severity} icon={p.kind === 'delayed_pickup' ? 'time' : p.kind === 'searching_long' ? 'radar' : p.kind === 'payment_stuck' ? 'wallet' : p.kind === 'no_driver' ? 'alert' : 'close'}>
          {PROBLEM_LABELS[p.kind]}
        </Pill>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="strong">Trip {p.ref} <span className="muted small">· {CITY_LABELS[p.city]} · {when(p.at, now)}</span></div>
          <div className="small muted">{p.detail}</div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </Card>
  );
}

function ContactDialog({ c, onClose }: { c: Contact; onClose: () => void }) {
  const d = useData();
  const { can } = useSession();
  const act = useAction();
  const [note, setNote] = useState('');
  const person = c.who === 'driver' ? d.drivers.find((x) => x.id === c.trip.driverId) : d.passengers.find((x) => x.id === c.trip.passengerId);
  const seePhone = can(c.who === 'driver' ? 'drivers.contact_details' : 'passengers.contact_details');
  const save = async () => {
    const r = await act(
      {
        label: `Contact ${c.who}`,
        apply: (draft, ctx) => {
          const trip = draft.trips.find((x) => x.id === c.trip.id);
          if (!trip) return { ok: false, error: 'Trip not found' };
          trip.timeline.push({ at: ctx.now, label: `Operations contacted the ${c.who}` });
          return { ok: true };
        },
        audit: () => ({ action: 'live.contacted', target: { type: 'trip', id: c.trip.id, label: `Trip ${c.trip.ref}` }, summary: `Contacted the ${c.who} (${person?.name ?? 'unknown'}) about trip ${c.trip.ref}`, reason: note.trim() }),
        latency: 400,
      },
      'Contact note saved',
    );
    if (r.ok) onClose();
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Contact ${c.who}`}>
        <h2>Contact {c.who}: {person?.name ?? 'Unknown'}</h2>
        <Notice icon="info">Simulated. No call or message is placed. Calls will go through a masked number once the backend exists.</Notice>
        <div className="row small">
          <Icon name="phone" size={16} />
          {person ? (seePhone ? person.phone : <span className="muted">Number hidden for your role</span>) : 'No contact on record'}
        </div>
        <Field label="What happened" hint="Saved to the trip timeline and the audit trail.">
          {(id) => <textarea id={id} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="For example: driver stuck in traffic, new estimate 6 min" />}
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabledReason={note.trim() ? undefined : 'Add a short note first'}>Save note</Button>
        </div>
      </div>
    </>
  );
}
