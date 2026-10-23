import { useMemo, useState } from 'react';
import type { RefundRecord } from '@gobye/core';
import { money, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Card, Drawer, Empty, FilterBar, KV, Notice, Pill, SearchInput, Segmented, Stat, Table, Timeline, type Column } from '@/ui/kit';
import { applyRefundAction, refundActions, refundApproval, type RefundAction } from './logic';
import { ActionButtons, FinanceHead, FlowSteps, LedgerLines, REFUND_TONE, Rule, SimTag, StatusPill, SubHead, useInclude } from './parts';

type Group = 'decide' | 'progress' | 'done' | 'all';
const GROUP: Record<Exclude<Group, 'all'>, RefundRecord['status'][]> = { decide: ['requested'], progress: ['approved', 'processing', 'failed'], done: ['completed', 'rejected'] };
const DEST: Record<RefundRecord['destination'], string> = { wallet: 'GoBye wallet', original_method: 'Original payment method' };

const STEPS = ['Care requests the refund', 'Someone else approves it', 'Finance processes it', 'Wallet credited or provider confirms'];
const STEP_AT: Partial<Record<RefundRecord['status'], number>> = { requested: 1, approved: 2, failed: 2, processing: 3, completed: 4 };

const DESCRIBE: Record<RefundAction, { title: string; body: (r: RefundRecord) => string }> = {
  approve: { title: 'Approve refund', body: (r) => `Approves ${money(r.amount)} to the ${DEST[r.destination].toLowerCase()}. The linked approval request is marked approved. Money moves only when you process it.` },
  reject: { title: 'Reject refund', body: () => 'Nothing is paid. The reason is saved to the audit trail and the approval request.' },
  process: { title: 'Process refund', body: (r) => (r.destination === 'wallet' ? `Posts a refund journal: the passenger wallet goes up by ${money(r.amount)}, booked as a goodwill expense. Posted once, even if pressed again.` : `Submits ${money(r.amount)} to Paystack (test) for the original payment method. Simulated: the result comes from the buttons that follow.`) },
  sim_success: { title: 'Simulate refund success', body: (r) => `Simulated provider event refund.processed. Posts the refund journal for ${money(r.amount)} as a goodwill expense.` },
  sim_failure: { title: 'Simulate refund failure', body: () => 'Simulated provider event refund.failed. Nothing is posted; you can process it again.' },
};

export default function Refunds() {
  const d = useData();
  const include = useInclude();
  const [group, setGroup] = useState<Group>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const passengers = useMemo(() => new Map(d.passengers.map((p) => [p.id, p])), [d.passengers]);
  const scoped = useMemo(() => d.refunds.filter((r) => include(passengers.get(r.passengerId)?.city, r.requestedAt)), [d.refunds, passengers, include]);
  const t = q.trim().toLowerCase();
  const rows = scoped
    .filter((r) => (group === 'all' || GROUP[group].includes(r.status)) && (!t || r.id.toLowerCase().includes(t) || r.reason.toLowerCase().includes(t) || (passengers.get(r.passengerId)?.name ?? '').toLowerCase().includes(t)))
    .sort((a, b) => b.requestedAt - a.requestedAt);
  const open = openId ? d.refunds.find((r) => r.id === openId) : undefined;
  const sumOf = (sts: RefundRecord['status'][]) => scoped.filter((r) => sts.includes(r.status)).reduce((s, r) => s + r.amount, 0);

  const columns: Column<RefundRecord>[] = [
    { key: 'reason', label: 'Reason', render: (r) => <div><div className="cell-title">{r.reason}</div><div className="cell-sub">{r.id}</div></div> },
    {
      key: 'links',
      label: 'Linked',
      render: (r) => {
        const trip = r.tripId ? d.trips.find((t) => t.id === r.tripId) : undefined;
        const kase = r.caseId ? d.cases.find((c) => c.id === r.caseId) : undefined;
        return (
          <div className="stack tight small">
            <RecordLink type="passenger" id={r.passengerId}>{passengers.get(r.passengerId)?.name ?? r.passengerId}</RecordLink>
            <span className="row wrap" style={{ gap: 4, whiteSpace: 'nowrap' }}>
              {trip ? <RecordLink type="trip" id={trip.id}>Trip {trip.ref}</RecordLink> : <span className="muted">No trip</span>}
              {kase ? <span className="muted">· Case {kase.ref}</span> : null}
            </span>
          </div>
        );
      },
    },
    { key: 'amt', label: 'Amount', align: 'right', sortValue: (r) => r.amount, render: (r) => <span className="num strong">{money(r.amount)}</span> },
    { key: 'dest', label: 'Destination', render: (r) => <span className="small">{DEST[r.destination]}</span> },
    { key: 'st', label: 'Status', render: (r) => <StatusPill tone={REFUND_TONE[r.status]} status={r.status} /> },
    { key: 'who', label: 'Requested / approved', render: (r) => <div className="small"><div>{r.requestedBy.name}</div><div className="muted">{r.approvedBy ? `Approved by ${r.approvedBy.name}` : 'Not approved'}</div></div> },
    { key: 'res', label: 'Provider result', render: (r) => <span className="small muted">{r.providerResult ?? 'None yet'}</span> },
  ];

  return (
    <>
      <FinanceHead title="Refunds and disputes" sub="Every refund needs approval from someone other than the requester, then finance processes it." />
      <div className="grid cols-4">
        <Stat icon="time" label="Waiting for a decision" value={money(sumOf(['requested']))} sub={(() => { const n = scoped.filter((r) => r.status === 'requested').length; return `${n} ${n === 1 ? 'request' : 'requests'}`; })()} tone={sumOf(['requested']) ? 'warning' : undefined} onClick={() => setGroup('decide')} />
        <Stat icon="refresh" label="Approved or processing" value={money(sumOf(['approved', 'processing']))} sub="Not paid yet" onClick={() => setGroup('progress')} />
        <Stat icon="alert" label="Failed" value={money(sumOf(['failed']))} sub="Can be processed again" tone={sumOf(['failed']) ? 'danger' : undefined} onClick={() => setGroup('progress')} />
        <Stat icon="checkCircle" label="Completed" value={money(sumOf(['completed']))} sub="Booked as goodwill expense" onClick={() => setGroup('done')} />
      </div>
      <div className="section">
        <FlowSteps label="Refund flow" title="How a refund moves" steps={STEPS} note="Nobody approves their own request. Money moves only after approval, and a refund to the original method is not complete until the provider confirms." />
      </div>
      <div className="section">
        <FilterBar count={`${rows.length} of ${scoped.length} in the selected city and dates`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search passenger, reason or ID" />
          <Segmented<Group> label="Show" value={group} onChange={setGroup} options={[{ value: 'all', label: 'All' }, { value: 'decide', label: 'Needs decision' }, { value: 'progress', label: 'In progress' }, { value: 'done', label: 'Done' }]} />
        </FilterBar>
        <div className="card flush">
          <Table rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} empty={<Empty title="No refunds here" icon="refresh">Care requests refunds from a case. Try another group or a wider date range.</Empty>} />
        </div>
      </div>
      {open ? <RefundDrawer r={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function RefundDrawer({ r, onClose }: { r: RefundRecord; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can, staff } = useSession();
  const act = useAction();
  const approval = refundApproval(d.approvals, r.id);
  const options = refundActions(r, { can, staff, approval });
  const entries = d.ledger.filter((e) => e.reference === `refund:${r.id}` || e.links?.refundId === r.id);
  const history = d.audit.filter((a) => a.target.type === 'refund' && a.target.id === r.id).sort((a, b) => b.at - a.at);
  const trip = r.tripId ? d.trips.find((t) => t.id === r.tripId) : undefined;
  const kase = r.caseId ? d.cases.find((c) => c.id === r.caseId) : undefined;
  const passenger = d.passengers.find((p) => p.id === r.passengerId);

  const run = (action: RefundAction, reason: string) =>
    act(
      {
        label: DESCRIBE[action].title,
        apply: (draft, ctx) => applyRefundAction(draft, r.id, action, { ...ctx, reason, staff }),
        audit: () => ({
          action: `refund.${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'process' ? 'processed' : action}`,
          target: { type: 'refund', id: r.id, label: `Refund ${r.id}` },
          summary: `${DESCRIBE[action].title}: ${money(r.amount)} to ${passenger?.name ?? r.passengerId}${action.startsWith('sim_') ? ' (simulated provider event)' : ''}`,
          reason: reason || undefined,
        }),
      },
      `${DESCRIBE[action].title}: done`,
    );
  const describe = (a: RefundAction) => ({ title: DESCRIBE[a].title, body: DESCRIBE[a].body(r) });
  const sim = options.filter((o) => o.action.startsWith('sim_'));
  const real = options.filter((o) => !o.action.startsWith('sim_'));

  return (
    <Drawer title={`Refund ${money(r.amount)}`} sub={`${r.id} · ${DEST[r.destination]}`} onClose={onClose} footer={real.length ? <ActionButtons options={real} run={run} describe={describe} /> : undefined}>
      <div className="row wrap">
        <StatusPill tone={REFUND_TONE[r.status]} status={r.status} />
        {approval ? <Pill tone={approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'neutral' : 'warning'} icon="checkCircle">Approval {approval.status}</Pill> : null}
      </div>
      {STEP_AT[r.status] !== undefined ? <FlowSteps label="Where this refund is" steps={STEPS} current={STEP_AT[r.status]} vertical /> : null}
      <Rule>Two person rule: {r.requestedBy.name} asked for this refund, so someone else must approve it{r.approvedBy ? `. Approved by ${r.approvedBy.name}` : ''}.</Rule>
      {r.status === 'processing' && r.destination === 'original_method' ? <Notice tone="warning" icon="time">Sent to the provider. Not refunded until the provider confirms.</Notice> : null}
      {r.status === 'failed' ? <Notice tone="danger">The provider could not complete this refund. Nothing was posted. You can process it again.</Notice> : null}
      <KV
        items={[
          ['Reason', r.reason],
          ['Passenger', <RecordLink type="passenger" id={r.passengerId}>{passenger?.name ?? r.passengerId}</RecordLink>],
          ['Trip', trip ? <RecordLink type="trip" id={trip.id}>{trip.ref}</RecordLink> : 'Not linked'],
          ['Case', kase ? `${kase.ref}: ${kase.subject}` : 'Not linked'],
          ['Amount', <span className="num strong">{money(r.amount)}</span>],
          ['Destination', DEST[r.destination]],
          ['Requested by', `${r.requestedBy.name}, ${when(r.requestedAt, now())}`],
          ['Approved by', r.approvedBy?.name ?? 'Not approved'],
          ['Provider result', r.providerResult ?? 'None yet'],
        ]}
      />
      <Card muted>
        <div className="small">
          <span className="strong">How it is booked.</span> GoBye keeps no commission on trips, so a refund is paid from company funds and booked as a goodwill expense (promotions and goodwill). It never reduces the driver’s earnings or package revenue.
        </div>
      </Card>
      {sim.length ? (
        <Card muted>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="strong">Simulated provider result</span>
            <SimTag />
          </div>
          <div className="row wrap">
            <ActionButtons options={sim} run={run} describe={describe} />
          </div>
        </Card>
      ) : null}
      {!options.length && (r.status === 'requested' || r.status === 'approved' || r.status === 'processing' || r.status === 'failed') ? (
        <div className="small muted">Your role can view this refund. Approving and processing need refund approval permission.</div>
      ) : null}
      <div>
        <SubHead>Ledger</SubHead>
        <LedgerLines entries={entries} now={now()} empty="No refund journal yet. Posted when the refund is completed." />
      </div>
      <div>
        <SubHead>History</SubHead>
        {history.length ? (
          <Timeline items={history.map((a) => ({ at: a.at, title: a.summary, sub: [a.actor.name, a.reason ? `Reason: ${a.reason}` : ''].filter(Boolean).join(' · ') }))} />
        ) : (
          <div className="small muted">Requested by {r.requestedBy.name}, {when(r.requestedAt, now())}</div>
        )}
      </div>
    </Drawer>
  );
}
