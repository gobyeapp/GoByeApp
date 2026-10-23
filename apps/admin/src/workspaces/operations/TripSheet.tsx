import type { ReactNode } from 'react';
import { CITY_LABELS, type NegotiationHistory, type TripRecord } from '@gobye/core';
import { money, when } from '@/data/format';
import { PAYMENT_STATE, RecordLink, TRIP_STATUS, useOpenRecord } from '@/data/records';
import { useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Drawer, KV, LAGOS, Pill, Timeline } from '@/ui/kit';

const OUTCOME: Record<NegotiationHistory['outcome'], { tone: 'success' | 'info' | 'neutral'; text: string }> = {
  agreed: { tone: 'success', text: 'Fare agreed' },
  open: { tone: 'info', text: 'Taking responses' },
  expired: { tone: 'neutral', text: 'Expired without agreement' },
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: LAGOS });

/** Fare negotiation as a clear timeline: rider offer, driver accepts and counters, the selection. */
export function NegotiationTimeline({ n, suggested }: { n: NegotiationHistory; suggested: TripRecord['suggestedFare'] }) {
  const best = n.events.filter((e) => e.by === 'driver').sort((a, b) => a.amount - b.amount)[0];
  const selected = n.events.find((e) => e.kind === 'select');
  return (
    <section className="neg" aria-label="Fare negotiation">
      <div className="neg-figures">
        <div><span className="k">Suggested fare</span><span className="v num">{money(suggested)}</span></div>
        <div><span className="k">Rider offer</span><span className="v num">{money(n.riderOffer)}</span></div>
        <div><span className="k">Lowest driver response</span><span className="v num">{best ? money(best.amount) : 'None'}</span></div>
        <div><span className="k">Final agreed fare</span><span className="v num strong">{selected ? money(selected.amount) : 'No agreement'}</span></div>
      </div>
      <KV
        items={[
          ['Outcome', <Pill key="o" tone={OUTCOME[n.outcome].tone}>{OUTCOME[n.outcome].text}</Pill>],
          ['Offer made', clock(n.offeredAt)],
          ['Offer expiry', clock(n.expiresAt)],
          ['Accepted at', n.agreedAt ? clock(n.agreedAt) : 'Not accepted'],
          ['Driver', selected?.driverName ?? 'None selected'],
        ]}
      />
      <ol className="neg-steps">
        {n.events.map((e, i) => (
          <li key={i} className={`neg-step ${e.kind}`}>
            <span className="dot" aria-hidden />
            <span className="body">
              <span className="strong">
                {e.kind === 'offer' ? 'Rider offered' : e.kind === 'accept' ? `${e.driverName ?? 'Driver'} accepted` : e.kind === 'counter' ? `${e.driverName ?? 'Driver'} countered` : e.kind === 'select' ? `Rider chose ${e.driverName ?? 'a driver'}` : 'Offer expired'}
              </span>
              <span className="cell-sub">{clock(e.at)}</span>
            </span>
            <span className="num strong">{money(e.amount)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Ride side sheet used by Live operations and Trips. */
export function TripSheet({ trip, onClose, actions }: { trip: TripRecord; onClose: () => void; actions?: ReactNode }) {
  const d = useData();
  const { now } = usePlatform();
  const openRecord = useOpenRecord();
  const t = now();
  const passenger = d.passengers.find((p) => p.id === trip.passengerId);
  const driver = trip.driverId ? d.drivers.find((x) => x.id === trip.driverId) : undefined;
  const cases = d.cases.filter((c) => c.links.tripId === trip.id);
  return (
    <Drawer
      title={`Ride ${trip.ref}`}
      sub={`${CITY_LABELS[trip.city]} · requested ${when(trip.requestedAt, t)}`}
      onClose={onClose}
      footer={
        <>
          {actions}
          <Button variant="secondary" icon="eye" onClick={() => openRecord({ type: 'trip', id: trip.id })}>Full record</Button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 6 }}>
        <Pill tone={TRIP_STATUS[trip.status].tone}>{TRIP_STATUS[trip.status].text}</Pill>
        <Pill tone="neutral" icon={trip.mode === 'negotiate' ? 'exchange' : 'check'}>{trip.mode === 'negotiate' ? 'Negotiated' : 'Quick Match'}</Pill>
        <Pill tone={PAYMENT_STATE[trip.payment].tone}>{`Payment ${PAYMENT_STATE[trip.payment].text.toLowerCase()}`}</Pill>
      </div>
      <KV
        items={[
          ['Ride ID', <span key="id" className="num">{trip.ref} · {trip.id}</span>],
          ['Passenger', passenger ? <RecordLink key="p" type="passenger" id={passenger.id}>{passenger.name}</RecordLink> : 'Unknown'],
          ['Driver', driver ? <RecordLink key="d" type="driver" id={driver.id}>{driver.name}</RecordLink> : 'Not assigned'],
          ['Pickup', trip.pickup],
          ['Destination', trip.destination],
          ['Booking mode', trip.mode === 'negotiate' ? 'Negotiate' : 'Quick Match'],
          ['Agreed fare', trip.agreedFare ? <span key="f" className="num strong">{money(trip.agreedFare)}</span> : `No agreed fare yet (suggested ${money(trip.suggestedFare)})`],
          ['Payment', `${trip.paymentMethod === 'wallet' ? 'Wallet' : trip.paymentMethod === 'cash' ? 'Cash' : 'Bank transfer'} · ${PAYMENT_STATE[trip.payment].text}`],
        ]}
      />
      <div className="small muted row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" size={16} />
        <span>The fare goes to the driver in full. It is not GoBye revenue: GoBye takes 0% commission and earns from driver subscriptions.</span>
      </div>
      {trip.negotiation ? (
        <div className="stack" style={{ gap: 12 }}>
          <h3 className="sheet-h">Fare negotiation</h3>
          <NegotiationTimeline n={trip.negotiation} suggested={trip.suggestedFare} />
        </div>
      ) : null}
      <div className="stack" style={{ gap: 12 }}>
        <h3 className="sheet-h">Timeline</h3>
        <Timeline items={trip.timeline.map((x) => ({ at: x.at, title: x.label }))} />
      </div>
      {cases.length ? (
        <div className="stack" style={{ gap: 8 }}>
          <h3 className="sheet-h">Linked cases</h3>
          {cases.map((c) => (
            <div key={c.id} className="row small" style={{ gap: 8 }}>
              <Icon name={c.team === 'safety' ? 'safeAlert' : 'headphone'} size={16} />
              <span>{c.ref} · {c.subject}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Drawer>
  );
}
