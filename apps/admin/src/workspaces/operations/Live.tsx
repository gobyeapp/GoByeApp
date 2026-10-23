import { useState, type ReactNode } from 'react';
import { CITY_LABELS, type CityId, type TripRecord } from '@gobye/core';
import { count, when } from '@/data/format';
import { TRIP_STATUS } from '@/data/records';
import { useFilters, useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Empty, Field, Meter, Notice, PageHead, Pill, Section, Segmented, Stat } from '@/ui/kit';
import { LiveMap } from './LiveMap';
import { TripSheet } from './TripSheet';
import './operations.css';
import { ACTIVE_STATUSES, CANCELLABLE, PROBLEM_LABELS, cancelForPassenger, detectProblems, dismissedFromAudit, driverAvailability, elapsedLabel, type Keep, type Problem } from './logic';

type Contact = { trip: TripRecord; who: 'driver' | 'passenger' };
const LIVE_KINDS = new Set(['delayed_pickup', 'searching_long', 'payment_stuck']);

export default function Live() {
  const d = useData();
  const { now } = usePlatform();
  const { can, inScope } = useSession();
  const { city } = useFilters();
  const keepRow = useScopedFilter();
  const act = useAction();
  const [contact, setContact] = useState<Contact | null>(null);
  const [cancelling, setCancelling] = useState<TripRecord | null>(null);
  const [showAllPast, setShowAllPast] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapCity, setMapCity] = useState<CityId | undefined>(undefined);
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

  const sheetActions = (trip: TripRecord) => (
    <>
      {trip.driverId ? <Button variant="ghost" icon="phone" onClick={() => setContact({ trip, who: 'driver' })}>Contact driver</Button> : null}
      <Button variant="ghost" icon="chat" onClick={() => setContact({ trip, who: 'passenger' })}>Contact passenger</Button>
      {CANCELLABLE.includes(trip.status) ? <Button variant="danger-soft" icon="close" onClick={() => setCancelling(trip)}>Cancel for passenger</Button> : null}
    </>
  );

  const actions = (trip: TripRecord, p?: Problem) => (
    <div className="row wrap" style={{ gap: 6 }}>
      <Button size="sm" variant="ghost" icon="eye" onClick={() => { setSelected(trip.id); setMapCity(trip.city); }}>Open ride</Button>
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

  const mapCities = cities.length ? cities : [];
  const shownCity: CityId | undefined = mapCity && mapCities.includes(mapCity) ? mapCity : mapCities[0];
  const selectedTrip = selected ? d.trips.find((x) => x.id === selected) : undefined;
  const busy = new Set(d.trips.filter((x) => x.driverId && ['matched', 'en_route', 'arrived', 'in_progress'].includes(x.status)).map((x) => x.driverId!));
  const freeDrivers = d.drivers.filter((x) => x.city === shownCity && x.verification === 'approved' && x.online && x.access && x.access.expiresAt > t && !busy.has(x.id));
  const dot = (x: TripRecord) => (x.status === 'searching' ? 'searching' : x.status === 'en_route' && (x.pickupDelaySeconds ?? 0) > 300 ? 'late' : 'moving');

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Live operations"
        sub="Active rides, problems that need action and driver availability. Locations and timings are simulated."
        meta={
          <>
            <Pill tone="warning" icon="radar">Simulated locations and timings</Pill>
            {!canAct ? <Pill tone="neutral" icon="lock">View only</Pill> : null}
          </>
        }
      />
      {!canAct ? <div style={{ marginBottom: 16 }}><Notice icon="lock">View only. Contacting people and cancelling trips needs dispatch access.</Notice></div> : null}

      <div className="grid cols-4">
        <Stat label="Needs action now" value={count(live.length)} icon="alert" tone={live.length ? 'danger' : undefined} sub={live.length ? 'Delayed pickups, long searches, stuck payments' : 'Nothing waiting'} />
        <Stat label="Active rides" value={count(active.length)} icon="route" sub="Searching, on the way or on trip" />
        <Stat label="Drivers available" value={count(availability.reduce((s, a) => s + a.available, 0))} icon="steering" sub={`${count(availability.reduce((s, a) => s + a.busy, 0))} on a trip`} />
        <Stat label="Failures and cancellations" value={count(past.length)} icon="close" tone={past.length ? 'warning' : undefined} sub="In the selected dates" />
      </div>

      <div className="live-grid section">
        <Card flush>
          <div className="map-head">
            <h3 style={{ flex: 1 }}>Active rides</h3>
            <span className="small muted num">{count(active.length)}</span>
          </div>
          {active.length ? (
            <ul className="ride-list">
              {active.map((x) => (
                <li key={x.id}>
                  <button className="ride-item" aria-pressed={selected === x.id} onClick={() => { setSelected(x.id); setMapCity(x.city); }}>
                    <span className={`st ${dot(x)}`} aria-hidden />
                    <span style={{ minWidth: 0 }}>
                      <span className="strong" style={{ display: 'block' }}>{x.ref} · {TRIP_STATUS[x.status].text}</span>
                      <span className="cell-sub" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.pickup} to {x.destination}</span>
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span className="num small strong" style={{ display: 'block' }}>{elapsedLabel(x.requestedAt, t)}</span>
                      <span className="cell-sub">{x.mode === 'negotiate' ? 'Negotiated' : 'Quick Match'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No active rides" art="activeTrips">Rides being searched, on the way or in progress appear here.</Empty>
          )}
        </Card>
        <Card flush className="map-panel">
          <div className="map-head">
            <h3 style={{ flex: 1 }}>{shownCity ? CITY_LABELS[shownCity] : 'Map'}</h3>
            {mapCities.length > 1 ? (
              <Segmented<CityId> label="City on the map" value={shownCity!} onChange={setMapCity} options={mapCities.map((c) => ({ value: c, label: CITY_LABELS[c] }))} />
            ) : null}
          </div>
          {shownCity ? (
            <LiveMap city={shownCity} rides={active.filter((x) => x.city === shownCity)} drivers={freeDrivers} selected={selected ?? undefined} onSelect={setSelected} />
          ) : (
            <Empty title="No cities in your scope" icon="mapPin" />
          )}
          <div className="map-legend" aria-hidden>
            <span><i style={{ border: '2px solid var(--ink)', background: '#fff' }} />Pickup</span>
            <span><i style={{ background: 'var(--jade)' }} />Driver on a ride</span>
            <span><i style={{ border: '2px solid var(--warning)', background: '#fff' }} />Searching</span>
            <span><i style={{ border: '2px solid #8a938e', background: '#fff' }} />Available driver</span>
          </div>
        </Card>
      </div>

      <Section title={`Needs action now${live.length ? ` (${live.length})` : ''}`}>
        <Card flush>
          {live.length ? (
            live.map((p) => <ProblemRow key={p.key} p={p} now={t}>{actions(tripOf(p.tripId), p)}</ProblemRow>)
          ) : (
            <Empty title="No live problems" art="completedTrips">No delayed pickups, long searches or stuck payments right now.</Empty>
          )}
        </Card>
      </Section>

      <Section
        title={`Matching failures and cancellations${past.length ? ` (${past.length})` : ''}`}
        actions={past.length > 6 ? <Button size="sm" variant="ghost" onClick={() => setShowAllPast((v) => !v)}>{showAllPast ? 'Show fewer' : `Show all ${past.length}`}</Button> : null}
      >
        <Card flush>
          {past.length ? (
            (showAllPast ? past : past.slice(0, 6)).map((p) => <ProblemRow key={p.key} p={p} now={t}>{actions(tripOf(p.tripId), p)}</ProblemRow>)
          ) : (
            <Empty title="None in this period" icon="checkCircle">Trips that found no driver or were cancelled in the date range appear here.</Empty>
          )}
        </Card>
      </Section>

      <Section title="Driver availability" desc="Online out of drivers with active access. Going online needs approval and an active driver pass.">
        {availability.length ? (
          <div className="grid cols-2">
            {availability.map((a) => (
              <Card key={a.city} title={CITY_LABELS[a.city]}>
                <div className="avail">
                  <Metric label="Available" value={a.available} />
                  <Metric label="On a trip" value={a.busy} />
                  <Metric label="With access" value={a.withAccess} />
                  <Metric label="Approved" value={a.approved} />
                </div>
                <div style={{ marginTop: 16 }}>
                  <Meter value={a.withAccess ? (a.available + a.busy) / a.withAccess : 0} label={`${CITY_LABELS[a.city]}: drivers online out of those with access`} />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card><Empty title="No cities in your scope" icon="mapPin" /></Card>
        )}
      </Section>

      {selectedTrip ? <TripSheet trip={selectedTrip} onClose={() => setSelected(null)} actions={canAct ? sheetActions(selectedTrip) : null} /> : null}
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
    <div>
      <div className="k">{label}</div>
      <div className="v">{count(value)}</div>
    </div>
  );
}


function ProblemRow({ p, now, children }: { p: Problem; now: number; children: ReactNode }) {
  return (
    <div className="problem-row">
      <div style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className={`sev ${p.severity === 'danger' ? 'high' : p.severity === 'warning' ? 'medium' : 'low'}`}>{PROBLEM_LABELS[p.kind]}</span>
          <span className="strong">Ride {p.ref}</span>
          <span className="small muted">{CITY_LABELS[p.city]} · {when(p.at, now)}</span>
        </div>
        <div className="small" style={{ marginTop: 4 }}>{p.detail}</div>
      </div>
      <div>{children}</div>
    </div>
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
