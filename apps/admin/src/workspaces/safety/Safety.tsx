import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseRecord } from '@gobye/core';
import { RecordLink, TRIP_STATUS } from '@/data/records';
import { useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { city, label, when } from '@/data/format';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Empty, Field, KV, Notice, PageHead, Pill, Section, Skeleton, Stat, Table, type Column } from '@/ui/kit';
import { ActionTimeline, Block, FormDialog, MessageStreams, PriorityPill, StatusPill, WideDrawer, actorName } from '../care/caseKit';
import { applyMessage, applyResolve, applyStatus, formatAge, isOpen } from '../care/logic';
import {
  ACK_TARGET_MIN,
  ackState,
  allowedSafetyActions,
  applyAcknowledge,
  applyEscalateLead,
  applyRecordAction,
  applyRestrictDriver,
  restrictBlockReason,
  safetyQueue,
} from './logic';

const caseTarget = (c: CaseRecord) => ({ type: 'case' as const, id: c.id, label: c.ref });

/** Re-render every 30 s so elapsed times stay current. Elapsed only: nothing here counts down. */
function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const h = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
}

export default function Safety() {
  useTick();
  const d = useData();
  const { now } = usePlatform();
  const { staff, can } = useSession();
  const keep = useScopedFilter();
  const act = useAction();
  const [openId, setOpenId] = useState<string | null>(null);
  const t = now();
  const me = staff?.id;

  // Open cases ignore the date filter (an old open incident still needs attention); city scope applies.
  const queue = useMemo(() => safetyQueue(d.cases.filter((c) => c.team === 'safety' && keep(c.city, undefined, t))), [d.cases, keep, t]);
  const done = useMemo(
    () => d.cases.filter((c) => c.team === 'safety' && !isOpen(c.status) && keep(c.city, c.openedAt, t)).sort((a, b) => (b.resolution?.at ?? b.openedAt) - (a.resolution?.at ?? a.openedAt)),
    [d.cases, keep, t],
  );
  const unassigned = queue.filter((c) => !c.ownerId).length;
  const escalated = queue.filter((c) => c.status === 'escalated').length;
  const late = queue.filter((c) => !c.ownerId && ackState(c, t).overTarget).length;

  const acknowledge = (c: CaseRecord) =>
    act(
      {
        label: 'Acknowledge safety case',
        apply: (dr, x) => (x.actor.kind === 'staff' ? applyAcknowledge(dr, c.id, x.actor, x.now) : { ok: false, error: 'Only staff can acknowledge' }),
        audit: () => ({ action: 'safety.acknowledged', target: caseTarget(c), summary: `Acknowledged ${c.ref}` }),
      },
      `${c.ref} acknowledged. You own it now`,
    );

  const doneCols: Column<CaseRecord>[] = [
    { key: 'case', label: 'Case', render: (c) => <div><div className="cell-title">{c.subject}</div><div className="cell-sub">{c.ref} · {city(c.city)}</div></div> },
    { key: 'status', label: 'Status', render: (c) => <StatusPill s={c.status} /> },
    { key: 'owner', label: 'Owner', render: (c) => (c.ownerId ? (d.staff.find((s) => s.id === c.ownerId)?.name ?? 'Unknown') : 'Unassigned') },
    { key: 'raised', label: 'Raised', render: (c) => when(c.openedAt, t) },
    { key: 'resolved', label: 'Resolved', render: (c) => (c.resolution ? when(c.resolution.at, t) : <span className="muted">No summary</span>) },
  ];

  return (
    <>
      <PageHead title="Safety" sub="Urgent incidents with trip context. Restricted information; every access is logged. Test data." />
      <div className="stack" style={{ marginBottom: 16 }}>
        <Notice icon="shield">Access to safety cases is logged. Opening a case that shows a location records an audit event with your name.</Notice>
        {!can('safety.work') ? <Notice icon="eye">You can view safety cases but not act on them. Actions are hidden for your role.</Notice> : null}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 8 }}>
        <Stat label="Open safety cases" value={queue.length} />
        <Stat label="Not acknowledged" value={unassigned} tone={unassigned ? 'danger' : undefined} sub={late ? `${late} past the ${ACK_TARGET_MIN} min target` : `Target: acknowledge within ${ACK_TARGET_MIN} min`} />
        <Stat label="With safety lead" value={escalated} sub="Escalated cases" />
        <Stat label="Resolved or closed" value={done.length} sub="In the selected dates" />
      </div>

      <div className="split">
        <div>
          <Section title="Urgent queue">
            {queue.length ? (
              <div className="stack">
                {queue.map((c) => (
                  <QueueItem key={c.id} c={c} now={t} meId={me} canWork={can('safety.work')} onOpen={() => setOpenId(c.id)} onAck={() => acknowledge(c)} />
                ))}
              </div>
            ) : (
              <Card>
                <Empty icon="checkCircle" title="No open safety cases">New alerts from the passenger or driver app appear here first.</Empty>
              </Card>
            )}
          </Section>
          <Section title="Resolved and closed">
            <Card flush>
              <Table rows={done} columns={doneCols} rowKey={(c) => c.id} onRowClick={(c) => setOpenId(c.id)} empty={<Empty icon="history" title="No resolved safety cases">Try a wider date range.</Empty>} />
            </Card>
          </Section>
        </div>
        <div className="stack" style={{ marginTop: 28, gap: 14 }}>
          <Card title="How alerts arrive">
            <div className="stack small">
              <p>A safety alert from the passenger or driver app creates a case here with the trip, both people and the last shared location attached.</p>
              <p>The designated responders are notified at the same time and the case starts unassigned at urgent priority.</p>
              <p className="muted">In this prototype the cases come from test data and no notifications are sent.</p>
            </div>
          </Card>
          <Card title="Response target" muted>
            <div className="small stack">
              <p>Acknowledge within {ACK_TARGET_MIN} minutes of the alert. The queue shows time elapsed since the alert, not a countdown.</p>
              <p className="muted">The target is a placeholder for the owner to confirm.</p>
            </div>
          </Card>
        </div>
      </div>

      {openId ? <SafetyCaseView key={openId} id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function AckLine({ c, now }: { c: CaseRecord; now: number }) {
  const a = ackState(c, now);
  if (!a.acknowledged) {
    return (
      <span className="row wrap small" style={{ gap: 6 }}>
        <Pill tone="danger" icon="alert">
          Not acknowledged
        </Pill>
        <span className={a.overTarget ? 'strong' : 'muted'}>
          {a.elapsedMin} min elapsed, target {ACK_TARGET_MIN} min
        </span>
      </span>
    );
  }
  return (
    <span className="row wrap small" style={{ gap: 6 }}>
      <Pill tone={a.overTarget ? 'warning' : 'success'} icon={a.overTarget ? 'time' : 'checkCircle'}>
        Acknowledged after {a.elapsedMin} min
      </Pill>
    </span>
  );
}

function QueueItem({ c, now, meId, canWork, onOpen, onAck }: { c: CaseRecord; now: number; meId?: string; canWork: boolean; onOpen: () => void; onAck: () => Promise<unknown> }) {
  const d = useData();
  const owner = c.ownerId ? d.staff.find((s) => s.id === c.ownerId) : undefined;
  const trip = c.links.tripId ? d.trips.find((x) => x.id === c.links.tripId) : undefined;
  return (
    <div className="card" style={!c.ownerId ? { borderColor: 'var(--danger)', borderWidth: 2 } : undefined}>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <Icon name="safeAlert" size={22} style={{ color: !c.ownerId ? 'var(--danger)' : 'var(--text-2)', marginTop: 2 }} />
        <div className="stack tight" style={{ flex: 1, minWidth: 220 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="strong">{c.subject}</span>
            <span className="muted small">{c.ref}</span>
          </div>
          <div className="small muted">
            Raised {formatAge(now - c.openedAt)} ago · {city(c.city)}
            {trip ? ` · trip ${trip.ref}, ${TRIP_STATUS[trip.status].text.toLowerCase()}` : ''}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <StatusPill s={c.status} />
            {owner ? (
              <Pill tone="neutral" icon="user">
                {owner.id === meId ? 'You' : owner.name}
              </Pill>
            ) : null}
            <AckLine c={c} now={now} />
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {canWork && c.ownerId !== meId ? (
            <Button variant={c.ownerId ? 'secondary' : 'danger'} size="sm" icon="check" onClick={onAck}>
              {c.ownerId ? 'Take over' : 'Acknowledge'}
            </Button>
          ) : null}
          <Button size="sm" icon="right" onClick={onOpen}>
            Open
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Case view ---------------- */

type Dialog = null | 'call_passenger' | 'call_driver' | 'escalate' | 'restrict' | 'emergency' | 'resolve' | 'close';

function LastLocation({ c }: { c: CaseRecord }) {
  const { can } = useSession();
  const { mutate, now } = usePlatform();
  const allowed = can('safety.location') && !!c.safetyContext;
  const [state, setState] = useState<'logging' | 'shown' | 'error'>('logging');
  const [err, setErr] = useState('');
  const started = useRef(false);

  const log = async () => {
    setState('logging');
    const r = await mutate({
      label: 'View safety location',
      latency: 300,
      apply: () => ({ ok: true }),
      audit: () => ({ action: 'safety.location_viewed', target: caseTarget(c), summary: `Viewed last known location for ${c.ref}` }),
    });
    if (r.ok) setState('shown');
    else {
      setErr(r.error);
      setState('error');
    }
  };
  useEffect(() => {
    if (!allowed || started.current) return;
    started.current = true;
    void log();
    // Log once per opening of this case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!can('safety.location')) {
    return (
      <div className="muted small row" style={{ gap: 6 }}>
        <Icon name="lock" size={14} /> Last known location is restricted to the safety team.
      </div>
    );
  }
  if (!c.safetyContext) return <div className="muted small">No location was shared with this case. It was not raised from an in app alert.</div>;
  if (state === 'logging') return <Skeleton rows={2} />;
  if (state === 'error')
    return (
      <div className="stack">
        <Notice tone="warning">Your access couldn’t be recorded, so the location stays hidden. {err}</Notice>
        <div>
          <Button size="sm" icon="refresh" onClick={log}>
            Try again
          </Button>
        </div>
      </div>
    );
  return (
    <div className="stack tight">
      <div className="row" style={{ gap: 6 }}>
        <Icon name="mapPin" size={16} />
        <span className="strong">{c.safetyContext.lastLocation}</span>
      </div>
      <span className="muted small">
        Shared with the alert {when(c.safetyContext.sharedAt, now())}. Approximate, from test data. Your view was logged.
      </span>
    </div>
  );
}

function SafetyCaseView({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { staff, can } = useSession();
  const act = useAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState('');
  const c = d.cases.find((x) => x.id === id && x.team === 'safety');
  if (!c) {
    return (
      <WideDrawer title="Case not found" onClose={onClose}>
        <Empty icon="safeAlert" title="This safety case isn’t available">Close this panel and pick another case.</Empty>
      </WideDrawer>
    );
  }
  const t = now();
  const me = staff?.id;
  const trip = c.links.tripId ? d.trips.find((x) => x.id === c.links.tripId) : undefined;
  const passenger = c.links.passengerId ? d.passengers.find((x) => x.id === c.links.passengerId) : undefined;
  const driver = c.links.driverId ? d.drivers.find((x) => x.id === c.links.driverId) : undefined;
  const owner = c.ownerId ? d.staff.find((s) => s.id === c.ownerId) : undefined;
  const canWork = can('safety.work');
  const actions = allowedSafetyActions(c, { canWork, canRestrict: can('drivers.restrict'), meId: me, driver });
  const has = (a: (typeof actions)[number]) => actions.includes(a);
  const restrictReason = restrictBlockReason(driver, can('drivers.restrict'));
  const responders = c.safetyContext?.responders ?? [];

  const close = () => {
    setDialog(null);
    setNote('');
  };
  const run = async (spec: Parameters<typeof act>[0], ok: string) => {
    const r = await act(spec, ok);
    if (r.ok) close();
    return r.ok;
  };
  const record = (labelText: string, auditAction: string, ok: string) =>
    run({ label: labelText, apply: (dr, x) => applyRecordAction(dr, c.id, labelText, x.actor, x.now), audit: () => ({ action: auditAction, target: caseTarget(c), summary: `${c.ref}: ${labelText}` }) }, ok);

  const phone = (who: 'passenger' | 'driver') => {
    const allowed = can(who === 'passenger' ? 'passengers.contact_details' : 'drivers.contact_details');
    const value = who === 'passenger' ? passenger?.phone : driver?.phone;
    if (!value) return <span className="muted">Not available</span>;
    return allowed ? (
      <span className="num">{value}</span>
    ) : (
      <span className="muted row" style={{ gap: 4 }}>
        <Icon name="lock" size={14} /> Hidden for your role
      </span>
    );
  };

  return (
    <WideDrawer title={`${c.ref} · ${c.subject}`} sub={`Safety · ${city(c.city)} · raised ${when(c.openedAt, t)} by ${actorName(c.openedBy)}`} onClose={onClose}>
      <div className="stack">
        <div className="row wrap">
          <PriorityPill p={c.priority} />
          <StatusPill s={c.status} />
          <Pill tone={owner ? 'neutral' : 'danger'} icon="user">
            {owner ? `Owner: ${owner.id === me ? 'you' : owner.name}` : 'Unassigned'}
          </Pill>
          {isOpen(c.status) ? <AckLine c={c} now={t} /> : null}
        </div>
        {canWork ? (
          <div className="row wrap" style={{ gap: 8 }}>
            {has('acknowledge') ? (
              <Button
                size="sm"
                variant={c.ownerId ? 'secondary' : 'danger'}
                icon="check"
                onClick={() =>
                  run(
                    {
                      label: 'Acknowledge safety case',
                      apply: (dr, x) => (x.actor.kind === 'staff' ? applyAcknowledge(dr, c.id, x.actor, x.now) : { ok: false, error: 'Only staff can acknowledge' }),
                      audit: () => ({ action: 'safety.acknowledged', target: caseTarget(c), summary: `Acknowledged ${c.ref}` }),
                    },
                    'Acknowledged. You own this case now',
                  )
                }
              >
                {c.ownerId ? 'Take over' : 'Acknowledge'}
              </Button>
            ) : null}
            {has('call') ? (
              <>
                <Button size="sm" icon="phone" onClick={() => setDialog('call_passenger')} disabledReason={passenger ? undefined : 'No passenger linked'}>
                  Call passenger
                </Button>
                <Button size="sm" icon="phone" onClick={() => setDialog('call_driver')} disabledReason={driver ? undefined : 'No driver linked'}>
                  Call driver
                </Button>
              </>
            ) : null}
            {has('escalate_lead') ? (
              <Button size="sm" icon="arrowRight" onClick={() => setDialog('escalate')}>
                Escalate to safety lead
              </Button>
            ) : null}
            {isOpen(c.status) ? (
              <Button size="sm" variant="danger-soft" icon="userForbid" onClick={() => setDialog('restrict')} disabledReason={restrictReason}>
                Restrict driver
              </Button>
            ) : null}
            {has('emergency') ? (
              <Button size="sm" variant="danger-soft" icon="alarm" onClick={() => setDialog('emergency')}>
                Contact emergency services
              </Button>
            ) : null}
            {has('resolve') ? (
              <Button size="sm" icon="checkCircle" onClick={() => setDialog('resolve')}>
                Resolve
              </Button>
            ) : null}
            {has('close') ? (
              <Button size="sm" icon="lock" onClick={() => setDialog('close')}>
                Close
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {c.resolution ? (
        <Notice tone="success" icon="checkCircle">
          <div className="strong">Resolution</div>
          <div>{c.resolution.summary}</div>
          <div className="small">{when(c.resolution.at, t)}</div>
        </Notice>
      ) : null}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Trip context">
          {trip ? (
            <div className="stack">
              <div className="row wrap">
                <Pill tone={TRIP_STATUS[trip.status].tone}>{TRIP_STATUS[trip.status].text}</Pill>
              </div>
              <KV
                items={[
                  ['Trip', <RecordLink type="trip" id={trip.id}>{trip.ref}</RecordLink>],
                  ['Route', `${trip.pickup} to ${trip.destination}`],
                  ['Passenger', passenger ? <RecordLink type="passenger" id={passenger.id}>{passenger.name}</RecordLink> : <span className="muted">None</span>],
                  ['Passenger phone', phone('passenger')],
                  ['Driver', driver ? <RecordLink type="driver" id={driver.id}>{driver.name}</RecordLink> : <span className="muted">None</span>],
                  ['Driver phone', phone('driver')],
                  ['Vehicle', driver ? `${driver.vehicle.colour} ${driver.vehicle.make} ${driver.vehicle.model}, ${driver.vehicle.plate}` : <span className="muted">Not available</span>],
                  ['Driver status', driver ? label(driver.verification) : <span className="muted">Not available</span>],
                ]}
              />
            </div>
          ) : (
            <div className="muted small">No trip is linked to this case.</div>
          )}
        </Card>
        <div className="stack" style={{ gap: 14 }}>
          <Card title="Last known location">
            <LastLocation c={c} />
          </Card>
          <Card title="Designated responders">
            {responders.length ? (
              <div className="stack tight">
                {responders.map((r) => (
                  <div key={r} className="row small">
                    <Icon name="shield" size={14} /> {r}
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted small">No responders listed. This case was opened by staff, not by an in app alert.</div>
            )}
            <div className="muted small" style={{ marginTop: 8 }}>
              Responders are notified when an alert arrives. Not sent in this prototype.
            </div>
          </Card>
        </div>
      </div>

      <Block title="Escalation timeline" icon="history">
        <ActionTimeline c={c} />
      </Block>

      <MessageStreams
        c={c}
        canWrite={canWork && isOpen(c.status)}
        writeReason={!canWork ? 'Read only for your role' : !isOpen(c.status) ? 'This case is resolved' : undefined}
        onSend={async (channel, body) => {
          const r = await act(
            {
              label: channel === 'customer' ? 'Reply to customer' : 'Add internal note',
              apply: (dr, x) => applyMessage(dr, c.id, channel, body, x.actor, x.now),
              audit: () => ({ action: channel === 'customer' ? 'safety.replied' : 'safety.note_added', target: caseTarget(c), summary: channel === 'customer' ? `Replied to customer on ${c.ref}` : `Added internal note on ${c.ref}` }),
            },
            channel === 'customer' ? 'Reply added to the conversation' : 'Internal note added',
          );
          return r.ok;
        }}
      />

      {dialog === 'call_passenger' || dialog === 'call_driver' ? (
        <FormDialog
          title={dialog === 'call_passenger' ? `Call ${passenger?.name ?? 'passenger'}` : `Call ${driver?.name ?? 'driver'}`}
          confirmLabel="Record call"
          onCancel={close}
          onConfirm={() => {
            const who = dialog === 'call_passenger' ? 'passenger' : 'driver';
            return record(`Called ${who} (simulated, no call placed)${note.trim() ? `: ${note.trim()}` : ''}`, 'safety.call_recorded', 'Call recorded on the case');
          }}
        >
          <KV items={[['Phone', phone(dialog === 'call_passenger' ? 'passenger' : 'driver')]]} />
          <Notice tone="warning">Simulated: no call is placed in this prototype. Recording it adds an entry to the escalation timeline.</Notice>
          <Field label="Outcome (optional)">{(fid) => <textarea id={fid} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Passenger answered and is safe" />}</Field>
        </FormDialog>
      ) : null}
      {dialog === 'emergency' ? (
        <FormDialog
          title="Contact emergency services"
          danger
          confirmLabel="Record emergency contact"
          onCancel={close}
          onConfirm={() => record(`Emergency services contact recorded (simulated, no call placed)${note.trim() ? `: ${note.trim()}` : ''}`, 'safety.emergency_recorded', 'Emergency contact recorded')}
        >
          <Notice tone="danger">Simulated: no call is placed in this prototype. In the live service this step will connect to the agreed emergency contact process.</Notice>
          <Field label="Details (optional)">{(fid) => <textarea id={fid} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Location shared with responders" />}</Field>
        </FormDialog>
      ) : null}
      {dialog === 'escalate' ? (
        <ConfirmDialog
          title={`Escalate ${c.ref} to the safety lead`}
          body="The case is marked escalated and the reason is added to the timeline."
          confirmLabel="Escalate"
          requireReason
          onCancel={close}
          onConfirm={(reason) =>
            run({ label: 'Escalate to safety lead', apply: (dr, x) => applyEscalateLead(dr, c.id, reason, x.actor, x.now), audit: () => ({ action: 'safety.escalated', target: caseTarget(c), summary: `Escalated ${c.ref} to safety lead`, reason }) }, 'Escalated to the safety lead')
          }
        />
      ) : null}
      {dialog === 'restrict' && driver ? (
        <ConfirmDialog
          title={`Restrict ${driver.name}`}
          body={`Verification changes from ${label(driver.verification)} to Suspended and the driver is taken offline until onboarding reviews the case. The reason is audited.`}
          confirmLabel="Restrict driver"
          danger
          requireReason
          onCancel={close}
          onConfirm={(reason) =>
            run(
              {
                label: 'Restrict driver',
                apply: (dr, x) => applyRestrictDriver(dr, c.id, reason, x.actor, x.now),
                audit: () => ({
                  action: 'driver.restricted',
                  target: { type: 'driver', id: driver.id, label: driver.name },
                  summary: `Restricted ${driver.name} pending review (safety case ${c.ref})`,
                  diff: [{ field: 'verification', from: driver.verification, to: 'suspended' }],
                  reason,
                }),
              },
              'Driver restricted pending review',
            )
          }
        />
      ) : null}
      {dialog === 'resolve' ? <ResolveSafety c={c} onCancel={close} run={run} /> : null}
      {dialog === 'close' ? (
        <ConfirmDialog
          title={`Close ${c.ref}`}
          body="Closed cases can’t be reopened."
          confirmLabel="Close case"
          onCancel={close}
          onConfirm={() =>
            run({ label: 'Close safety case', apply: (dr, x) => applyStatus(dr, c.id, 'closed', x.actor, x.now, 'Closed'), audit: () => ({ action: 'safety.closed', target: caseTarget(c), summary: `Closed ${c.ref}`, diff: [{ field: 'status', from: c.status, to: 'closed' }] }) }, 'Case closed')
          }
        />
      ) : null}
    </WideDrawer>
  );
}

function ResolveSafety({ c, onCancel, run }: { c: CaseRecord; onCancel: () => void; run: (spec: Parameters<ReturnType<typeof useAction>>[0], ok: string) => Promise<boolean> }) {
  const [summary, setSummary] = useState('');
  return (
    <FormDialog
      title={`Resolve ${c.ref}`}
      body="Summarise the outcome: who was contacted, what was done, and any restriction still in place."
      confirmLabel="Resolve case"
      blockReason={!summary.trim() ? 'Add a resolution summary' : undefined}
      onCancel={onCancel}
      onConfirm={() =>
        run(
          { label: 'Resolve safety case', apply: (dr, x) => applyResolve(dr, c.id, summary, undefined, x.actor, x.now), audit: () => ({ action: 'safety.resolved', target: caseTarget(c), summary: `Resolved ${c.ref}: ${summary.trim()}`, diff: [{ field: 'status', from: c.status, to: 'resolved' }] }) },
          'Safety case resolved',
        )
      }
    >
      <Field label="Resolution summary">{(id) => <textarea id={id} className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />}</Field>
    </FormDialog>
  );
}
