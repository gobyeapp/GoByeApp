import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { balanceOf, withdrawable, type DriverRecord, type PassengerRecord, type TripRecord } from '@gobye/core';
import { Icon } from '@/ui/Icon';
import { Button, Drawer, KV, Notice, Pill, Tabs, Timeline, type Tone } from '@/ui/kit';
import type { IconName } from '@/ui/Icon';
import '@/workspaces/people/people.css';
import { eligibility, timelineFor } from '@/workspaces/subscriptions/logic';
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
      className="link-btn"
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

/** A titled block inside a side sheet: same heading style in every record panel and review drawer. */
export function PanelSection({ title, icon, aside, children }: { title: string; icon?: IconName; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel-section" aria-label={title}>
      <div className="panel-section-head">
        {icon ? <Icon name={icon} size={16} /> : null}
        <h3>{title}</h3>
        {aside ? <span className="aside">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

const DOC_TONE: Record<string, Tone> = { accepted: 'success', submitted: 'warning', missing: 'neutral', rejected: 'danger', expired: 'danger' };

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
  const person = (name: string, onClick: () => void) => (
    <button className="link-btn" onClick={onClick}>
      {name}
    </button>
  );
  return (
    <Drawer title={`Trip ${t.ref}`} sub={sub ?? `${city(t.city)} · ${when(t.requestedAt)}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="panel-pills">
        <Pill tone={st.tone}>{st.text}</Pill>
        <Pill tone={pay.tone} icon="wallet">Payment: {pay.text}</Pill>
        <Pill tone="neutral" icon={t.mode === 'negotiate' ? 'exchange' : 'route'}>{t.mode === 'negotiate' ? 'Negotiated' : 'Quick Match'}</Pill>
        {t.directToDriver ? <Pill tone="info">Paid directly to driver</Pill> : null}
      </div>

      <PanelSection title="Route" icon="mapPin">
        <div className="route">
          <span className="dot from" aria-hidden />
          <div><div className="cell-sub">Pickup</div><div className="strong">{t.pickup}</div></div>
          <span className="line" aria-hidden />
          <span />
          <span className="dot to" aria-hidden />
          <div><div className="cell-sub">Destination</div><div className="strong">{t.destination}</div></div>
        </div>
      </PanelSection>

      <PanelSection title="Fare and payment" icon="wallet">
        <KV
          items={[
            ['Booking', t.mode === 'negotiate' ? 'Negotiated fare' : 'Quick Match'],
            ['Suggested fare', <span className="num">{money(t.suggestedFare)}</span>],
            ['Agreed fare', t.agreedFare ? <span className="num strong">{money(t.agreedFare)}</span> : 'Not agreed yet'],
            ['Method', t.paymentMethod === 'wallet' ? 'GoBye Wallet' : 'Bank transfer'],
            ['Payment', pay.text],
            ...(t.cancellation ? ([['Cancellation', `${label(t.cancellation.by)}: ${t.cancellation.reason}${t.cancellation.fee ? ` (fee ${money(t.cancellation.fee)})` : ''}`]] as [string, ReactNode][]) : []),
          ]}
        />
        {t.directToDriver ? (
          <Notice icon="info">The passenger paid the driver’s own account. It is recorded here, but it is not credited to the driver’s GoBye earnings, so the fare is never counted twice. It can’t be verified automatically.</Notice>
        ) : null}
      </PanelSection>

      {t.negotiation ? (
        <PanelSection title="Fare negotiation" icon="exchange" aside={t.negotiation.outcome === 'agreed' ? 'Agreed' : t.negotiation.outcome === 'expired' ? 'Expired' : 'Open'}>
          <KV
            items={[
              ['Suggested fare', <span className="num">{money(t.suggestedFare)}</span>],
              ['Rider offer', <span className="num">{money(t.negotiation.riderOffer)}</span>],
              ['Final agreed fare', t.agreedFare && t.negotiation.outcome === 'agreed' ? <span className="num strong">{money(t.agreedFare)}</span> : 'None'],
              ['Offer open until', when(t.negotiation.expiresAt)],
            ]}
          />
          <Timeline
            items={t.negotiation.events.map((e) => ({
              at: e.at,
              title: e.kind === 'offer' ? `Rider offered ${money(e.amount)}` : e.kind === 'accept' ? `${e.driverName ?? 'A driver'} accepted ${money(e.amount)}` : e.kind === 'counter' ? `${e.driverName ?? 'A driver'} countered ${money(e.amount)}` : e.kind === 'select' ? `Rider chose ${e.driverName ?? 'a driver'} at ${money(e.amount)}` : 'Offer expired with no agreement',
            }))}
          />
          <span className="small muted">Fares belong to the driver. GoBye takes 0% commission, so none of this is GoBye revenue.</span>
        </PanelSection>
      ) : null}

      <PanelSection title="People" icon="group">
        <KV
          items={[
            ['Passenger', p ? person(p.name, () => open({ type: 'passenger', id: p.id })) : 'Not set'],
            ['Driver', dr ? person(dr.name, () => open({ type: 'driver', id: dr.id })) : 'Not assigned'],
            ...(dr ? ([['Vehicle', `${dr.vehicle.colour} ${dr.vehicle.make} ${dr.vehicle.model} · ${dr.vehicle.plate}`]] as [string, ReactNode][]) : []),
            ...(t.pickupDelaySeconds ? ([['Pickup delay', `${Math.round(t.pickupDelaySeconds / 60)} min beyond estimate`]] as [string, ReactNode][]) : []),
          ]}
        />
      </PanelSection>

      <PanelSection title="Status timeline" icon="history">
        <Timeline items={t.timeline.map((x) => ({ at: x.at, title: x.label }))} />
      </PanelSection>

      {can('ledger.view') && entries.length ? (
        <PanelSection title="Ledger entries" icon="list" aside={`${entries.length}`}>
          <div className="panel-list">
            {entries.map((e) => (
              <div key={e.id} className="panel-list-row">
                <span className="grow">
                  <span style={{ display: 'block' }}>{e.description}</span>
                  <span className="cell-sub">{label(e.account.kind)}</span>
                </span>
                <span className="num strong" style={{ color: e.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(e.amount)}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      ) : null}
      {cases.length ? (
        <PanelSection title="Linked cases" icon="headphone" aside={`${cases.length}`}>
          <div className="panel-list">
            {cases.map((c) => (
              <div key={c.id} className="panel-list-row">
                <Pill tone={c.team === 'safety' ? 'danger' : 'neutral'} icon={c.team === 'safety' ? 'safeAlert' : 'headphone'}>{c.ref}</Pill>
                <span className="grow">{c.subject}</span>
                <span className="muted">{label(c.status)}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      ) : null}
    </Drawer>
  );
}

type PassengerView = 'overview' | 'rides' | 'payments' | 'support' | 'safety';

function PassengerPanel({ id, onClose, sub }: { id: string; onClose: () => void; sub?: string }) {
  const d = useData();
  const { can } = useSession();
  const { now } = usePlatform();
  const open = useOpenRecord();
  const [view, setView] = useState<PassengerView>('overview');
  const p: PassengerRecord | undefined = d.passengers.find((x) => x.id === id);
  const trips = useMemo(() => d.trips.filter((t) => t.passengerId === id).sort((a, b) => b.requestedAt - a.requestedAt), [d.trips, id]);
  if (!p) return <Drawer title="Passenger not found" onClose={onClose}>Not in the test data.</Drawer>;
  const t = now();
  const seeMoney = can('finance.view') || can('ledger.view');
  const wallet = balanceOf(d.ledger, { kind: 'passenger_wallet', ownerId: p.id });
  const payments = d.collections.filter((c) => c.payerType === 'passenger' && c.payerId === p.id).sort((a, b) => b.createdAt - a.createdAt);
  const careCases = d.cases.filter((c) => c.links.passengerId === p.id && c.team === 'care');
  const safetyCases = d.cases.filter((c) => c.links.passengerId === p.id && c.team === 'safety');
  const contact = can('passengers.contact_details');
  const views: { value: PassengerView; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'rides', label: 'Rides', count: trips.length },
    { value: 'payments', label: 'Payments', count: seeMoney ? payments.length : undefined },
    { value: 'support', label: 'Support', count: can('cases.view') ? careCases.length : undefined },
    { value: 'safety', label: 'Safety', count: can('safety.view') ? safetyCases.length : undefined },
  ];
  const caseList = (xs: typeof careCases) => (
    <div className="panel-list">
      {xs.map((c) => (
        <div key={c.id} className="panel-list-row">
          <Pill tone={c.team === 'safety' ? 'danger' : 'neutral'} icon={c.team === 'safety' ? 'safeAlert' : 'headphone'}>{c.ref}</Pill>
          <span className="grow">
            <span style={{ display: 'block' }}>{c.subject}</span>
            <span className="cell-sub">Opened {when(c.openedAt, t)} · {label(c.priority)} priority</span>
          </span>
          <span className="muted small">{label(c.status)}</span>
        </div>
      ))}
    </div>
  );
  return (
    <Drawer title={p.name} sub={sub ?? `Rider · ${city(p.city)} · registered ${date(p.joinedAt)}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="panel-pills">
        <Pill tone={p.status === 'active' ? 'success' : p.status === 'restricted' ? 'danger' : 'neutral'} icon={p.status === 'restricted' ? 'userForbid' : undefined}>{label(p.status)}</Pill>
        <Pill tone="neutral" icon="star">{p.rating.toFixed(1)}</Pill>
        <Pill tone="neutral" icon="route">{p.trips} trips</Pill>
      </div>
      <div className="sheet-tabs"><Tabs value={view} onChange={setView} tabs={views} /></div>
      {view === 'overview' ? (
        <>
          {p.restriction ? (
            <Notice tone="danger" icon="userForbid">
              <div className="strong">Restricted: can’t book trips</div>
              <div className="restrict-note">
                {p.restriction.reason} · by {p.restriction.by}
                {p.restriction.until ? ` · until ${date(p.restriction.until)}` : ' · no end date'}
              </div>
            </Notice>
          ) : null}
          <PanelSection title="Account" icon="user" aside={contact ? undefined : 'Contact details hidden for your role'}>
            <KV
              items={[
                ['Rider ID', p.id],
                ['City', city(p.city)],
                ['Registered', date(p.joinedAt)],
                ['Status', label(p.status)],
                ['Phone', <Masked allowed={contact} value={p.phone} />],
                ['Email', <Masked allowed={contact} value={p.email} />],
              ]}
            />
          </PanelSection>
          <PanelSection title="Activity" icon="chart">
            <KV
              items={[
                ['Trips', String(p.trips)],
                ['Last trip', when(p.lastTripAt, t)],
                ['Wallet balance', seeMoney ? <span className="num">{money(wallet)}</span> : <Masked allowed={false} value="x" />],
                ['Support cases', can('cases.view') ? String(careCases.length) : <Masked allowed={false} value="x" />],
              ]}
            />
          </PanelSection>
        </>
      ) : null}
      {view === 'rides' ? (
        <PanelSection title="Ride history" icon="route" aside={trips.length > 12 ? `12 of ${trips.length}` : undefined}>
          {trips.length ? (
            <div className="panel-list">
              {trips.slice(0, 12).map((tr) => (
                <button key={tr.id} className="panel-list-row" onClick={() => open({ type: 'trip', id: tr.id })}>
                  <span className="grow">
                    <span className="strong" style={{ display: 'block' }}>{tr.ref} · {tr.mode === 'negotiate' ? 'Negotiated' : 'Quick Match'}</span>
                    <span className="cell-sub">{tr.pickup} to {tr.destination} · {when(tr.requestedAt, t)}</span>
                  </span>
                  {tr.agreedFare ? <span className="num small">{money(tr.agreedFare)}</span> : null}
                  <Pill tone={TRIP_STATUS[tr.status].tone}>{TRIP_STATUS[tr.status].text}</Pill>
                </button>
              ))}
            </div>
          ) : (
            <span className="small muted">No rides yet.</span>
          )}
        </PanelSection>
      ) : null}
      {view === 'payments' ? (
        <PanelSection title="Payment activity" icon="wallet" aside={seeMoney ? `Wallet ${money(wallet)}` : undefined}>
          {!seeMoney ? (
            <span className="small muted row" style={{ gap: 6 }}><Icon name="lock" size={14} /> Payment activity needs finance access.</span>
          ) : payments.length ? (
            <div className="panel-list">
              {payments.slice(0, 12).map((c) => (
                <div key={c.id} className="panel-list-row">
                  <span className="grow">
                    <span style={{ display: 'block' }}>{c.purpose === 'wallet_funding' ? 'Wallet funding' : c.purpose === 'trip_payment' ? 'Trip payment by transfer' : label(c.purpose)}</span>
                    <span className="cell-sub">{c.provider} · {when(c.createdAt, t)}</span>
                  </span>
                  <span className="num strong small">{money(c.amount)}</span>
                  <Pill tone={c.status === 'successful' ? 'success' : c.status === 'pending' || c.status === 'initiated' ? 'warning' : c.status === 'failed' ? 'danger' : 'neutral'}>{label(c.status)}</Pill>
                </div>
              ))}
            </div>
          ) : (
            <span className="small muted">No payments recorded. Wallet trips are charged inside GoBye and appear on each ride.</span>
          )}
        </PanelSection>
      ) : null}
      {view === 'support' ? (
        <PanelSection title="Support history" icon="headphone">
          {!can('cases.view') ? <span className="small muted">Support history needs care access.</span> : careCases.length ? caseList(careCases) : <span className="small muted">No support cases.</span>}
        </PanelSection>
      ) : null}
      {view === 'safety' ? (
        <PanelSection title="Safety records" icon="shield">
          {!can('safety.view') ? (
            <span className="small muted row" style={{ gap: 6 }}><Icon name="lock" size={14} /> Safety records are restricted to the safety team.</span>
          ) : safetyCases.length ? (
            caseList(safetyCases)
          ) : (
            <span className="small muted">No safety reports involve this rider.</span>
          )}
        </PanelSection>
      ) : null}
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
  const tl = timelineFor(d.subscriptions, dr.id, t);
  const accessActive = tl.access.active;
  const expiring = dr.documents.filter((x) => x.expiresAt && x.expiresAt - t < 30 * 86_400_000);
  return (
    <Drawer title={dr.name} sub={sub ?? `Driver · ${city(dr.city)} · applied ${date(dr.appliedAt)}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="panel-pills">
        <Pill tone={dr.verification === 'approved' ? 'success' : dr.verification === 'rejected' || dr.verification === 'suspended' ? 'danger' : 'warning'}>{label(dr.verification)}</Pill>
        <Pill tone={accessActive ? 'success' : 'neutral'} icon="ticket">{accessActive ? `${label(tl.access.currentPlan!)} access${tl.summary.scheduled ? `, ${tl.summary.scheduled} queued` : ''}` : 'No active access'}</Pill>
        <Pill tone="neutral" icon="radar">{dr.online ? 'Online' : 'Offline'}</Pill>
        {(() => { const e = eligibility(dr, tl); return <Pill tone={e.eligible ? 'success' : 'neutral'} icon={e.eligible ? 'checkCircle' : 'lock'}>{e.eligible ? 'Can accept rides' : e.reason}</Pill>; })()}
      </div>
      <PanelSection title="Driver" icon="steering">
        <KV
          items={[
            ['Driver ID', dr.id],
            ['City', city(dr.city)],
            ['Phone', <Masked allowed={can('drivers.contact_details')} value={dr.phone} />],
            ['Rating', dr.rating.toFixed(2)],
            ['Trips', String(dr.trips)],
            ['Acceptance', `${Math.round(dr.acceptanceRate * 100)}%`],
          ]}
        />
      </PanelSection>
      <PanelSection title="Vehicle" icon="car">
        <KV
          items={[
            ['Vehicle', `${dr.vehicle.colour} ${dr.vehicle.make} ${dr.vehicle.model} (${dr.vehicle.year})`],
            ['Plate', dr.vehicle.plate],
          ]}
        />
      </PanelSection>
      <PanelSection title="Subscription and payouts" icon="ticket">
        <KV
          items={[
            ['Subscription', dr.access ? `${dr.access.packageId === 'daily' ? 'Daily' : 'Monthly'} pass ${accessActive ? 'until' : 'ended'} ${when(dr.access.expiresAt, t)}` : 'No pass bought'],
            ['Withdrawable', can('finance.view') ? <span className="num">{money(withdrawable(d.ledger, dr.id))}</span> : <Masked allowed={false} value="x" />],
            ['Payout account', dr.bankAccount ? (can('finance.view') || can('drivers.verify') ? `${dr.bankAccount.bankName} ${dr.bankAccount.accountNumberMasked}${dr.bankAccount.verified ? '' : ' (not verified)'}` : <Masked allowed={false} value="x" />) : 'Not added'],
          ]}
        />
      </PanelSection>
      <PanelSection title="Documents" icon="document" aside={expiring.length ? `${expiring.length} expired or expiring within 30 days` : undefined}>
        <div className="panel-list">
          {dr.documents.map((doc) => (
            <div key={doc.kind} className="panel-list-row">
              <span className="grow">
                <span style={{ display: 'block' }}>{label(doc.kind)}</span>
                <span className="cell-sub">{doc.expiresAt ? `${doc.expiresAt < t ? 'Expired' : 'Expires'} ${date(doc.expiresAt)}` : 'No expiry'}</span>
              </span>
              <Pill tone={DOC_TONE[doc.status] ?? 'neutral'}>{label(doc.status)}</Pill>
            </div>
          ))}
        </div>
      </PanelSection>
    </Drawer>
  );
}
