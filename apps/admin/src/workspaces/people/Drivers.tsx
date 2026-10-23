import { useState, type ReactNode } from 'react';
import { CITY_LABELS, type DocumentKind, type DriverRecord, type DriverVerification } from '@gobye/core';
import { count, date, label, when } from '@/data/format';
import { PanelSection, RecordLink } from '@/data/records';
import { useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Drawer, Empty, FilterBar, KV, Meter, Notice, PageHead, Pill, SearchInput, Select, Stat, Table, Tabs, Timeline, type Column, type Tone } from '@/ui/kit';
import './people.css';
import {
  DOC_LABELS,
  REQUIRED_DOCS,
  REVIEW_STATES,
  accessStatus,
  applyVerification,
  docStatus,
  documentReadiness,
  expiringDocuments,
  reviewDocument,
  verificationActions,
  type ExpiryRow,
  type VerificationAction,
} from './logic';

type Tab = 'review' | 'all' | 'expiry' | 'rejected';
const VER_TONE: Record<DriverVerification, Tone> = { applied: 'info', documents_pending: 'warning', in_review: 'warning', approved: 'success', rejected: 'danger', suspended: 'danger' };
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
  const keepRow = useScopedFilter();
  const [tab, setTab] = useState<Tab>('review');
  const [q, setQ] = useState('');
  const [ver, setVer] = useState<DriverVerification | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const t = now();

  // People lists follow the city filter and your city scope, not the date range.
  const scoped = d.drivers.filter((x) => keepRow(x.city, undefined, t));
  const s = q.trim().toLowerCase();
  const match = (x: DriverRecord) => !s || x.name.toLowerCase().includes(s) || x.id.includes(s) || x.vehicle.plate.toLowerCase().includes(s);
  const review = scoped.filter((x) => REVIEW_STATES.includes(x.verification)).sort((a, b) => a.appliedAt - b.appliedAt);
  const rejected = scoped.filter((x) => x.verification === 'rejected');
  const expiry = expiringDocuments(scoped, t);
  const byId = new Map(d.drivers.map((x) => [x.id, x]));
  const selected = openId ? d.drivers.find((x) => x.id === openId) : undefined;

  const acceptedDocs = (x: DriverRecord) => REQUIRED_DOCS.filter((k) => { const doc = x.documents.find((y) => y.kind === k); return doc && docStatus(doc, t) === 'accepted'; }).length;
  const docSummary = (x: DriverRecord) => {
    const ok = acceptedDocs(x);
    return (
      <div className="doc-progress">
        <span className="small">{ok} of {REQUIRED_DOCS.length} accepted</span>
        <Meter value={ok / REQUIRED_DOCS.length} label={`${x.name}: ${ok} of ${REQUIRED_DOCS.length} required documents accepted`} />
      </div>
    );
  };
  const columns: Column<DriverRecord>[] = [
    { key: 'name', label: 'Driver', sortValue: (x) => x.name, render: (x) => (<><div className="cell-title">{x.name}</div><div className="cell-sub">{x.vehicle.colour} {x.vehicle.make} {x.vehicle.model} · {x.vehicle.plate}</div></>) },
    { key: 'city', label: 'City', sortValue: (x) => CITY_LABELS[x.city], render: (x) => CITY_LABELS[x.city] },
    { key: 'ver', label: 'Verification', sortValue: (x) => label(x.verification), render: (x) => <Pill tone={VER_TONE[x.verification]}>{label(x.verification)}</Pill> },
    { key: 'docs', label: 'Documents', sortValue: acceptedDocs, render: docSummary },
    { key: 'access', label: 'Access package', render: (x) => { const a = accessStatus(x, t); return <Pill tone={a.active ? 'success' : 'neutral'} icon="ticket">{a.label}</Pill>; } },
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
  const emptyFor: Record<Tab, ReactNode> = {
    review: <Empty title="Review queue is clear" icon="checkCircle">New applications and drivers waiting on documents appear here.</Empty>,
    all: <Empty title={s || ver !== 'all' ? 'No drivers match' : 'No drivers in your cities'} icon="steering">{s ? 'Search by name, ID or plate.' : 'Change the city filter to see more.'}</Empty>,
    expiry: <Empty title="No documents expiring soon" icon="fileCheck">Documents expired or expiring within 30 days appear here, soonest first.</Empty>,
    rejected: <Empty title="No rejected applications" icon="checkCircle" />,
  };

  const docsPending = scoped.filter((x) => x.verification === 'documents_pending').length;
  const expired = expiry.filter((r) => r.expired).length;
  const go = (next: Tab) => () => setTab(next);

  return (
    <>
      <PageHead eyebrow="People" title="Drivers" sub="Review applications and documents, approve or suspend drivers, and track document expiry. Document checks are simulated." />
      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        <Stat icon="fileCheck" label="Review queue" value={count(review.length)} sub="Applied, documents pending or in review" tone={review.length ? 'warning' : undefined} onClick={go('review')} />
        <Stat icon="document" label="Documents pending" value={count(docsPending)} sub="Waiting on the driver to upload" onClick={() => { setTab('all'); setVer('documents_pending'); }} />
        <Stat icon="time" label="Expiring documents" value={count(expiry.length)} sub={expired ? `${count(expired)} already expired` : 'Within 30 days'} tone={expired ? 'danger' : undefined} onClick={go('expiry')} />
        <Stat icon="userForbid" label="Rejected" value={count(rejected.length)} sub="Can apply again later" onClick={go('rejected')} />
      </div>
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
      <FilterBar count={`${count(tab === 'expiry' ? expiryRows.length : rows.length)} shown · city filter applies, date range doesn’t`}>
        <SearchInput value={q} onChange={setQ} placeholder="Search name, ID or plate" />
        {tab === 'all' ? (
          <Select<DriverVerification | 'all'>
            label="Verification"
            value={ver}
            onChange={setVer}
            options={[{ value: 'all', label: 'Any verification' }, ...(Object.keys(VER_TONE) as DriverVerification[]).map((v) => ({ value: v, label: label(v) }))]}
          />
        ) : null}
      </FilterBar>
      <Card flush>
        {tab === 'expiry' ? (
          <Table caption="Documents expired or expiring" rows={expiryRows} columns={expiryColumns} rowKey={(r) => `${r.driverId}-${r.kind}`} onRowClick={(r) => setOpenId(r.driverId)} pageSize={25} empty={emptyFor.expiry} />
        ) : (
          <Table caption="Drivers" rows={rows} columns={columns} rowKey={(x) => x.id} onRowClick={(x) => setOpenId(x.id)} pageSize={tab === 'all' ? 25 : undefined} empty={emptyFor[tab]} />
        )}
      </Card>
      {selected ? <ReviewDrawer key={selected.id} driver={selected} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function ReviewDrawer({ driver: x, onClose }: { driver: DriverRecord; onClose: () => void }) {
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const [pending, setPending] = useState<VerificationAction | null>(null);
  const [rejectDoc, setRejectDoc] = useState<DocumentKind | null>(null);
  const t = now();
  const ready = documentReadiness(x, t);
  const access = accessStatus(x, t);
  const canVerify = can('drivers.verify');
  const canRestrict = can('drivers.restrict') || canVerify;
  const actions = verificationActions(x.verification);
  const allowed = (a: VerificationAction) => (a === 'suspend' ? canRestrict : canVerify);
  const target = { type: 'driver' as const, id: x.id, label: x.name };
  const d = useData();
  const history = d.audit.filter((e) => e.target.type === 'driver' && e.target.id === x.id).sort((a, b) => b.at - a.at);
  const docsOk = REQUIRED_DOCS.filter((k) => { const doc = x.documents.find((y) => y.kind === k); return doc && docStatus(doc, t) === 'accepted'; }).length;

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
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="panel-pills">
        <Pill tone={VER_TONE[x.verification]}>{label(x.verification)}</Pill>
        <Pill tone={access.active ? 'success' : 'neutral'} icon="ticket">{access.label}</Pill>
        <Pill tone={x.online ? 'brand' : 'neutral'} icon="radar">{x.online ? 'Online' : 'Offline'}</Pill>
        <RecordLink type="driver" id={x.id}>Open full record</RecordLink>
      </div>
      {x.verification !== 'rejected' ? (
        ready.ready ? (
          <Notice tone="success">All required documents are accepted and in date.</Notice>
        ) : (
          <Notice tone="warning">
            <div className="strong">Approval is blocked until every required document is accepted and in date.</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {ready.blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </Notice>
        )
      ) : (
        <Notice tone="danger">Rejected: {x.rejectionReason ?? 'No reason recorded'}</Notice>
      )}

      <PanelSection title="Documents" icon="fileCheck" aside={`${docsOk} of ${REQUIRED_DOCS.length} required accepted · checks simulated`}>
        <div className="doc-list">
          {x.documents.map((doc) => {
            const st = docStatus(doc, t);
            return (
              <div key={doc.kind} className={`doc-row ${DOC_ROW[st]}`}>
                <span className="doc-ico"><Icon name={DOC_ICON[st]} size={16} /></span>
                <div className="doc-body">
                  <div className="strong small">{DOC_LABELS[doc.kind]}{REQUIRED_DOCS.includes(doc.kind) ? '' : ' (optional for approval)'}</div>
                  <div className="small muted">
                    {doc.expiresAt ? `${doc.expiresAt <= t ? 'Expired' : 'Expires'} ${date(doc.expiresAt)}` : 'No expiry'}
                    {doc.note ? ` · ${doc.note}` : ''}
                  </div>
                </div>
                <Pill tone={DOC_TONE[st]}>{label(st)}</Pill>
                {canVerify && st !== 'missing' ? (
                  <span className="doc-actions">
                    {st === 'submitted' || st === 'rejected' ? <Button size="sm" variant="secondary" icon="check" onClick={() => decideDoc(doc.kind, 'accepted')}>Accept</Button> : null}
                    {st === 'submitted' || st === 'accepted' ? <Button size="sm" variant="ghost" icon="close" onClick={() => setRejectDoc(doc.kind)}>Reject</Button> : null}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="small muted">Files are not shown in this prototype; secure document storage comes with the backend.</div>
      </PanelSection>

      <PanelSection title="Identity and contact" icon="user">
        <KV
          items={[
            ['Driver ID', x.id],
            ['City', CITY_LABELS[x.city]],
            ['Applied', date(x.appliedAt)],
            ['Phone', can('drivers.contact_details') ? x.phone : 'Hidden for your role'],
          ]}
        />
      </PanelSection>

      <PanelSection title="Vehicle" icon="car">
        <KV
          items={[
            ['Vehicle', `${x.vehicle.colour} ${x.vehicle.make} ${x.vehicle.model}`],
            ['Year', String(x.vehicle.year)],
            ['Plate', x.vehicle.plate],
            ['Category', x.vehicle.category === 'go' ? 'GoBye Car' : label(x.vehicle.category)],
          ]}
        />
      </PanelSection>

      <PanelSection title="Access and activity" icon="ticket">
        <KV
          items={[
            ['Access package', access.label],
            ['Access until', x.access ? when(x.access.expiresAt, t) : 'None bought'],
            ['Trips', count(x.trips)],
            ['Rating', x.verification === 'approved' || x.trips ? x.rating.toFixed(2) : 'No trips yet'],
          ]}
        />
      </PanelSection>

      <PanelSection title="History" icon="history" aside={history.length ? `${history.length} recorded` : undefined}>
        {history.length ? (
          <Timeline items={history.slice(0, 8).map((e) => ({ at: e.at, title: e.summary, sub: e.reason ? `${e.actor.name} · “${e.reason}”` : e.actor.name }))} />
        ) : (
          <span className="small muted">No staff actions recorded for this driver yet.</span>
        )}
      </PanelSection>

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
