import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  CHECKS,
  ISSUES,
  formatDistance,
  formatDuration,
  logRelayEvent,
  type CheckState,
  type IssueCode,
  type RelayApplication,
  type RelayEvent,
  type RelayPerson,
  type RelayResponse,
  type RelayRide,
  type VerificationCheckId,
} from '@gobye/core';
import { date, label, money, when } from '@/data/format';
import { useSession } from '@/data/session';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, KV, Notice, PageHead, Pill, Section, Segmented, Skeleton, Stat, Table, Tabs, Timeline } from '@/ui/kit';
import {
  APP_STATUS,
  CHECK_STATE,
  ISSUE_OPTIONS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  RIDE_STATUS,
  allChecksPassed,
  approvePatch,
  cancelRidePatch,
  connectionFromEnv,
  demoCounts,
  fullChecks,
  isActiveRide,
  openIssueCount,
  rejectPatch,
  requestChangesPatch,
  rideTimeline,
  setCheckPatch,
  waitingChecks,
  waitingReasonsFor,
  type DemoConnection,
} from './logic';

const conn: DemoConnection | null = connectionFromEnv(import.meta.env);
const POLL_MS = 3_000;

interface Snapshot {
  people: RelayPerson[];
  apps: RelayApplication[];
  rides: RelayRide[];
  events: RelayEvent[];
}

/** Polls the shared demo relay (D-049). Keeps the last good snapshot when a poll fails. */
function useRelayData(c: DemoConnection) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [people, apps, rides, events] = await Promise.all([
        c.relay.select<RelayPerson>('demo_people', { order: ['created_at', 'desc'], limit: 200 }),
        c.relay.select<RelayApplication>('demo_driver_applications', { order: ['updated_at', 'desc'], limit: 200 }),
        c.relay.select<RelayRide>('demo_rides', { order: ['created_at', 'desc'], limit: 200 }),
        c.relay.select<RelayEvent>('demo_events', { order: ['at', 'desc'], limit: 60 }),
      ]);
      setData({ people, apps, rides, events });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Can’t reach the demo relay.');
    }
  }, [c]);
  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  return { data, error, refresh: load };
}

type TabId = 'overview' | 'applications' | 'rides' | 'people';

export default function Demo() {
  if (!conn) return <NotConnected />;
  return <Connected c={conn} />;
}

function NotConnected() {
  return (
    <>
      <PageHead title="Connected demo" sub="Riders, drivers and staff sharing the same test records." />
      <Notice tone="info">
        This admin isn’t connected to a demo relay, so the rider and driver apps can’t reach it yet. Everything here is test data, never real people or money.
      </Notice>
      <Card title="Connect on one Wi-Fi network (quickest)">
        <ol className="stack" style={{ paddingLeft: 18 }}>
          <li>
            At the repo root run <code>npm run demo:relay</code>. It prints the relay address and writes <code>apps/admin/.env.local</code>, <code>apps/rider/.env.local</code> and <code>apps/driver/.env.local</code>.
          </li>
          <li>
            Restart the admin with <code>npm run dev</code> (or <code>npm run admin</code> at the root), and the apps with <code>npx expo start -c</code>.
          </li>
          <li>Phones must be on the same Wi-Fi as this computer.</li>
        </ol>
      </Card>
      <Card title="Or connect over the internet (Supabase)">
        <p className="muted">
          Run <code>supabase/migrations/20261022_demo_relay.sql</code> in the Supabase SQL editor, then set <code>VITE_DEMO_RELAY_URL</code> and <code>VITE_DEMO_RELAY_KEY</code> (the project URL and anon key) in{' '}
          <code>apps/admin/.env.local</code>. See <code>apps/admin/.env.example</code>. Drop the demo tables after the demo.
        </p>
      </Card>
    </>
  );
}

function ConnectionLine({ c }: { c: DemoConnection }) {
  const s = useSyncExternalStore(c.status.subscribe, c.status.get);
  const tone = s.state === 'online' ? 'success' : s.state === 'offline' ? 'danger' : 'warning';
  const text = s.state === 'online' ? 'Connected' : s.state === 'offline' ? 'Relay unreachable' : 'Connecting…';
  return (
    <div className="row wrap">
      <Pill tone={tone}>{text}</Pill>
      <span className="muted small">{s.host}</span>
      {s.state === 'offline' && s.error ? <span className="muted small">· {s.error}</span> : null}
    </div>
  );
}

function Connected({ c }: { c: DemoConnection }) {
  const { data, error, refresh } = useRelayData(c);
  const [tab, setTab] = useState<TabId>('overview');
  const counts = data ? demoCounts(data.people, data.apps, data.rides) : null;
  return (
    <>
      <PageHead title="Connected demo" sub="The rider app, the driver app and this admin share these records. Test data only." actions={<ConnectionLine c={c} />} />
      {error && data ? <Notice tone="warning">Showing the last update. {error}</Notice> : null}
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'applications', label: 'Driver applications', count: counts ? counts.inReview : undefined },
          { value: 'rides', label: 'Rides', count: counts ? counts.live : undefined },
          { value: 'people', label: 'People', count: data ? data.people.length : undefined },
        ]}
      />
      {!data ? (
        error ? (
          <Empty title="Can’t reach the demo relay" icon="alert" action={<Button onClick={refresh} icon="refresh">Try again</Button>}>
            {error} Check that <code>npm run demo:relay</code> is running.
          </Empty>
        ) : (
          <Skeleton rows={6} />
        )
      ) : tab === 'overview' ? (
        <Overview data={data} onTab={setTab} />
      ) : tab === 'applications' ? (
        <Applications c={c} apps={data.apps} refresh={refresh} />
      ) : tab === 'rides' ? (
        <Rides c={c} rides={data.rides} refresh={refresh} />
      ) : (
        <People people={data.people} />
      )}
    </>
  );
}

/* ---------- Overview ---------- */

function Overview({ data, onTab }: { data: Snapshot; onTab: (t: TabId) => void }) {
  const n = demoCounts(data.people, data.apps, data.rides);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid cols-4">
        <Stat label="Riders" value={n.riders} onClick={() => onTab('people')} />
        <Stat label="Drivers" value={n.drivers} sub={`${n.approved} approved`} onClick={() => onTab('people')} />
        <Stat label="Waiting for review" value={n.inReview} tone={n.inReview ? 'warning' : undefined} onClick={() => onTab('applications')} />
        <Stat label="Changes requested" value={n.changes} onClick={() => onTab('applications')} />
        <Stat label="Live rides" value={n.live} tone={n.live ? 'info' : undefined} onClick={() => onTab('rides')} />
        <Stat label="Completed rides" value={n.completed} onClick={() => onTab('rides')} />
      </div>
      <Section title="Activity">
        {data.events.length ? (
          <Card flush>
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 16, gap: 12 }}>
              {data.events.map((e) => (
                <li key={e.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <Pill tone={e.actor === 'driver' ? 'info' : 'neutral'} icon={e.actor === 'admin' ? 'shield' : e.actor === 'driver' ? 'steering' : 'user'}>
                    {label(e.actor)}
                  </Pill>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{e.summary}</div>
                    <div className="muted small">{when(e.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Empty title="Nothing yet" icon="history">
            Sign up in the rider or driver app and it shows here.
          </Empty>
        )}
      </Section>
    </div>
  );
}

/* ---------- Driver applications ---------- */

function Applications({ c, apps, refresh }: { c: DemoConnection; apps: RelayApplication[]; refresh: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = apps.find((a) => a.id === openId) ?? null;
  return (
    <>
      <Table
        rows={apps}
        rowKey={(a) => a.id}
        onRowClick={(a) => setOpenId(a.id)}
        empty={<Empty title="No driver applications yet" icon="steering">When a driver registers in the driver app, the application appears here.</Empty>}
        columns={[
          { key: 'driver', label: 'Driver', render: (a) => <span className="strong">{a.driver_name}</span> },
          { key: 'phone', label: 'Phone', render: (a) => a.phone },
          { key: 'city', label: 'City', render: (a) => a.city ?? 'Not set' },
          { key: 'status', label: 'Status', render: (a) => <Pill tone={APP_STATUS[a.status].tone}>{APP_STATUS[a.status].label}</Pill> },
          { key: 'submitted', label: 'Submitted', render: (a) => (a.submitted_at ? when(a.submitted_at) : 'Not yet') },
          { key: 'issues', label: 'Open issues', align: 'right', render: (a) => openIssueCount(a) || '–' },
          { key: 'waiting', label: 'Waiting checks', align: 'right', render: (a) => waitingChecks(a).length || '–' },
        ]}
      />
      {open ? <ApplicationDrawer c={c} a={open} onClose={() => setOpenId(null)} refresh={refresh} /> : null}
    </>
  );
}

function ApplicationDrawer({ c, a, onClose, refresh }: { c: DemoConnection; a: RelayApplication; onClose: () => void; refresh: () => Promise<void> }) {
  const { staff } = useSession();
  const staffName = staff?.name ?? 'Staff';
  const [mode, setMode] = useState<'view' | 'changes'>('view');
  const [picked, setPicked] = useState<Partial<Record<IssueCode, string>>>({});
  const [changeNote, setChangeNote] = useState('');
  const pickedCodes = Object.keys(picked) as IssueCode[];
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const app = a.application;
  const inReview = a.status === 'pending_review';

  const write = async (patch: Partial<RelayApplication>, type: string, summary: string) => {
    setError(null);
    try {
      await c.relay.update<RelayApplication>('demo_driver_applications', { id: a.id }, patch);
      logRelayEvent(c.relay, { actor: 'admin', type, summary, person_id: a.id });
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save. Try again.');
      return false;
    }
  };

  const setCheck = async (id: VerificationCheckId, state: CheckState, note?: string) => {
    const r = setCheckPatch(a, id, state, Date.now(), note);
    if (!r.ok) return setError(r.error);
    const name = CHECKS.find((x) => x.id === id)!.label;
    await write(r.value, 'application.check', `${staffName} set ${name} to ${CHECK_STATE[state].label.toLowerCase()} for ${a.driver_name}`);
  };

  const approve = async () => {
    const r = approvePatch(a, staffName, Date.now());
    if (!r.ok) return setError(r.error);
    if (await write(r.value, 'application.approved', `${staffName} approved ${a.driver_name}`)) setDialog(null);
  };

  const reject = async (reason: string) => {
    const r = rejectPatch(a, reason, staffName, Date.now());
    if (!r.ok) return setError(r.error);
    if (await write(r.value, 'application.rejected', `${staffName} rejected ${a.driver_name}: ${reason}`)) setDialog(null);
  };

  const sendChanges = async () => {
    const issues = pickedCodes.map((code) => ({ code, note: picked[code] }));
    const r = requestChangesPatch(a, issues, Date.now(), changeNote);
    if (!r.ok) return setError(r.error);
    const titles = issues.map((i) => ISSUES[i.code].title.toLowerCase()).join(', ');
    if (await write(r.value, 'application.changes_requested', `${staffName} asked ${a.driver_name} to fix: ${titles}`)) {
      setMode('view');
      setPicked({});
      setChangeNote('');
    }
  };

  return (
    <>
      <Drawer
        title={a.driver_name}
        sub={
          <span className="row wrap" style={{ gap: 6 }}>
            <Pill tone={APP_STATUS[a.status].tone}>{APP_STATUS[a.status].label}</Pill>
            <span>{a.phone}</span>
            <span>· Test data</span>
          </span>
        }
        onClose={onClose}
        footer={
          mode === 'changes' ? (
            <div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button variant="ghost" onClick={() => setMode('view')}>
                Back
              </Button>
              <Button variant="primary" disabledReason={pickedCodes.length ? undefined : 'Choose at least one item'} onClick={sendChanges}>
                Send to driver{pickedCodes.length ? ` (${pickedCodes.length})` : ''}
              </Button>
            </div>
          ) : (
            <div className="row wrap" style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button variant="danger-soft" onClick={() => setDialog('reject')} disabledReason={a.status === 'approved' || a.status === 'rejected' ? 'Already decided' : undefined}>
                Reject
              </Button>
              <Button onClick={() => setMode('changes')} icon="edit" disabledReason={inReview ? undefined : 'Only while in review'}>
                Request changes
              </Button>
              <Button
                variant="primary"
                icon="checkCircle"
                onClick={() => (allChecksPassed(a, now) ? approve() : setDialog('approve'))}
                disabledReason={!inReview ? 'Only while in review' : openIssueCount(a) ? 'Driver has items to fix' : undefined}
              >
                Approve
              </Button>
            </div>
          )
        }
      >
        <div className="stack" style={{ gap: 18 }}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {a.review_note && (a.status === 'changes_requested' || a.status === 'rejected') ? <Notice tone={a.status === 'rejected' ? 'danger' : 'info'}>Note to driver: {a.review_note}</Notice> : null}
          {mode === 'changes' ? (
            <RequestChanges picked={picked} setPicked={setPicked} note={changeNote} setNote={setChangeNote} />
          ) : (
            <>
              <Section title="Checks">
                <div className="stack">
                  {fullChecks(a, now).map((ch) => {
                    const meta = CHECKS.find((x) => x.id === ch.id)!;
                    const reasons = waitingReasonsFor(ch.id);
                    return (
                      <div key={ch.id} className="card" style={{ padding: 12 }}>
                        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
                          <div className="row" style={{ gap: 8 }}>
                            <span className="strong">{meta.label}</span>
                            <Pill tone={CHECK_STATE[ch.state].tone}>{CHECK_STATE[ch.state].label}</Pill>
                          </div>
                          {inReview ? (
                            <Segmented<CheckState>
                              label={`${meta.label} state`}
                              value={ch.state}
                              onChange={(s) => void setCheck(ch.id, s)}
                              options={(['queued', 'checking', 'waiting', 'passed', 'failed'] as CheckState[]).map((s) => ({ value: s, label: CHECK_STATE[s].label }))}
                            />
                          ) : null}
                        </div>
                        {ch.state === 'waiting' ? (
                          <div className="stack tight" style={{ marginTop: 8 }}>
                            {inReview && reasons.length > 1 ? (
                              <select className="select" aria-label="Waiting reason" value={ch.note ?? reasons[0].text} onChange={(e) => void setCheck(ch.id, 'waiting', e.target.value)}>
                                {reasons.map((r) => (
                                  <option key={r.id} value={r.text}>
                                    {r.text}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="muted small">Driver sees: {ch.note ?? reasons[0].text}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Section>
              {a.issues.length ? (
                <Section title="Items flagged to the driver">
                  <div className="stack">
                    {a.issues.map((i) => (
                      <div key={i.id} className="row" style={{ alignItems: 'flex-start' }}>
                        <Pill tone={i.resolvedAt ? 'success' : 'warning'}>{i.resolvedAt ? 'Fixed' : 'Open'}</Pill>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="strong">{ISSUES[i.code].title}</div>
                          <div className="muted small">
                            Raised {when(i.raisedAt)}
                            {i.resolvedAt ? ` · fixed ${when(i.resolvedAt)}` : ''}
                            {i.note ? ` · “${i.note}”` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}
              <Section title="About the driver">
                <KV
                  items={[
                    ['Name', app.personal ? `${app.personal.firstName} ${app.personal.lastName}` : null],
                    ['Email', app.personal?.email ?? null],
                    ['City', app.personal?.city ?? a.city],
                    ['Submitted', a.submitted_at ? when(a.submitted_at) : 'Not yet'],
                    ['Decided', a.decided_at ? `${when(a.decided_at)} by ${a.decided_by ?? 'staff'}` : null],
                  ]}
                />
              </Section>
              <Section title="Licence and identity">
                <KV
                  items={[
                    ['Licence number', app.licence?.number ?? null],
                    ['Licence expiry', app.licence ? date(Date.parse(app.licence.expiry)) : null],
                    ['Licence photo', app.licence ? (app.licence.hasPhoto ? 'Provided' : 'Missing') : null],
                    ['ID type', app.identity ? (app.identity.type === 'nin' ? 'NIN' : label(app.identity.type)) : null],
                    ['ID number', app.identity?.number ?? null],
                    ['Selfie', app.identity ? (app.identity.hasSelfie ? 'Provided' : 'Missing') : null],
                  ]}
                />
                <p className="muted small">Photos stay on the driver’s phone in this demo; numbers are masked to the last four digits.</p>
              </Section>
              <Section title="Vehicle and papers">
                <KV
                  items={[
                    ['Vehicle', app.vehicle ? `${app.vehicle.colour} ${app.vehicle.make} ${app.vehicle.model} (${app.vehicle.year})` : null],
                    ['Plate', app.vehicle?.plate ?? null],
                    ['Category', app.vehicle ? label(app.vehicle.category) : null],
                    ['Vehicle licence', app.documents.registration ? 'Provided' : 'Missing'],
                    ['Insurance', app.documents.insurance ? 'Provided' : 'Missing'],
                    ['Roadworthiness', app.documents.roadworthiness ? 'Provided' : 'Missing'],
                  ]}
                />
              </Section>
            </>
          )}
        </div>
      </Drawer>
      {dialog === 'approve' ? (
        <ConfirmDialog
          title="Approve with checks not passed?"
          body="Some checks haven’t passed yet. Approving marks every check as passed and lets this driver go online."
          confirmLabel="Approve driver"
          onConfirm={approve}
          onCancel={() => setDialog(null)}
        />
      ) : dialog === 'reject' ? (
        <ConfirmDialog title={`Reject ${a.driver_name}?`} body="The driver sees the reason and can’t go online." confirmLabel="Reject" danger requireReason onConfirm={reject} onCancel={() => setDialog(null)} />
      ) : null}
    </>
  );
}

type Picked = Partial<Record<IssueCode, string>>;
function RequestChanges({ picked, setPicked, note, setNote }: { picked: Picked; setPicked: (f: (p: Picked) => Picked) => void; note: string; setNote: (v: string) => void }) {
  return (
    <Section title="Request changes">
      <p className="muted small">The driver sees each item with how to fix it, and the step to open. Add a note if it helps.</p>
      <div className="stack">
        {ISSUE_OPTIONS.map((o) => {
          const on = o.code in picked;
          return (
            <div key={o.code} className="card" style={{ padding: 12 }}>
              <label className="row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setPicked((p) => {
                      const next = { ...p };
                      if (e.target.checked) next[o.code] = '';
                      else delete next[o.code];
                      return next;
                    })
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="strong">{o.title}</span>
                  <span className="muted small" style={{ display: 'block' }}>
                    {o.fix}
                  </span>
                </span>
              </label>
              {on ? (
                <input
                  className="input"
                  style={{ width: '100%', marginTop: 8 }}
                  placeholder="Optional note for this item"
                  aria-label={`Note for ${o.title}`}
                  value={picked[o.code] ?? ''}
                  onChange={(e) => setPicked((p) => ({ ...p, [o.code]: e.target.value }))}
                />
              ) : null}
            </div>
          );
        })}
        <Field label="Message to the driver (optional)">
          {(id) => <textarea id={id} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Our team checked your documents and needs a few changes." />}
        </Field>
      </div>
    </Section>
  );
}

/* ---------- Rides ---------- */

function Rides({ c, rides, refresh }: { c: DemoConnection; rides: RelayRide[]; refresh: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'live' | 'done'>('all');
  const open = rides.find((r) => r.id === openId) ?? null;
  const shown = useMemo(() => rides.filter((r) => (filter === 'all' ? true : filter === 'live' ? isActiveRide(r) : !isActiveRide(r))), [rides, filter]);
  return (
    <>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Segmented
          label="Ride filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'live', label: 'Live' },
            { value: 'done', label: 'Finished' },
          ]}
        />
      </div>
      <Table
        rows={shown}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        empty={<Empty title="No rides yet" icon="route">Book a ride in the rider app and it appears here.</Empty>}
        columns={[
          { key: 'status', label: 'Status', render: (r) => <Pill tone={RIDE_STATUS[r.status].tone}>{RIDE_STATUS[r.status].label}</Pill> },
          { key: 'kind', label: 'Type', render: (r) => (r.kind === 'negotiate' ? 'Negotiated' : 'Quick Match') },
          { key: 'rider', label: 'Rider', render: (r) => r.rider.name },
          { key: 'driver', label: 'Driver', render: (r) => (r.driver ? [r.driver.firstName, r.driver.lastName].filter(Boolean).join(' ') : '–') },
          { key: 'route', label: 'Trip', render: (r) => <span className="muted small">{r.pickup.title} → {r.destination.title}</span> },
          { key: 'fare', label: 'Fare', align: 'right', render: (r) => money(r.agreed_fare ?? r.offer?.amount ?? r.fare) },
          { key: 'pay', label: 'Payment', render: (r) => <Pill tone={PAYMENT_STATUS[r.payment_status].tone}>{PAYMENT_STATUS[r.payment_status].label}</Pill> },
          { key: 'at', label: 'Requested', render: (r) => when(r.created_at) },
        ]}
      />
      {open ? <RideDrawer c={c} r={open} onClose={() => setOpenId(null)} refresh={refresh} /> : null}
    </>
  );
}

function RideDrawer({ c, r, onClose, refresh }: { c: DemoConnection; r: RelayRide; onClose: () => void; refresh: () => Promise<void> }) {
  const { staff } = useSession();
  const [responses, setResponses] = useState<RelayResponse[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (r.kind !== 'negotiate') return;
    let live = true;
    const load = () =>
      c.relay
        .select<RelayResponse>('demo_ride_responses', { where: { ride_id: r.id }, order: ['created_at', 'asc'] })
        .then((x) => live && setResponses(x))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [c, r.id, r.kind]);

  const cancel = async (reason: string) => {
    const p = cancelRidePatch(r, reason, Date.now());
    if (!p.ok) return setError(p.error);
    try {
      const rows = await c.relay.update<RelayRide>('demo_rides', { id: r.id, status: r.status }, p.value);
      if (!rows.length) return setError('The ride changed while you were looking. Check it again.');
      logRelayEvent(c.relay, { actor: 'admin', type: 'ride.cancelled', summary: `${staff?.name ?? 'Staff'} cancelled ${r.rider.name}’s ride: ${reason}`, ride_id: r.id });
      setCancelOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t cancel. Try again.');
    }
  };

  const d = r.driver;
  return (
    <>
      <Drawer
        title={`${r.pickup.title} → ${r.destination.title}`}
        sub={
          <span className="row wrap" style={{ gap: 6 }}>
            <Pill tone={RIDE_STATUS[r.status].tone}>{RIDE_STATUS[r.status].label}</Pill>
            <span>{r.kind === 'negotiate' ? 'Negotiated' : 'Quick Match'}</span>
            <span>· Test ride</span>
          </span>
        }
        onClose={onClose}
        footer={
          isActiveRide(r) ? (
            <div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button variant="danger-soft" onClick={() => setCancelOpen(true)}>
                Cancel ride
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="stack" style={{ gap: 18 }}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Section title="Trip">
            <KV
              items={[
                ['Pickup', `${r.pickup.title}, ${r.pickup.subtitle}`],
                ['Drop-off', `${r.destination.title}, ${r.destination.subtitle}`],
                ['Distance', formatDistance(r.route.distance_meters)],
                ['Time', formatDuration(r.route.duration_seconds)],
                ['Platform fare', money(r.fare)],
                ['Rider’s offer', r.offer ? `${money(r.offer.amount)} (round ${r.offer.round})` : null],
                ['Agreed fare', r.agreed_fare ? money(r.agreed_fare) : null],
                ['Payment', `${PAYMENT_METHOD[r.payment_method]} · ${PAYMENT_STATUS[r.payment_status].label}`],
                ['PIN shared with driver', r.pickup_pin ? 'Yes' : 'No'],
              ]}
            />
          </Section>
          <Section title="People">
            <KV
              items={[
                ['Rider', `${r.rider.name} · ${r.rider.phone}`],
                ['Driver', d ? `${[d.firstName, d.lastName].filter(Boolean).join(' ')} · ${d.id}` : 'Not matched'],
                ['Vehicle', d ? `${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}` : null],
                ['Plate', d?.vehicle.plate ?? null],
                ['Driver position', r.driver_location ? `Updated ${when(r.driver_location.at)}` : null],
              ]}
            />
          </Section>
          {r.kind === 'negotiate' ? (
            <Section title="Driver answers">
              {responses.length ? (
                <Table
                  rows={responses}
                  rowKey={(x) => x.id}
                  columns={[
                    { key: 'd', label: 'Driver', render: (x) => x.driver.firstName },
                    { key: 'k', label: 'Answer', render: (x) => <Pill tone={x.kind === 'accept' ? 'success' : 'info'}>{x.kind === 'accept' ? 'Accepted offer' : 'Counter'}</Pill> },
                    { key: 'a', label: 'Amount', align: 'right', render: (x) => money(x.amount) },
                    { key: 't', label: 'When', render: (x) => when(x.created_at) },
                  ]}
                />
              ) : (
                <p className="muted small">No driver has answered yet.</p>
              )}
            </Section>
          ) : null}
          <Section title="Timeline">
            <Timeline items={rideTimeline(r)} />
          </Section>
        </div>
      </Drawer>
      {cancelOpen ? (
        <ConfirmDialog title="Cancel this ride?" body="The rider and driver apps see it as cancelled by GoBye." confirmLabel="Cancel ride" danger requireReason onConfirm={cancel} onCancel={() => setCancelOpen(false)} />
      ) : null}
    </>
  );
}

/* ---------- People ---------- */

function People({ people }: { people: RelayPerson[] }) {
  const [role, setRole] = useState<'all' | 'rider' | 'driver'>('all');
  const rows = people.filter((p) => role === 'all' || p.role === role);
  return (
    <>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Segmented
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'rider', label: 'Riders' },
            { value: 'driver', label: 'Drivers' },
          ]}
        />
      </div>
      <Table
        rows={rows}
        rowKey={(p) => `${p.role}-${p.id}`}
        empty={<Empty title="Nobody yet" icon="group">Accounts created in the rider and driver apps appear here.</Empty>}
        columns={[
          { key: 'name', label: 'Name', render: (p) => <span className="strong">{p.name}</span> },
          { key: 'role', label: 'Role', render: (p) => <Pill tone={p.role === 'driver' ? 'info' : 'neutral'} icon={p.role === 'driver' ? 'steering' : 'user'}>{label(p.role)}</Pill> },
          { key: 'phone', label: 'Phone', render: (p) => p.phone },
          { key: 'email', label: 'Email', render: (p) => p.email ?? '–' },
          { key: 'city', label: 'City', render: (p) => p.city ?? '–' },
          { key: 'joined', label: 'Joined', render: (p) => when(p.created_at) },
          { key: 'seen', label: 'Last seen', render: (p) => when(p.last_seen_at) },
        ]}
      />
    </>
  );
}
