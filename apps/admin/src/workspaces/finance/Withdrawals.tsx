import { useMemo, useState, type ReactNode } from 'react';
import { APPROVAL_RULES, type WithdrawalRecord, type WithdrawalStatus } from '@gobye/core';
import { city, label, money, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Card, Drawer, Empty, FilterBar, KV, Notice, Pill, SearchInput, Stat, Table, Tabs, Timeline, type Column } from '@/ui/kit';
import { applyWithdrawalAction, needsReviewNote, withdrawalActions, withdrawalApproval, type WithdrawalAction } from './logic';
import { ActionButtons, FinanceHead, FlowSteps, LedgerLines, Rule, SimTag, StatusPill, SubHead, WITHDRAWAL_TONE, useInclude } from './parts';

const STATUSES: WithdrawalStatus[] = ['requested', 'under_review', 'processing', 'successful', 'failed', 'reversed', 'rejected'];
const STEPS = ['Driver selects verified bank account and amount', 'Earnings are reserved', 'Checks or approval where required', 'Transfer submitted', 'Final result received'];

/** Where each status sits in STEPS (undefined: the flow stopped, see the status note). */
const STEP_AT: Partial<Record<WithdrawalStatus, number>> = { requested: 2, under_review: 2, processing: 4, successful: 5 };

const STATUS_NOTE: Record<WithdrawalStatus, { tone: 'info' | 'warning' | 'success' | 'danger'; text: string }> = {
  requested: { tone: 'warning', text: 'Earnings are reserved for this request. Nothing has been sent yet.' },
  under_review: { tone: 'warning', text: 'In review. Earnings stay reserved until it is approved or rejected.' },
  processing: { tone: 'info', text: 'Transfer submitted. Submitted is not paid: waiting for the provider’s final result.' },
  successful: { tone: 'success', text: 'Paid out. The provider confirmed the transfer.' },
  failed: { tone: 'danger', text: 'The transfer failed. Reserved earnings went back to withdrawable.' },
  reversed: { tone: 'danger', text: 'The bank reversed the payout. Earnings went back to withdrawable.' },
  rejected: { tone: 'info', text: 'Rejected. Reserved earnings went back to withdrawable.' },
};

const DESCRIBE: Record<WithdrawalAction, { title: string; body: (w: WithdrawalRecord) => ReactNode }> = {
  start_review: { title: 'Start review', body: () => 'Moves the request to Under review. Earnings stay reserved.' },
  approve_submit: { title: 'Approve and submit transfer', body: (w) => `Submits a ${money(w.amount)} transfer to ${w.bankAccount.bankName} ${w.bankAccount.accountNumberMasked}. Submitted is not paid: the status stays Processing until the provider reports the result. Test mode: no money moves.` },
  reject: { title: 'Reject withdrawal', body: (w) => `The reserved ${money(w.amount)} goes back to the driver’s withdrawable earnings.` },
  sim_success: { title: 'Simulate transfer success', body: (w) => `Simulated provider event transfer.success. The reserved ${money(w.amount)} is recorded as paid out.` },
  sim_failure: { title: 'Simulate transfer failure', body: (w) => `Simulated provider event transfer.failed. The reserved ${money(w.amount)} returns to withdrawable earnings.` },
  sim_reversal: { title: 'Simulate reversal', body: (w) => `Simulated provider event transfer.reversed. A reversal journal returns ${money(w.amount)} to the driver’s withdrawable earnings.` },
};

export default function Withdrawals() {
  const d = useData();
  const { now } = usePlatform();
  const include = useInclude();
  const [tab, setTab] = useState<WithdrawalStatus>('requested');
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const drivers = useMemo(() => new Map(d.drivers.map((x) => [x.id, x])), [d.drivers]);
  const scoped = useMemo(() => d.withdrawals.filter((w) => include(drivers.get(w.driverId)?.city, w.requestedAt)), [d.withdrawals, drivers, include]);
  const t = q.trim().toLowerCase();
  const rows = scoped
    .filter((w) => w.status === tab && (!t || w.id.toLowerCase().includes(t) || (drivers.get(w.driverId)?.name ?? '').toLowerCase().includes(t)))
    .sort((a, b) => b.requestedAt - a.requestedAt);
  const sum = (sts: WithdrawalStatus[]) => scoped.filter((w) => sts.includes(w.status));
  const kpi = (sts: WithdrawalStatus[]) => ({ n: sum(sts).length, amt: sum(sts).reduce((s, w) => s + w.amount, 0) });
  const waiting = kpi(['requested', 'under_review']);
  const inFlight = kpi(['processing']);
  const paid = kpi(['successful']);
  const bounced = kpi(['failed', 'reversed']);
  const open = openId ? d.withdrawals.find((w) => w.id === openId) : undefined;
  const threshold = APPROVAL_RULES.withdrawal.thresholdKobo ?? 0;

  const columns: Column<WithdrawalRecord>[] = [
    { key: 'd', label: 'Driver', render: (w) => <div><RecordLink type="driver" id={w.driverId}>{drivers.get(w.driverId)?.name ?? w.driverId}</RecordLink><div className="cell-sub" style={{ paddingLeft: 4 }}>{w.id}</div></div> },
    { key: 'amt', label: 'Amount', align: 'right', sortValue: (w) => w.amount, render: (w) => <div><div className="num strong">{money(w.amount)}</div>{w.amount >= threshold ? <div className="cell-sub">Review threshold</div> : null}</div> },
    { key: 'bank', label: 'Bank account', render: (w) => <div><div>{w.bankAccount.bankName} <span className="num">{w.bankAccount.accountNumberMasked}</span></div><div className="cell-sub">{w.bankAccount.accountName}</div></div> },
    { key: 'st', label: 'Status', render: (w) => <StatusPill tone={WITHDRAWAL_TONE[w.status]} status={w.status} /> },
    { key: 'req', label: 'Requested', sortValue: (w) => w.requestedAt, render: (w) => <span className="small">{when(w.requestedAt, now())}</span> },
    { key: 'upd', label: 'Last update', render: (w) => { const h = w.history[w.history.length - 1]; return <span className="small muted">{h ? `${label(h.status)}, ${when(h.at, now())}` : 'None'}</span>; } },
  ];

  return (
    <>
      <FinanceHead title="Withdrawals" sub="Drivers withdrawing their earnings to a verified bank account." />
      <div className="grid cols-4">
        <Stat icon="time" label="Waiting for review" value={money(waiting.amt)} sub={`${waiting.n} requests, earnings reserved`} tone={waiting.n ? 'warning' : undefined} onClick={() => setTab('requested')} />
        <Stat icon="refresh" label="Submitted, not paid yet" value={money(inFlight.amt)} sub={`${inFlight.n} waiting for the provider’s result`} tone={inFlight.n ? 'info' : undefined} onClick={() => setTab('processing')} />
        <Stat icon="bank" label="Paid out" value={money(paid.amt)} sub={`${paid.n} confirmed by the provider`} onClick={() => setTab('successful')} />
        <Stat icon="alert" label="Failed or reversed" value={money(bounced.amt)} sub={`${bounced.n} returned to withdrawable`} tone={bounced.n ? 'danger' : undefined} onClick={() => setTab('failed')} />
      </div>

      <div className="section">
        <FlowSteps
          label="Withdrawal flow"
          title={<><Icon name="bank" size={14} /> How a withdrawal moves</>}
          steps={STEPS}
          current={STEP_AT[tab]}
          note={<>A transfer being submitted is not a completed payout: only the provider’s final event (success, failure, later a reversal) moves it on. Amounts of {money(threshold)} or more need review first. Provider events here are simulated on test data.</>}
        />
      </div>

      <div className="section">
        <Tabs value={tab} onChange={setTab} tabs={STATUSES.map((s) => ({ value: s, label: label(s), count: scoped.filter((w) => w.status === s).length }))} />
        <FilterBar count={`${rows.length} ${label(tab).toLowerCase()}`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search driver or withdrawal ID" />
        </FilterBar>
        <div className="card flush">
          <Table rows={rows} columns={columns} rowKey={(w) => w.id} onRowClick={(w) => setOpenId(w.id)} empty={<Empty title={`No ${label(tab).toLowerCase()} withdrawals`} icon="bank">Nothing in this status for the selected city and dates.</Empty>} />
        </div>
      </div>
      {open ? <WithdrawalDrawer w={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function WithdrawalDrawer({ w, onClose }: { w: WithdrawalRecord; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can, staff } = useSession();
  const act = useAction();
  const driver = d.drivers.find((x) => x.id === w.driverId);
  const approval = withdrawalApproval(d.approvals, w.id);
  const options = withdrawalActions(w, { can, staff, bankVerified: driver?.bankAccount?.verified, approval });
  const entries = d.ledger.filter((e) => e.links?.withdrawalId === w.id).sort((a, b) => b.at - a.at);
  const note = STATUS_NOTE[w.status];
  const name = driver?.name ?? w.driverId;

  const run = (action: WithdrawalAction, reason: string) =>
    act(
      {
        label: DESCRIBE[action].title,
        apply: (draft, ctx) => applyWithdrawalAction(draft, w.id, action, { ...ctx, reason, staff: staff ?? undefined }),
        audit: () => ({
          action: `withdrawal.${action}`,
          target: { type: 'withdrawal', id: w.id, label: `Withdrawal ${w.id}` },
          summary: `${DESCRIBE[action].title}: ${money(w.amount)} for ${name}${action.startsWith('sim_') ? ' (simulated provider event)' : ''}`,
          reason: reason || undefined,
        }),
      },
      action.startsWith('sim_') ? `${DESCRIBE[action].title}: recorded` : `${DESCRIBE[action].title}: done`,
    );
  const describe = (a: WithdrawalAction) => ({ title: DESCRIBE[a].title, body: DESCRIBE[a].body(w) });
  const real = options.filter((o) => !o.simulated);
  const sim = options.filter((o) => o.simulated);

  return (
    <Drawer title={`Withdrawal ${money(w.amount)}`} sub={`${w.id} · ${name}`} onClose={onClose} footer={real.length ? <ActionButtons options={real} run={run} describe={describe} /> : undefined}>
      <div className="row wrap">
        <StatusPill tone={WITHDRAWAL_TONE[w.status]} status={w.status} />
        {needsReviewNote(w) ? <Pill tone="warning" icon="shield">{needsReviewNote(w)}</Pill> : null}
      </div>
      <Notice tone={note.tone}>{note.text}</Notice>
      {STEP_AT[w.status] !== undefined ? <FlowSteps label="Where this withdrawal is" steps={STEPS} current={STEP_AT[w.status]} vertical /> : null}
      {w.status === 'processing' ? (
        <Rule icon="refresh">Never submit this transfer again while it is processing. If the result is unclear, look it up with the provider by its transfer reference: a second submission could pay the driver twice.</Rule>
      ) : null}
      {approval ? (
        <Card muted>
          <SubHead aside={<Pill tone={approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'neutral' : 'warning'} icon="checkCircle">Approval {approval.status}</Pill>}>Two person check</SubHead>
          <KV
            items={[
              ['Asked by', `${approval.requestedBy.name}, ${when(approval.requestedAt, now())}`],
              ['Decided by', approval.decidedBy ? `${approval.decidedBy.name}, ${when(approval.decidedAt, now())}` : 'Waiting. The person who asked can’t approve it'],
            ]}
          />
        </Card>
      ) : null}
      <KV
        items={[
          ['Driver', <RecordLink type="driver" id={w.driverId}>{name}</RecordLink>],
          ['City', driver ? city(driver.city) : 'Unknown'],
          ['Amount', <span className="num strong">{money(w.amount)}</span>],
          ['Bank account', `${w.bankAccount.bankName} ${w.bankAccount.accountNumberMasked}`],
          ['Account name', w.bankAccount.accountName],
          ['Account verified', driver?.bankAccount ? (driver.bankAccount.verified ? 'Yes' : 'No') : 'Unknown'],
          ['Provider', w.provider ?? 'Not submitted'],
          ['Transfer reference', w.transferReference ?? 'Not submitted'],
          ['Requested', when(w.requestedAt, now())],
          ...(w.reviewNote ? ([['Review note', w.reviewNote]] as [string, ReactNode][]) : []),
        ]}
      />
      {sim.length ? (
        <Card muted>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="strong">Simulated provider events</span>
            <SimTag />
          </div>
          <div className="small muted" style={{ marginBottom: 10 }}>No provider is connected. These buttons stand in for the events Paystack (test) would send.</div>
          <div className="row wrap">
            <ActionButtons options={sim} run={run} describe={describe} />
          </div>
        </Card>
      ) : null}
      {!options.length && (w.status === 'requested' || w.status === 'under_review' || w.status === 'processing' || w.status === 'successful') ? (
        <div className="small muted">Your role can view this withdrawal. Reviewing and processing need finance access.</div>
      ) : null}
      <div>
        <SubHead>History</SubHead>
        <Timeline items={[...w.history].reverse().map((h) => ({ at: h.at, title: <span className="row wrap" style={{ gap: 6 }}>{label(h.status)}{h.note?.includes('simulated') ? <SimTag /> : null}</span>, sub: [h.by.name, h.note].filter(Boolean).join(' · ') }))} />
      </div>
      <div>
        <SubHead>Ledger</SubHead>
        <LedgerLines entries={entries} now={now()} />
      </div>
    </Drawer>
  );
}
