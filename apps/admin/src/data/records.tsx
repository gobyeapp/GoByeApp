import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { balanceOf, withdrawable, type DriverRecord, type PassengerRecord, type TripRecord } from '@gobye/core';
import { Icon } from '@/ui/Icon';
import { Button, Card, Drawer, KV, Pill, Timeline, type Tone } from '@/ui/kit';
import { city, date, label, money, when } from './format';
import { useSession } from './session';
import { usePlatform, useData } from './store';

/**
 * Shared record panels (brief §9): the trip opened from Support is the same trip Operations and Finance
 * see. Any screen calls `openRecord({ type, id })`; what the panel shows is tailored by permission
 * (contact details, money and safety location are only shown to roles that hold those permissions).
 */
export type RecordRef = { type: 'trip' | 'passenger' | 'driver'; id: string };

const Ctx = createContext<(r: RecordRef) => void>(() => undefined);
export const useOpenRecord = () => useContext(Ctx);

export function RecordProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<RecordRef[]>([]);
  const open = useCallback((r: RecordRef) => setStack((s) => [...s, r]), []);
  const close = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const top = stack[stack.length - 1];
  return (
    <Ctx.Provider value={open}>
      {children}
      {top ? <RecordPanel key={`${top.type}-${top.id}-${stack.length}`} record={top} onClose={close} depth={stack.length} /> : null}
    </Ctx.Provider>
  );
}

/** Inline link to a shared record. */
export function RecordLink({ type, id, children }: RecordRef & { children: ReactNode }) {
  const open = useOpenRecord();
  return (
    <button
      className="btn ghost sm"
      style={{ height: 'auto', padding: '2px 4px', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}
      onClick={(e) => {
        e.stopPropagation();
        open({ type, id });
      }}
    >
      {children}
    </button>
  );
}

function RecordPanel({ record, onClose, depth }: { record: RecordRef; onClose: () => void; depth: number }) {
  const sub = depth > 1 ? `${depth - 1} panel${depth > 2 ? 's' : ''} behind this one` : undefined;
  if (record.type === 'trip') return <TripPanel id={record.id} onClose={onClose} sub={sub} />;
  if (record.type === 'passenger') return <PassengerPanel id={record.id} onClose={onClose} sub={sub} />;
  return <DriverPanel id={record.id} onClose={onClose} sub={sub} />;
}

export const TRIP_STATUS: Record<TripRecord['status'], { tone: Tone; text: string }> = {
  searching: { tone: 'info', text: 'Searching' },
  matched: { tone: 'info', text: 'Matched' },
  en_route: { tone: 'info', text: 'Driver on the way' },
  arrived: { tone: 'info', text: 'Driver arrived' },
  in_progress: { tone: 'info', text: 'On trip' },
  payment_pending: { tone: 'warning', text: 'Payment due' },
  completed: { tone: 'success', text: 'Completed' },
  cancelled: { tone: 'neutral', text: 'Cancelled' },
  no_driver: { tone: 'danger', text: 'No driver found' },
};
export const PAYMENT_STATE: Record<TripRecord['payment'], { tone: Tone; text: string }> = {
  not_due: { tone: 'neutral', text: 'Not due' },
  pending: { tone: 'warning', text: 'Pending' },
  processing: { tone: 'warning', text: 'Confirming' },
  paid: { tone: 'success', text: 'Paid' },
  failed: { tone: 'danger', text: 'Failed' },
  refunded: { tone: 'neutral', text: 'Refunded' },
  partly_refunded: { tone: 'neutral', text: 'Partly refunded' },
};

function Masked({ allowed, value }: { allowed: boolean; value?: string }) {
  if (!value) return <>Not set</>;
  return allowed ? <>{value}</> : (
    <span className="muted row" style={{ gap: 4 }}>
      <Icon name="lock" size={14} /> Hidden for your role
    </span>
  );
}

function TripPanel({ id, onClose, sub }: { id: string; onClose: () => void; sub?: string }) {
  const d = useData();
  const { can } = useSession();
  const open = useOpenRecord();
  const t = d.trips.find((x) => x.id === id);
  if (!t) return <Drawer title="Trip not found" onClose={onClose}>This trip isn’t in the test data.</Drawer>;
  const p = d.passengers.find((x) => x.id === t.passengerId);
  const dr = t.driverId ? d.drivers.find((x) => x.id === t.driverId) : undefined;
  const cases = d.cases.filter((c) => c.links.tripId === t.id && (c.team === 'care' ? can('cases.view') : can('safety.view')));
  const entries = d.ledger.filter((e) => e.links?.tripId === t.id);
  const st = TRIP_STATUS[t.status];
  const pay = PAYMENT_STATE[t.payment];
  return (
    <Drawer title={`Trip ${t.ref}`} sub={sub ?? `${city(t.city)} · ${when(t.requestedAt)}`} onClose={onClose}>
      <div className="row wrap">
        <Pill tone={st.tone}>{st.text}</Pill>
        <Pill tone={pay.tone}>Payment: {pay.text}</Pill>
        {t.directToDriver ? <Pill tone="info">Paid directly to driver</Pill> : null}
      </div>
      <KV
        items={[
          ['From', t.pickup],
          ['To', t.destination],
          ['Booking', t.mode === 'negotiate' ? 'Negotiated fare' : 'Quick Match'],
          ['Suggested fare', money(t.suggestedFare)],
          ['Agreed fare', t.agreedFare ? money(t.agreedFare) : 'Not agreed yet'],
          ['Method', t.paymentMethod === 'wallet' ? 'GoBye Wallet' : 'Bank transfer'],
          ['Passenger', p ? <button className="btn ghost sm" onClick={() => open({ type: 'passenger', id: p.id })}>{p.name}</button> : 'Not set'],
          ['Driver', dr ? <button className="btn ghost sm" onClick={() => open({ type: 'driver', id: dr.id })}>{dr.name}</button> : 'Not assigned'],
          ...(t.cancellation ? ([['Cancellation', `${label(t.cancellation.by)}: ${t.cancellation.reason}${t.cancellation.fee ? ` (fee ${money(t.cancellation.fee)})` : ''}`]] as [string, ReactNode][]) : []),
          ...(t.pickupDelaySeconds ? ([['Pickup delay', `${Math.round(t.pickupDelaySeconds / 60)} min beyond estimate`]] as [string, ReactNode][]) : []),
        ]}
      />
      {t.directToDriver ? (
        <Card muted>
          <div className="small">The passenger paid the driver’s own account. It is recorded here, but it is not credited to the driver’s GoBye earnings, so the fare is never counted twice. It can’t be verified automatically.</div>
        </Card>
      ) : null}
      <div>
        <h3 className="strong" style={{ marginBottom: 10 }}>Status timeline</h3>
        <Timeline items={t.timeline.map((x) => ({ at: x.at, title: x.label }))} />
      </div>
      {can('ledger.view') && entries.length ? (
        <div>
          <h3 className="strong" style={{ marginBottom: 10 }}>Ledger entries</h3>
          <div className="stack tight">
            {entries.map((e) => (
              <div key={e.id} className="row small">
                <span style={{ flex: 1 }}>{e.description} · {label(e.account.kind)}</span>
                <span className="num strong" style={{ color: e.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(e.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {cases.length ? (
        <div>
          <h3 className="strong" style={{ marginBottom: 10 }}>Linked cases</h3>
          {cases.map((c) => (
            <div key={c.id} className="row small">
              <Pill tone={c.team === 'safety' ? 'danger' : 'neutral'} icon={c.team === 'safety' ? 'safeAlert' : 'headphone'}>{c.ref}</Pill>
              <span>{c.subject}</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>{label(c.status)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Drawer>
  );
}

function PassengerPanel({ id, onClose, sub }: { id: string; onClose: () => void; sub?: string }) {
  const d = useData();
  const { can } = useSession();
  const open = useOpenRecord();
  const p: PassengerRecord | undefined = d.passengers.find((x) => x.id === id);
  const trips = useMemo(() => d.trips.filter((t) => t.passengerId === id).sort((a, b) => b.requestedAt - a.requestedAt), [d.trips, id]);
  if (!p) return <Drawer title="Passenger not found" onClose={onClose}>Not in the test data.</Drawer>;
  const wallet = balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: p.id });
  const cases = d.cases.filter((c) => c.links.passengerId === p.id && c.team === 'care');
  return (
    <Drawer title={p.name} sub={sub ?? `Passenger · ${city(p.city)} · joined ${date(p.joinedAt)}`} onClose={onClose}>
      <div className="row wrap">
        <Pill tone={p.status === 'active' ? 'success' : 'danger'}>{label(p.status)}</Pill>
        <Pill tone="neutral" icon="star">{p.rating.toFixed(1)}</Pill>
      </div>
      {p.restriction ? <Card muted><div className="small"><span className="strong">Restricted:</span> {p.restriction.reason} (by {p.restriction.by})</div></Card> : null}
      <KV
        items={[
          ['Phone', <Masked allowed={can('passengers.contact_details')} value={p.phone} />],
          ['Email', <Masked allowed={can('passengers.contact_details')} value={p.email} />],
          ['Trips', String(p.trips)],
          ['Last trip', when(p.lastTripAt)],
          ['Wallet balance', can('finance.view') || can('ledger.view') ? money(wallet) : <Masked allowed={false} value="x" />],
          ['Support cases', String(cases.length)],
        ]}
      />
      <div>
        <h3 className="strong" style={{ marginBottom: 10 }}>Recent trips</h3>
        <div className="stack tight">
          {trips.slice(0, 8).map((t) => (
            <button key={t.id} className="btn ghost" style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 6px' }} onClick={() => open({ type: 'trip', id: t.id })}>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span className="strong">{t.ref}</span> <span className="muted">{t.pickup} to {t.destination}</span>
              </span>
              <Pill tone={TRIP_STATUS[t.status].tone}>{TRIP_STATUS[t.status].text}</Pill>
            </button>
          ))}
          {!trips.length ? <span className="muted">No trips yet</span> : null}
        </div>
      </div>
    </Drawer>
  );
}

function DriverPanel({ id, onClose, sub }: { id: string; onClose: () => void; sub?: string }) {
  const d = useData();
  const { can } = useSession();
  const { now } = usePlatform();
  const dr: DriverRecord | undefined = d.drivers.find((x) => x.id === id);
  if (!dr) return <Drawer title="Driver not found" onClose={onClose}>Not in the test data.</Drawer>;
  const t = now();
  const accessActive = !!dr.access && dr.access.expiresAt > t;
  const expiring = dr.documents.filter((x) => x.expiresAt && x.expiresAt - t < 30 * 86_400_000);
  return (
    <Drawer title={dr.name} sub={sub ?? `Driver · ${city(dr.city)} · applied ${date(dr.appliedAt)}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="row wrap">
        <Pill tone={dr.verification === 'approved' ? 'success' : dr.verification === 'rejected' || dr.verification === 'suspended' ? 'danger' : 'warning'}>{label(dr.verification)}</Pill>
        <Pill tone={accessActive ? 'success' : 'neutral'} icon="ticket">{accessActive ? `${label(dr.access!.packageId)} access` : 'No active access'}</Pill>
        <Pill tone={dr.online ? 'success' : 'neutral'} icon="radar">{dr.online ? 'Online' : 'Offline'}</Pill>
      </div>
      <KV
        items={[
          ['Phone', <Masked allowed={can('drivers.contact_details')} value={dr.phone} />],
          ['Vehicle', `${dr.vehicle.colour} ${dr.vehicle.make} ${dr.vehicle.model} (${dr.vehicle.year})`],
          ['Plate', dr.vehicle.plate],
          ['Rating', dr.rating.toFixed(2)],
          ['Trips', String(dr.trips)],
          ['Acceptance', `${Math.round(dr.acceptanceRate * 100)}%`],
          ['Access until', dr.access ? when(dr.access.expiresAt) : 'No package'],
          ['Withdrawable', can('finance.view') ? money(withdrawable(d.ledger, dr.id)) : <Masked allowed={false} value="x" />],
          ['Payout account', dr.bankAccount ? (can('finance.view') || can('drivers.verify') ? `${dr.bankAccount.bankName} ${dr.bankAccount.accountNumberMasked}${dr.bankAccount.verified ? '' : ' (not verified)'}` : <Masked allowed={false} value="x" />) : 'Not added'],
        ]}
      />
      <div>
        <h3 className="strong" style={{ marginBottom: 10 }}>Documents</h3>
        <div className="stack tight">
          {dr.documents.map((doc) => (
            <div key={doc.kind} className="row small">
              <span style={{ flex: 1 }}>{label(doc.kind)}</span>
              {doc.expiresAt ? <span className="muted">{doc.expiresAt < t ? 'Expired' : 'Expires'} {date(doc.expiresAt)}</span> : null}
              <Pill tone={doc.status === 'accepted' ? 'success' : doc.status === 'submitted' ? 'warning' : doc.status === 'missing' ? 'neutral' : 'danger'}>{label(doc.status)}</Pill>
            </div>
          ))}
        </div>
        {expiring.length ? <div className="small muted" style={{ marginTop: 8 }}>{expiring.length} document{expiring.length > 1 ? 's' : ''} expired or expiring within 30 days.</div> : null}
      </div>
    </Drawer>
  );
}
