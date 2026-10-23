import { useMemo, useState, type ReactNode } from 'react';
import { CITY_LABELS, withdrawable, type CityId, type DocumentKind, type DriverDocument, type DriverRecord, type DriverVerification } from '@gobye/core';
import { count, date, label, money, when } from '@/data/format';
import { PanelSection, TRIP_STATUS, useOpenRecord } from '@/data/records';
import { useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Drawer, Empty, FeaturedStat, FilterBar, KV, Meter, Notice, PageHead, Pill, SearchInput, Select, Stat, Table, Tabs, Timeline, type Column, type Tone } from '@/ui/kit';
import { PLAN_LABEL, eligibility, subscriptionRecords, timelineFor } from '@/workspaces/subscriptions/logic';
import './people.css';
import {
  DOC_LABELS,
  REQUIRED_DOCS,
  REVIEW_STATES,
  SUBSCRIPTION_STATE_LABEL,
  accessStatus,
  applyVerification,
  categoryLabel,
  docStatus,
  documentReadiness,
  expiringDocuments,
  reviewDocument,
  subscriptionState,
  verificationActions,
  type ExpiryRow,
  type SubscriptionState,
  type VerificationAction,
} from './logic';

type Tab = 'review' | 'all' | 'expiry' | 'rejected';
export const VER_TONE: Record<DriverVerification, Tone> = { applied: 'info', documents_pending: 'warning', in_review: 'warning', approved: 'success', rejected: 'danger', suspended: 'danger' };
const DOC_TONE = { accepted: 'success', submitted: 'warning', missing: 'neutral', rejected: 'danger', expired: 'danger' } as const;
const DOC_ROW = { accepted: 'ok', submitted: 'wait', missing: '', rejected: 'bad', expired: 'bad' } as const;
const DOC_ICON = { accepted: 'checkCircle', submitted: 'time', missing: 'document', rejected: 'alert', expired: 'alert' } as const;
const ACTION_UI: Record<VerificationAction, { text: string; done: string; audit: string; variant: 'primary' | 'secondary' | 'danger-soft'; reason?: string; body: string }> = {
  start_review: { text: 'Start review', done: 'Moved to review', audit: 'driver.review_started', variant: 'secondary', body: 'The application moves to In review.' },
  request_documents: { text: 'Request documents', done: 'Documents requested. The driver app shows what to upload.', audit: 'driver.documents_requested', variant: 'secondary', reason: 'What the driver needs to upload', body: 'The driver is asked to upload or replace documents. Your note is shown to them.' },
  approve: { text: 'Approve', done: 'Driver approved', audit: 'driver.approved', variant: 'primary', body: 'Driver app updates; going online also needs an active access package.' },
  reject: { text: 'Reject', done: 'Application rejected', audit: 'driver.rejected', variant: 'danger-soft', reason: 'Reason', body: 'The driver is told the reason and can apply again later.' },
  suspend: { text: 'Suspend', done: 'Driver suspended and taken offline', audit: 'driver.suspended', variant: 'danger-soft', reason: 'Reason', body: 'The driver goes offline straight away and can’t take trips until reinstated.' },
  reinstate: { text: 'Reinstate', done: 'Driver reinstated', audit: 'driver.reinstated', variant: 'primary', body: 'Driver app updates; going online also needs an active access package.' },
};

export default function Drivers() {
  const d = useData();
  const { now } = usePlatform();
  const { inScope } = useSession();
  const keepRow = useScopedFilter();
  const [tab, setTab] = useState<Tab>('review');
  const [q, setQ] = useState('');
  const [ver, setVer] = useState<DriverVerification | 'all'>('all');
  const [cat, setCat] = useState<string>('all');
  const [sub, setSub] = useState<SubscriptionState | 'all'>('all');
  const [cityF, setCityF] = useState<CityId | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const t = now();

  // People lists follow the city filter and your city scope, not the date range.
  const scoped = d.drivers.filter((x) => keepRow(x.city, undefined, t));
  const s = q.trim().toLowerCase();
  const match = (x: DriverRecord) =>
    (!s || x.name.toLowerCase().includes(s) || x.id.includes(s) || x.vehicle.plate.toLowerCase().includes(s)) &&
    (cat === 'all' || x.vehicle.category === cat) &&
    (sub === 'all' || subscriptionState(x, t) === sub) &&
    (cityF === 'all' || x.city === cityF);
  const review = scoped.filter((x) => REVIEW_STATES.includes(x.verification)).sort((a, b) => a.appliedAt - b.appliedAt);
  const rejected = scoped.filter((x) => x.verification === 'rejected');
  const expiry = expiringDocuments(scoped, t);
  const byId = new Map(d.drivers.map((x) => [x.id, x]));
  const selected = openId ? d.drivers.find((x) => x.id === openId) : undefined;
  const categories = [...new Set(d.drivers.map((x) => x.vehicle.category))];
  const cities = (['lagos', 'abuja'] as CityId[]).filter(inScope);

  const online = scoped.filter((x) => x.online).length;
  const subscribers = scoped.filter((x) => x.access && x.access.expiresAt > t).length;
  const approved = scoped.filter((x) => x.verification === 'approved').length;
  const docsPending = review.filter((x) => x.verification === 'documents_pending').length;

  const acceptedDocs = (x: DriverRecord) => REQUIRED_DOCS.filter((k) => { const doc = x.documents.find((y) => y.kind === k); return doc && docStatus(doc, t) === 'accepted'; }).length;
  const docSummary = (x: DriverRecord) => {
    const ok = acceptedDocs(x);
    return (
      <div className="doc-progress">
        <span className="small num">{ok} of {REQUIRED_DOCS.length} accepted</span>
        <Meter value={ok / REQUIRED_DOCS.length} label={`${x.name}: ${ok} of ${REQUIRED_DOCS.length} required documents accepted`} />
      </div>
    );
  };
  const columns: Column<DriverRecord>[] = [
    { key: 'name', label: 'Driver', sortValue: (x) => x.name, render: (x) => (<><div className="cell-title">{x.name}</div><div className="cell-sub">{x.vehicle.colour} {x.vehicle.make} {x.vehicle.model} · {x.vehicle.plate}</div></>) },
    { key: 'city', label: 'City', sortValue: (x) => CITY_LABELS[x.city], render: (x) => CITY_LABELS[x.city] },
    { key: 'ver', label: 'Verification', sortValue: (x) => label(x.verification), render: (x) => <Pill tone={VER_TONE[x.verification]}>{label(x.verification)}</Pill> },
    { key: 'docs', label: 'Documents', sortValue: acceptedDocs, render: docSummary },
    { key: 'access', label: 'Subscription', sortValue: (x) => subscriptionState(x, t), render: (x) => { const a = accessStatus(x, t); return <Pill tone={a.active ? 'success' : 'neutral'} icon="ticket">{a.label}</Pill>; } },
    tab === 'rejected'
      ? { key: 'reason', label: 'Reason', render: (x) => <span className="small">{x.rejectionReason ?? 'Not recorded'}</span> }
      : { key: 'applied', label: 'Applied', sortValue: (x) => x.appliedAt, render: (x) => <span className="small">{when(x.appliedAt, t)}</span> },
  ];
  const expiryColumns: Column<ExpiryRow>[] = [
    { key: 'name', label: 'Driver', sortValue: (r) => byId.get(r.driverId)?.name ?? '', render: (r) => <span className="cell-title">{byId.get(r.driverId)?.name}</span> },
    { key: 'doc', label: 'Document', render: (r) => DOC_LABELS[r.kind] },
    { key: 'date', label: 'Expiry', sortValue: (r) => r.expiresAt, render: (r) => date(r.expiresAt) },
    { key: 'left', label: 'Status', render: (r) => (r.expired ? <Pill tone="danger">Expired</Pill> : <Pill tone="warning">{r.daysLeft} {r.daysLeft === 1 ? 'day' : 'days'} left</Pill>) },
    { key: 'ver', label: 'Verification', render: (r) => { const v = byId.get(r.driverId)!.verification; return <Pill tone={VER_TONE[v]}>{label(v)}</Pill>; } },
  ];

  const list = tab === 'review' ? review : tab === 'rejected' ? rejected : scoped.filter((x) => ver === 'all' || x.verification === ver);
  const rows = list.filter(match);
  const expiryRows = expiry.filter((r) => match(byId.get(r.driverId)!));
  const filtered = !!s || cat !== 'all' || sub !== 'all' || cityF !== 'all' || ver !== 'all';
  const clear = () => (setQ(''), setCat('all'), setSub('all'), setCityF('all'), setVer('all'));
  const emptyFor: Record<Tab, ReactNode> = {
    review: filtered ? <Empty title="No drivers match these filters" icon="filter" action={<Button size="sm" onClick={clear}>Clear filters</Button>} /> : <Empty title="Review queue is clear" art="verification">New applications and drivers waiting on documents appear here, oldest first.</Empty>,
    all: filtered ? <Empty title="No drivers match these filters" icon="filter" action={<Button size="sm" onClick={clear}>Clear filters</Button>}>Search by name, ID or plate.</Empty> : <Empty title="No drivers in your cities" art="driverAvailability">Change the city filter to see more.</Empty>,
    expiry: <Empty title="No documents expiring soon" art="verification">Documents expired or expiring within 30 days appear here, soonest first.</Empty>,
    rejected: <Empty title="No rejected applications" icon="checkCircle" />,
  };
  const go = (next: Tab) => () => setTab(next);

  return (
    <>
      <PageHead eyebrow="People" title="Drivers" sub="Verify applications and documents, follow subscriptions and keep drivers eligible to accept rides. Document checks are simulated." />
      <div className="grid featured">
        <FeaturedStat label="Pending verification" value={count(review.length)} sub={docsPending ? `${count(docsPending)} waiting on the driver to upload` : 'Oldest application first'} art="verification" onClick={go('review')} />
        <Stat icon="steering" label="Registered drivers" value={count(scoped.length)} sub={`${count(approved)} approved`} onClick={() => (setTab('all'), setVer('all'))} />
        <Stat icon="radar" label="Online now" value={count(online)} sub="Simulated status" />
        <Stat icon="ticket" label="Active subscribers" value={count(subscribers)} sub="Daily or monthly pass running" />
      </div>
      <div style={{ marginTop: 32 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'review', label: 'Review queue', count: review.length },
            { value: 'all', label: 'All drivers', count: scoped.length },
            { value: 'expiry', label: 'Document expiry', count: expiry.length },
            { value: 'rejected', label: 'Rejected', count: rejected.length },
          ]}
        />
      </div>
      <FilterBar count={`${count(tab === 'expiry' ? expiryRows.length : rows.length)} shown · city filter applies, date range doesn’t`} end={filtered ? <Button size="sm" variant="ghost" icon="close" onClick={clear}>Clear filters</Button> : undefined}>
        <SearchInput value={q} onChange={setQ} placeholder="Search name, ID or plate" />
        {tab === 'all' ? (
          <Select<DriverVerification | 'all'> label="Verification" value={ver} onChange={setVer} options={[{ value: 'all', label: 'Any status' }, ...(Object.keys(VER_TONE) as DriverVerification[]).map((v) => ({ value: v, label: label(v) }))]} />
        ) : null}
        <Select<string> label="Vehicle category" value={cat} onChange={setCat} options={[{ value: 'all', label: 'Any category' }, ...categories.map((c) => ({ value: c, label: categoryLabel(c) }))]} />
        <Select<SubscriptionState | 'all'> label="Subscription" value={sub} onChange={setSub} options={[{ value: 'all', label: 'Any subscription' }, ...(Object.keys(SUBSCRIPTION_STATE_LABEL) as SubscriptionState[]).map((v) => ({ value: v, label: SUBSCRIPTION_STATE_LABEL[v] }))]} />
        {cities.length > 1 ? <Select<CityId | 'all'> label="City" value={cityF} onChange={setCityF} options={[{ value: 'all', label: 'Every city' }, ...cities.map((c) => ({ value: c, label: CITY_LABELS[c] }))]} /> : null}
      </FilterBar>
      <Card flush>
        {tab === 'expiry' ? (
          <Table caption="Documents expired or expiring" rows={expiryRows} columns={expiryColumns} rowKey={(r) => `${r.driverId}-${r.kind}`} onRowClick={(r) => setOpenId(r.driverId)} pageSize={25} empty={emptyFor.expiry} />
        ) : (
          <Table caption="Drivers" rows={rows} columns={columns} rowKey={(x) => x.id} onRowClick={(x) => setOpenId(x.id)} pageSize={25} empty={emptyFor[tab]} />
        )}
      </Card>
      {selected ? <DriverSheet key={selected.id} driver={selected} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

type SheetTab = 'overview' | 'personal' | 'vehicle' | 'documents' | 'subscription' | 'trips' | 'earnings' | 'activity';

function DriverSheet({ driver: x, onClose }: { driver: DriverRecord; onClose: () => void }) {
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const d = useData();
  const openRecord = useOpenRecord();
  const t = now();
  const inReview = REVIEW_STATES.includes(x.verification);
  const [view, setView] = useState<SheetTab>(inReview ? 'documents' : 'overview');
  const [pending, setPending] = useState<VerificationAction | null>(null);
  const [rejectDoc, setRejectDoc] = useState<DocumentKind | null>(null);
  const ready = documentReadiness(x, t);
  const access = accessStatus(x, t);
  const elig = eligibility(x, timelineFor(d.subscriptions, x.id, t));
  const canVerify = can('drivers.verify');
  const canRestrict = can('drivers.restrict') || canVerify;
  const actions = verificationActions(x.verification);
  const allowed = (a: VerificationAction) => (a === 'suspend' ? canRestrict : canVerify);
  const target = { type: 'driver' as const, id: x.id, label: x.name };
  const history = d.audit.filter((e) => e.target.type === 'driver' && e.target.id === x.id).sort((a, b) => b.at - a.at);
  const docHistory = history.filter((e) => e.action.startsWith('driver.document') || e.action === 'driver.documents_requested');
  const docsOk = REQUIRED_DOCS.filter((k) => { const doc = x.documents.find((y) => y.kind === k); return doc && docStatus(doc, t) === 'accepted'; }).length;
  const trips = useMemo(() => d.trips.filter((tr) => tr.driverId === x.id).sort((a, b) => b.requestedAt - a.requestedAt), [d.trips, x.id]);
  const completed = trips.filter((tr) => tr.status === 'completed');
  const tripValue = completed.reduce((s, tr) => s + (tr.agreedFare ?? 0), 0);
  const subs = useMemo(() => subscriptionRecords(d.collections, d.subscriptions, t).filter((r) => r.driverId === x.id), [d.collections, d.subscriptions, t, x.id]);
  const seeMoney = can('finance.view') || can('ledger.view');
  const contact = can('drivers.contact_details');

  const runAction = async (a: VerificationAction, reason: string) => {
    const ui = ACTION_UI[a];
    const r = await act(
      {
        label: ui.text,
        apply: (draft, ctx) => applyVerification(draft.drivers.find((y) => y.id === x.id), a, ctx.now, reason),
        audit: (draft) => ({
          action: ui.audit,
          target,
          summary: `${ui.text}: ${x.name}`,
          diff: [{ field: 'Verification', from: label(x.verification), to: label(draft.drivers.find((y) => y.id === x.id)!.verification) }],
          reason: reason || undefined,
        }),
      },
      ui.done,
    );
    if (r.ok) setPending(null);
  };

  const decideDoc = async (kind: DocumentKind, decision: 'accepted' | 'rejected', note?: string) => {
    const doc = x.documents.find((y) => y.kind === kind)!;
    const r = await act(
      {
        label: decision === 'accepted' ? 'Accept document' : 'Reject document',
        apply: (draft, ctx) => reviewDocument(draft.drivers.find((y) => y.id === x.id), kind, decision, ctx.now, note),
        audit: () => ({
          action: decision === 'accepted' ? 'driver.document_accepted' : 'driver.document_rejected',
          target,
          summary: `${decision === 'accepted' ? 'Accepted' : 'Rejected'} ${DOC_LABELS[kind].toLowerCase()} for ${x.name}`,
          diff: [{ field: DOC_LABELS[kind], from: label(docStatus(doc, t)), to: label(decision) }],
          reason: note,
        }),
        latency: 400,
      },
      decision === 'accepted' ? `${DOC_LABELS[kind]} accepted` : `${DOC_LABELS[kind]} rejected. The driver is asked for a new one.`,
    );
    if (r.ok) setRejectDoc(null);
  };

  const blockedReason = (a: VerificationAction) => {
    if (!allowed(a)) return 'Your role can’t do this';
    if ((a === 'approve' || a === 'reinstate') && !ready.ready) return 'Every required document must be accepted and in date';
    return undefined;
  };

  const readinessNotice =
    x.verification === 'rejected' ? (
      <Notice tone="danger">Rejected: {x.rejectionReason ?? 'No reason recorded'}</Notice>
    ) : ready.ready ? (
      <Notice tone="success">All required documents are accepted and in date.</Notice>
    ) : (
      <Notice tone="warning">
        <div className="strong">Approval is blocked until every required document is accepted and in date.</div>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {ready.blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      </Notice>
    );

  const views: { value: SheetTab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'personal', label: 'Personal' },
    { value: 'vehicle', label: 'Vehicle' },
    { value: 'documents', label: 'Documents', count: x.documents.length },
    { value: 'subscription', label: 'Subscription' },
    { value: 'trips', label: 'Trips', count: trips.length },
    { value: 'earnings', label: 'Earnings' },
    { value: 'activity', label: 'Activity', count: history.length },
  ];

  return (
    <Drawer
      title={x.name}
      sub={`${CITY_LABELS[x.city]} · applied ${date(x.appliedAt)} · ${x.id}`}
      onClose={onClose}
      footer={
        actions.length && (canVerify || canRestrict) ? (
          <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 8 }}>
            {actions.map((a) => (
              <Button key={a} variant={ACTION_UI[a].variant} onClick={() => setPending(a)} disabledReason={blockedReason(a)}>
                {ACTION_UI[a].text}
              </Button>
            ))}
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
            <span className="small muted">{canVerify || canRestrict ? 'No verification actions from this status' : 'Read only for your role'}</span>
            <Button onClick={onClose}>Close</Button>
          </div>
        )
      }
    >
      <div className="panel-pills">
        <Pill tone={VER_TONE[x.verification]}>{label(x.verification)}</Pill>
        <Pill tone={access.active ? 'success' : 'neutral'} icon="ticket">{access.label}</Pill>
        <Pill tone={elig.eligible ? 'success' : 'neutral'} icon={elig.eligible ? 'checkCircle' : 'lock'}>{elig.eligible ? 'Can accept rides' : elig.reason}</Pill>
        <Pill tone="neutral" icon="radar">{x.online ? 'Online' : 'Offline'}</Pill>
      </div>
      <div className="sheet-tabs">
        <Tabs value={view} onChange={setView} tabs={views} />
      </div>

      {view === 'overview' ? (
        <>
          {readinessNotice}
          <div className="sheet-figures">
            <Figure label="Documents" value={`${docsOk} of ${REQUIRED_DOCS.length}`} sub="Required, accepted" />
            <Figure label="Trips" value={count(x.trips)} sub={`${count(completed.length)} completed in test data`} />
            <Figure label="Rating" value={x.trips ? x.rating.toFixed(2) : 'None'} sub={`Acceptance ${Math.round(x.acceptanceRate * 100)}%`} />
          </div>
          <PanelSection title="At a glance" icon="steering">
            <KV
              items={[
                ['Verification', label(x.verification)],
                ['Subscription', access.label],
                ['Access until', x.access ? when(x.access.expiresAt, t) : 'None bought'],
                ['Vehicle', `${x.vehicle.colour} ${x.vehicle.make} ${x.vehicle.model} · ${x.vehicle.plate}`],
                ['Last action', history[0] ? `${history[0].summary} · ${when(history[0].at, t)}` : 'None recorded'],
              ]}
            />
          </PanelSection>
        </>
      ) : null}

      {view === 'personal' ? (
        <PanelSection title="Personal information" icon="user" aside={contact ? undefined : 'Contact details hidden for your role'}>
          <KV
            items={[
              ['Name', x.name],
              ['Driver ID', x.id],
              ['City', CITY_LABELS[x.city]],
              ['Phone', contact ? x.phone : <Locked />],
              ['Applied', date(x.appliedAt)],
              ['Payout account', x.bankAccount ? (seeMoney || canVerify ? `${x.bankAccount.bankName} ${x.bankAccount.accountNumberMasked}${x.bankAccount.verified ? '' : ' (not verified)'}` : <Locked />) : 'Not added'],
            ]}
          />
        </PanelSection>
      ) : null}

      {view === 'vehicle' ? (
        <PanelSection title="Vehicle" icon="car">
          <KV
            items={[
              ['Vehicle', `${x.vehicle.make} ${x.vehicle.model}`],
              ['Colour', x.vehicle.colour],
              ['Year', String(x.vehicle.year)],
              ['Plate', x.vehicle.plate],
              ['Category', categoryLabel(x.vehicle.category)],
            ]}
          />
        </PanelSection>
      ) : null}

      {view === 'documents' ? (
        <>
          {readinessNotice}
          <PanelSection title="Document review" icon="fileCheck" aside={`${docsOk} of ${REQUIRED_DOCS.length} required accepted · checks simulated`}>
            <div className="doc-cards">
              {x.documents.map((doc) => (
                <DocCard
                  key={doc.kind}
                  doc={doc}
                  appliedAt={x.appliedAt}
                  now={t}
                  canVerify={canVerify}
                  onAccept={() => decideDoc(doc.kind, 'accepted')}
                  onReject={() => setRejectDoc(doc.kind)}
                />
              ))}
            </div>
          </PanelSection>
          <PanelSection title="Review history" icon="history" aside={docHistory.length ? `${docHistory.length} recorded` : undefined}>
            {docHistory.length ? (
              <Timeline items={docHistory.slice(0, 10).map((e) => ({ at: e.at, title: e.summary, sub: e.reason ? `${e.actor.name} · “${e.reason}”` : e.actor.name }))} />
            ) : (
              <span className="small muted">No document decisions recorded for this driver yet.</span>
            )}
          </PanelSection>
        </>
      ) : null}

      {view === 'subscription' ? (
        <>
          <PanelSection title="Current access" icon="ticket">
            <KV
              items={[
                ['Pass', x.access ? `${PLAN_LABEL[x.access.packageId]} (${x.access.packageId === 'daily' ? '₦2,000, 24 hours' : '₦60,000, 30 days'})` : 'None bought'],
                ['Status', access.label],
                ['Until', x.access ? when(x.access.expiresAt, t) : 'Not set'],
                ['New ride requests', elig.eligible ? 'Receives requests' : `Blocked: ${elig.reason}`],
                ['Renewal', 'Manual: the driver buys a new pass'],
              ]}
            />
            <span className="small muted">An expired pass stops new ride requests; a ride already in progress may finish.</span>
          </PanelSection>
          <PanelSection title="Pass payments" icon="wallet" aside={subs.length ? `${subs.length}` : undefined}>
            {subs.length ? (
              <div className="panel-list">
                {subs.map((r) => (
                  <div key={r.id} className="panel-list-row">
                    <span className="grow">
                      <span className="strong" style={{ display: 'block' }}>{r.plan ? PLAN_LABEL[r.plan] : 'Unknown plan'} · <span className="num">{money(r.amount)}</span></span>
                      <span className="cell-sub">{r.paidAt ? `Verified ${when(r.paidAt, t)}` : label(r.paymentStatus)}{r.expiresAt ? ` · until ${when(r.expiresAt, t)}` : ''}</span>
                    </span>
                    <Pill tone={r.status === 'active' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>{label(r.status)}</Pill>
                  </div>
                ))}
              </div>
            ) : (
              <span className="small muted">No pass payments recorded for this driver.</span>
            )}
          </PanelSection>
        </>
      ) : null}

      {view === 'trips' ? (
        <PanelSection title="Trips" icon="route" aside={trips.length > 10 ? `10 of ${trips.length}` : undefined}>
          {trips.length ? (
            <div className="panel-list">
              {trips.slice(0, 10).map((tr) => (
                <button key={tr.id} className="panel-list-row" onClick={() => openRecord({ type: 'trip', id: tr.id })}>
                  <span className="grow">
                    <span className="strong" style={{ display: 'block' }}>{tr.ref} · {tr.mode === 'negotiate' ? 'Negotiated' : 'Quick Match'}</span>
                    <span className="cell-sub" style={{ display: 'block' }}>{tr.pickup} to {tr.destination} · {when(tr.requestedAt, t)}</span>
                  </span>
                  {tr.agreedFare ? <span className="num small">{money(tr.agreedFare)}</span> : null}
                  <Pill tone={TRIP_STATUS[tr.status].tone}>{TRIP_STATUS[tr.status].text}</Pill>
                </button>
              ))}
            </div>
          ) : (
            <span className="small muted">No trips in the test data for this driver.</span>
          )}
        </PanelSection>
      ) : null}

      {view === 'earnings' ? (
        <PanelSection title="Earnings" icon="chart">
          <div className="sheet-figures">
            <Figure label="Trip value" value={money(tripValue)} sub={`${count(completed.length)} completed trips · 0% commission`} />
            <Figure label="Withdrawable" value={seeMoney ? money(withdrawable(d.ledger, x.id)) : 'Hidden'} sub={seeMoney ? 'GoBye earnings balance' : 'Needs finance access'} />
          </div>
          <span className="small muted">Drivers keep the full fare. Transfers paid straight to the driver’s own account are recorded but never credited, so nothing is counted twice.</span>
        </PanelSection>
      ) : null}

      {view === 'activity' ? (
        <PanelSection title="Account activity" icon="history" aside={history.length ? `${history.length} recorded` : undefined}>
          {history.length ? (
            <Timeline items={history.slice(0, 15).map((e) => ({ at: e.at, title: e.summary, sub: e.reason ? `${e.actor.name} · “${e.reason}”` : e.actor.name }))} />
          ) : (
            <span className="small muted">No staff actions recorded for this driver yet.</span>
          )}
        </PanelSection>
      ) : null}

      {pending ? (
        <ConfirmDialog
          title={`${ACTION_UI[pending].text}: ${x.name}?`}
          body={ACTION_UI[pending].body}
          confirmLabel={ACTION_UI[pending].text}
          danger={pending === 'reject' || pending === 'suspend'}
          requireReason={!!ACTION_UI[pending].reason}
          onConfirm={(reason) => runAction(pending, reason)}
          onCancel={() => setPending(null)}
        />
      ) : null}
      {rejectDoc ? (
        <ConfirmDialog
          title={`Reject ${DOC_LABELS[rejectDoc].toLowerCase()}?`}
          body="The driver is asked to upload a new one. Your reason is shown to them as the note."
          confirmLabel="Reject document"
          danger
          requireReason
          onConfirm={(note) => decideDoc(rejectDoc, 'rejected', note)}
          onCancel={() => setRejectDoc(null)}
        />
      ) : null}
    </Drawer>
  );
}

function Locked() {
  return (
    <span className="muted row" style={{ gap: 4, display: 'inline-flex' }}>
      <Icon name="lock" size={14} /> Hidden for your role
    </span>
  );
}

function Figure({ label: l, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="sheet-figure">
      <span className="small muted">{l}</span>
      <span className="num sheet-figure-value">{value}</span>
      {sub ? <span className="small muted">{sub}</span> : null}
    </div>
  );
}

/** One document under review: an honest file placeholder (no files in the prototype), details and decisions. */
function DocCard({ doc, appliedAt, now, canVerify, onAccept, onReject }: { doc: DriverDocument; appliedAt: number; now: number; canVerify: boolean; onAccept: () => void; onReject: () => void }) {
  const st = docStatus(doc, now);
  const required = REQUIRED_DOCS.includes(doc.kind);
  return (
    <div className={`doc-card ${DOC_ROW[st]}`}>
      <div className="doc-card-head">
        <span className="doc-ico"><Icon name={DOC_ICON[st]} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="strong">{DOC_LABELS[doc.kind]}</div>
          <div className="small muted">{required ? 'Required for approval' : 'Optional for approval'}</div>
        </div>
        <Pill tone={DOC_TONE[st]}>{label(st)}</Pill>
      </div>
      <div className="doc-preview" role="img" aria-label={`${DOC_LABELS[doc.kind]}: file not available in this prototype`}>
        <Icon name="document" size={20} />
        <span>{st === 'missing' ? 'Not uploaded yet.' : 'Document file not available in this prototype: stored privately in R2 once the backend exists.'}</span>
      </div>
      <dl className="doc-meta">
        <div><dt>Expiry</dt><dd>{doc.expiresAt ? `${doc.expiresAt <= now ? 'Expired' : 'Expires'} ${date(doc.expiresAt)}` : 'No expiry'}</dd></div>
        <div><dt>Submitted with</dt><dd>Application of {date(appliedAt)}</dd></div>
        {doc.note ? <div><dt>Note to driver</dt><dd>{doc.note}</dd></div> : null}
      </dl>
      {canVerify && st !== 'missing' && st !== 'expired' ? (
        <div className="doc-actions">
          {st === 'submitted' || st === 'rejected' ? <Button size="sm" variant="primary" icon="check" onClick={onAccept}>Accept</Button> : null}
          {st === 'submitted' || st === 'accepted' ? <Button size="sm" variant="secondary" icon="close" onClick={onReject}>Reject with reason</Button> : null}
        </div>
      ) : st === 'expired' && canVerify ? (
        <div className="small muted">Expired: ask the driver for a current one with Request documents.</div>
      ) : null}
    </div>
  );
}
