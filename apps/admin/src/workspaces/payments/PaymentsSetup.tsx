import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { APPROVAL_RULES, canDecide, type ApprovalRequest, type IntegrationRecord } from '@gobye/core';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, KV, Meter, Notice, PageHead, Pill, Section, Stat, Table, type Column, type Tone } from '@/ui/kit';
import { FlowSteps } from '../finance/parts';
import type { IconName } from '@/ui/Icon';
import { STATE_META, nextApprovalId } from '../developer/logic';
import { StatePill, ago } from '../developer/ui';
import {
  PROVIDERS,
  TEST_BANKS,
  isLiveRequest,
  isSettlementRequest,
  liveGate,
  maskAccount,
  openWalletRefunds,
  parseSettlementRequest,
  paymentIntegrations,
  providerExposure,
  readinessSteps,
  settlementRequestNote,
  settlementRequestTitle,
  settlementState,
  setupProblems,
  splitCapabilities,
  validateSettlement,
  type ReadinessStep,
  type SettlementDestination,
  type SetupProblem,
  type StepStatus,
} from './logic';

const STEP_PILL: Record<StepStatus, { tone: Tone; text: string; icon: IconName | null }> = {
  done: { tone: 'success', text: 'Done', icon: 'check' },
  todo: { tone: 'neutral', text: 'To do', icon: 'time' },
  blocked: { tone: 'warning', text: 'Waiting', icon: 'time' },
  not_needed: { tone: 'neutral', text: 'Not needed', icon: null },
};

export default function PaymentsSetup() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const { test, live } = paymentIntegrations(d.integrations);
  const t = now();
  const caps = splitCapabilities([...new Set([...(test?.capabilities ?? []), ...(live?.capabilities ?? [])])]);
  const problems = useMemo(() => setupProblems([live, test]), [live, test]);
  const exposure = useMemo(() => PROVIDERS.map((p) => ({ ...p, ...providerExposure(d, p.key) })), [d]);
  const walletRefunds = openWalletRefunds(d);
  const testSteps = readinessSteps(test, 'test');
  const liveSteps = readinessSteps(live, 'live');
  const progress = (steps: ReadinessStep[]) => {
    const needed = steps.filter((s) => s.status !== 'not_needed');
    return { done: needed.filter((s) => s.status === 'done').length, total: needed.length };
  };
  const tp = progress(testSteps);
  const lp = progress(liveSteps);
  const liveWaiting = d.approvals.filter((a) => isLiveRequest(a) && a.target.id === live?.id && a.status === 'pending').length;

  return (
    <>
      <PageHead eyebrow="Technical" title="Payments setup" sub="Choose the payment provider, check readiness and approve going live." meta={<Pill tone="warning" icon="info">Test mode only · no real money</Pill>} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="code" label="Test mode readiness" value={`${tp.done} of ${tp.total}`} sub="Required steps done" />
        <Stat icon="lock" label="Live readiness" value={`${lp.done} of ${lp.total}`} sub={liveGate(live).allowed ? 'Every live check passed' : 'Live stays off until every check passes'} tone={liveGate(live).allowed ? undefined : 'warning'} />
        <Stat icon="checkCircle" label="Live requests waiting" value={String(liveWaiting)} sub="Owner approval, never by the requester" />
        <Stat icon="alert" label="Setup problems" value={String(problems.length)} sub="Listed below with who owns each" tone={problems.length ? 'warning' : undefined} />
      </div>
      <div className="stack">
        <Notice tone="warning" icon="info">
          Prototype on test data. Nothing is connected to Paystack or any bank, and no real money moves. Paystack is shown in test mode only.
        </Notice>
        <Notice tone="info" icon="exchange">
          Changing gateway keeps the provider on existing transactions so pending payments, refunds and payouts can still be resolved.
        </Notice>
      </div>

      <Section title="Provider">
        <div className="grid cols-3">
          {PROVIDERS.map((p) => (
            <Card key={p.key}>
              <div className="stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3>{p.name}</h3>
                  {p.implemented ? (
                    <Pill tone="neutral" icon="checkCircle">
                      Chosen
                    </Pill>
                  ) : (
                    <Pill tone="neutral" icon={null}>
                      Not implemented
                    </Pill>
                  )}
                </div>
                <p className="small muted">{p.note}</p>
                {p.implemented ? (
                  <>
                    <CapabilityList title="Collections" items={caps.collection} />
                    <CapabilityList title="Payouts" items={caps.payout} />
                    {caps.other.length ? <CapabilityList title="Also" items={caps.other} /> : null}
                  </>
                ) : (
                  <p className="small muted">Capabilities not assessed.</p>
                )}
                {!p.implemented ? (
                  <div>
                    <Button size="sm" disabledReason="Not implemented in GoBye. It can’t be chosen until it is built and tested">
                      Choose
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Connection status" desc="Each environment lists its required steps in order. A step marked Waiting depends on someone outside the dashboard.">
        <div className="grid cols-2">
          <EnvironmentCard title="Test mode" integ={test} steps={testSteps} now={t} />
          <EnvironmentCard title="Live" integ={live} steps={liveSteps} now={t} />
        </div>
      </Section>

      <LiveActivation live={live} />

      <Section title="Setup problems">
        <ProblemTable problems={problems} canOpen={can('integrations.view')} />
      </Section>

      <Settlement live={live} />

      <Section title="In flight by provider">
        <Card flush>
          <Table
            rows={exposure}
            rowKey={(r) => r.key}
            columns={[
              { key: 'p', label: 'Provider', render: (r) => <span className="cell-title">{r.name}</span> },
              { key: 'c', label: 'Pending collections', align: 'right', render: (r) => <span className="num">{r.pendingCollections}</span> },
              { key: 'w', label: 'Processing withdrawals', align: 'right', render: (r) => <span className="num">{r.processingWithdrawals}</span> },
              { key: 'r', label: 'Open refunds to original method', align: 'right', render: (r) => <span className="num">{r.openRefunds}</span> },
            ]}
          />
        </Card>
        <p className="small muted" style={{ marginTop: 8 }}>
          These stay with the provider that started them if the gateway changes. {walletRefunds ? `${walletRefunds} open ${walletRefunds === 1 ? 'refund goes' : 'refunds go'} to GoBye wallets and don’t use a provider.` : ''}
        </p>
      </Section>
    </>
  );
}

function CapabilityList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="small strong">{title}</div>
      {items.length ? (
        <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {items.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="small muted">None listed</p>
      )}
    </div>
  );
}

function EnvironmentCard({ title, integ, steps, now }: { title: string; integ?: IntegrationRecord; steps: ReadinessStep[]; now: number }) {
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3>{title}</h3>
        {integ ? <StatePill state={integ.state} /> : <Pill tone="neutral" icon={null}>Not set up</Pill>}
      </div>
      {(() => {
        const needed = steps.filter((s) => s.status !== 'not_needed');
        const done = needed.filter((s) => s.status === 'done').length;
        return (
          <div className="ready-meter">
            <Meter value={needed.length ? done / needed.length : 0} label={`${title}: ${done} of ${needed.length} required steps done`} />
            <span className="num">{done} of {needed.length} done</span>
          </div>
        );
      })()}
      <ol className="stack tight" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {steps.map((s, k) => {
          const m = STEP_PILL[s.status];
          return (
            <li key={s.key} className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: k < steps.length - 1 ? '1px solid var(--border)' : undefined }}>
              <span className="num muted small" style={{ width: 18, paddingTop: 2 }}>
                {k + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={s.status === 'not_needed' ? 'muted' : 'strong'}>{s.label}</div>
                <div className="cell-sub">{s.detail}</div>
              </div>
              <Pill tone={m.tone} icon={m.icon}>
                {m.text}
              </Pill>
            </li>
          );
        })}
      </ol>
      {integ ? <p className="small muted" style={{ marginTop: 10 }}>Last successful test: {ago(integ.lastSuccessfulTestAt, now)}</p> : null}
    </Card>
  );
}

/* ---------------- Live activation (owner approval) ---------------- */

function LiveActivation({ live }: { live?: IntegrationRecord }) {
  const d = useData();
  const { now } = usePlatform();
  const { can, staff } = useSession();
  const act = useAction();
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);
  const gate = liveGate(live);
  const requests = d.approvals.filter((a) => isLiveRequest(a) && a.target.id === live?.id);
  const pending = requests.filter((a) => a.status === 'pending');
  const decided = requests.filter((a) => a.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  const canApprove = can('payments_setup.approve');
  const canRequest = canApprove || can('integrations.configure');
  const t = now();

  const approveReason = (a: ApprovalRequest) => {
    if (!canApprove) return 'Only the owner can approve going live';
    if (!staff || !canDecide(a, staff)) return 'You requested this. Another owner must approve it';
    return gate.reason;
  };

  const approve = (a: ApprovalRequest) =>
    act(
      {
        label: 'Approve live activation',
        apply: (draft, ctx) => {
          const req = draft.approvals.find((x) => x.id === a.id);
          const x = draft.integrations.find((i) => i.id === live?.id);
          if (!req || !x) return { ok: false, error: 'Request not found' };
          if (!staff || !canDecide(req, staff)) return { ok: false, error: 'You can’t decide this request' };
          const g = liveGate(x);
          if (!g.allowed) return { ok: false, error: g.reason ?? 'Live checks have not passed' };
          req.status = 'approved';
          req.decidedBy = ctx.actor;
          req.decidedAt = ctx.now;
          x.state = 'live';
          return { ok: true };
        },
        audit: () => ({ action: 'payments.live_approved', target: { type: 'integration', id: live!.id, label: 'Paystack (live)' }, summary: `Approved ${a.id}: Paystack live`, diff: [{ field: 'State', from: STATE_META[live!.state].text, to: 'Live' }] }),
      },
      'Approved. Paystack live is switched on',
    );

  const reject = (a: ApprovalRequest, reason: string) =>
    act(
      {
        label: 'Reject request',
        apply: (draft, ctx) => {
          const req = draft.approvals.find((x) => x.id === a.id);
          if (!req) return { ok: false, error: 'Request not found' };
          if (!staff || !canDecide(req, staff)) return { ok: false, error: 'You can’t decide this request' };
          req.status = 'rejected';
          req.decidedBy = ctx.actor;
          req.decidedAt = ctx.now;
          req.note = reason;
          return { ok: true };
        },
        audit: () => ({ action: 'approval.rejected', target: { type: 'approval', id: a.id, label: a.title }, summary: `Rejected ${a.id}: ${a.title}`, reason }),
      },
      'Request rejected',
    );

  const request = () =>
    act(
      {
        label: 'Request live activation',
        apply: (draft, ctx) => {
          if (!live) return { ok: false, error: 'There is no live configuration yet' };
          if (draft.approvals.some((x) => isLiveRequest(x) && x.status === 'pending' && x.target.id === live.id)) return { ok: false, error: 'A request is already waiting' };
          draft.approvals.unshift({ id: nextApprovalId(draft.approvals), kind: 'payments_activation', title: 'Switch Paystack to live', requestedBy: ctx.actor, requestedAt: ctx.now, target: { type: 'integration', id: live.id, label: 'Paystack (live)' }, status: 'pending', approverRoles: APPROVAL_RULES.payments_activation.approverRoles, note: gate.allowed ? undefined : 'Blocked until live checks pass' });
          return { ok: true };
        },
        audit: (draft) => ({ action: 'approval.requested', target: { type: 'approval', id: draft.approvals[0]!.id, label: 'Switch Paystack to live' }, summary: 'Requested approval to switch Paystack to live' }),
      },
      'Request created. It waits for owner approval',
    );

  return (
    <Section title="Live activation">
      <Card>
        <div className="stack">
          <FlowSteps
            label="How going live works"
            steps={['Every live check passes', 'A developer or the owner asks', 'Another owner approves', 'Live payments switch on']}
            current={live?.state === 'live' ? 4 : pending.length ? (gate.allowed ? 2 : 0) : gate.allowed ? 1 : 0}
          />
          {gate.allowed ? (
            <Notice tone="success">Every live check has passed. Live can be approved.</Notice>
          ) : (
            <Notice tone="warning" icon="lock">
              {gate.reason}. Live is approved only after every required check passes; see setup problems below.
            </Notice>
          )}
          {pending.length ? (
            pending.map((a) => (
              <div key={a.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="strong">{a.title}</div>
                    <div className="cell-sub">
                      {a.id} · requested by {a.requestedBy.name}, {ago(a.requestedAt, t)}
                    </div>
                  </div>
                  <Pill tone="warning" icon="time">
                    Pending
                  </Pill>
                </div>
                {a.note ? <p className="small muted">{a.note}</p> : null}
                <div className="row">
                  <Button variant="primary" icon="check" disabledReason={approveReason(a)} onClick={() => approve(a)}>
                    Approve live
                  </Button>
                  <Button variant="danger-soft" disabledReason={!canApprove ? 'Only the owner can decide' : staff && !canDecide(a, staff) ? 'You requested this' : undefined} onClick={() => setRejecting(a)}>
                    Reject
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <Empty title="No live request waiting" icon="checkCircle" action={canRequest ? <Button onClick={request}>Request live activation</Button> : undefined}>
              {canRequest ? 'Create a request now; it can be approved once every live check passes.' : 'A developer or the owner creates the request.'}
            </Empty>
          )}
          {decided.length ? (
            <div>
              <div className="small strong">Earlier decisions</div>
              <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {decided.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    {a.id}: {a.status === 'approved' ? 'Approved' : 'Rejected'} by {a.decidedBy?.name ?? 'unknown'}, {ago(a.decidedAt, t)}
                    {a.note && a.status === 'rejected' ? ` (${a.note})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>
      {rejecting ? (
        <ConfirmDialog
          title="Reject live request?"
          body={`${rejecting.id} is closed. A new request is needed to go live later.`}
          confirmLabel="Reject"
          danger
          requireReason
          onCancel={() => setRejecting(null)}
          onConfirm={async (reason) => {
            const r = await reject(rejecting, reason);
            if (r.ok) setRejecting(null);
          }}
        />
      ) : null}
    </Section>
  );
}

/* ---------------- Setup problems ---------------- */

function ProblemTable({ problems, canOpen }: { problems: SetupProblem[]; canOpen: boolean }) {
  const columns: Column<SetupProblem>[] = [
    { key: 'text', label: 'To do', render: (p) => <span className="strong">{p.text}</span> },
    { key: 'env', label: 'Environment', render: (p) => (p.environment === 'live' ? 'Live' : 'Test mode') },
    {
      key: 'who',
      label: 'Waiting on',
      render: (p) => (
        <Pill tone={p.waitingOn === 'Owner' ? 'warning' : 'neutral'} icon={p.waitingOn === 'Owner' ? 'user' : 'time'}>
          {p.waitingOn}
        </Pill>
      ),
    },
    {
      key: 'go',
      label: '',
      align: 'right',
      render: (p) =>
        p.waitingOn === 'Owner' && /settlement/i.test(p.check) ? (
          <a className="btn ghost sm" href="#settlement" onClick={(e) => (e.preventDefault(), document.getElementById('settlement')?.scrollIntoView({ behavior: 'smooth' }))}>
            Review settlement
          </a>
        ) : canOpen ? (
          <Link className="btn ghost sm" to={`/developer?open=${p.integrationId}`}>
            Open integration
          </Link>
        ) : null,
    },
  ];
  return (
    <Card flush>
      <Table
        rows={problems}
        columns={columns}
        rowKey={(p) => p.id}
        empty={
          <Empty title="No setup problems" icon="checkCircle">
            Every required check has passed.
          </Empty>
        }
      />
    </Card>
  );
}

/* ---------------- Settlement destination ---------------- */

function Settlement({ live }: { live?: IntegrationRecord }) {
  const d = useData();
  const { now } = usePlatform();
  const { can, staff } = useSession();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);
  const { current, pending } = settlementState(d.approvals);
  const canApprove = can('payments_setup.approve');
  const canRequest = canApprove || can('integrations.configure');
  const t = now();

  const approve = (a: ApprovalRequest) =>
    act(
      {
        label: 'Approve settlement change',
        apply: (draft, ctx) => {
          const req = draft.approvals.find((x) => x.id === a.id);
          if (!req) return { ok: false, error: 'Request not found' };
          if (!staff || !canDecide(req, staff)) return { ok: false, error: 'You can’t decide this request' };
          req.status = 'approved';
          req.decidedBy = ctx.actor;
          req.decidedAt = ctx.now;
          const x = draft.integrations.find((i) => i.id === live?.id);
          const c = x?.checks.find((k) => /settlement account/i.test(k.name));
          if (c) Object.assign(c, { passed: true, at: ctx.now, detail: 'Confirmed by owner approval' });
          return { ok: true };
        },
        audit: () => {
          const next = parseSettlementRequest(a);
          return { action: 'payments.settlement_changed', target: { type: 'integration', id: live?.id ?? 'int-pay-live', label: 'Paystack (live)' }, summary: `Approved ${a.id}: settlement destination changed`, diff: [{ field: 'Settlement account', from: `${current.bankName} ${current.accountMasked}`, to: next ? `${next.bankName} ${next.accountMasked}` : 'Unknown' }] };
        },
      },
      'Settlement destination approved',
    );

  const reject = (a: ApprovalRequest, reason: string) =>
    act(
      {
        label: 'Reject settlement change',
        apply: (draft, ctx) => {
          const req = draft.approvals.find((x) => x.id === a.id);
          if (!req) return { ok: false, error: 'Request not found' };
          if (!staff || !canDecide(req, staff)) return { ok: false, error: 'You can’t decide this request' };
          req.status = 'rejected';
          req.decidedBy = ctx.actor;
          req.decidedAt = ctx.now;
          return { ok: true };
        },
        audit: () => ({ action: 'approval.rejected', target: { type: 'approval', id: a.id, label: a.title }, summary: `Rejected ${a.id}: ${a.title}`, reason }),
      },
      'Settlement change rejected',
    );

  const settlementCheck = live?.checks.find((c) => /settlement account/i.test(c.name));

  return (
    <section className="section" id="settlement">
      <div className="section-head">
        <h2>Settlement destination</h2>
        <div className="actions">
          <Button size="sm" icon="edit" disabledReason={!canRequest ? 'Only the owner or a developer can request a change' : pending ? 'A change is already waiting for approval' : undefined} onClick={() => setEditing(true)}>
            Change destination
          </Button>
        </div>
      </div>
      <Card>
        <div className="stack">
          <KV
            items={[
              ['Bank', current.bankName],
              ['Account', <code key="a">{current.accountMasked}</code>],
              ['Account name', current.accountName],
              ['Confirmed for live', settlementCheck?.passed ? <Pill key="p" tone="success" icon="check">Confirmed</Pill> : <Pill key="p" tone="warning" icon="time">Not confirmed</Pill>],
            ]}
          />
          <p className="small muted">Test data. Provider settlements go to this account; changing it needs owner approval and never changes settlements already paid.</p>
          {pending ? (
            <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="strong">Proposed: {pending.dest.bankName} {pending.dest.accountMasked}</div>
                  <div className="cell-sub">
                    {pending.request.id} · {pending.dest.accountName} · requested by {pending.request.requestedBy.name}, {ago(pending.request.requestedAt, t)}
                  </div>
                </div>
                <Pill tone="warning" icon="time">
                  Pending approval
                </Pill>
              </div>
              <div className="row">
                <Button variant="primary" icon="check" disabledReason={!canApprove ? 'Only the owner can approve' : staff && !canDecide(pending.request, staff) ? 'You requested this. Another owner must approve it' : undefined} onClick={() => approve(pending.request)}>
                  Approve change
                </Button>
                <Button variant="danger-soft" disabledReason={!canApprove ? 'Only the owner can decide' : staff && !canDecide(pending.request, staff) ? 'You requested this' : undefined} onClick={() => setRejecting(pending.request)}>
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
      {editing ? <SettlementForm live={live} current={current} onClose={() => setEditing(false)} /> : null}
      {rejecting ? (
        <ConfirmDialog
          title="Reject settlement change?"
          body="The current destination stays in place."
          confirmLabel="Reject"
          danger
          requireReason
          onCancel={() => setRejecting(null)}
          onConfirm={async (reason) => {
            const r = await reject(rejecting, reason);
            if (r.ok) setRejecting(null);
          }}
        />
      ) : null}
    </section>
  );
}

function SettlementForm({ live, current, onClose }: { live?: IntegrationRecord; current: SettlementDestination; onClose: () => void }) {
  const act = useAction();
  const [bankName, setBank] = useState('');
  const [accountNumber, setNumber] = useState('');
  const [accountName, setName] = useState('');
  const [errors, setErrors] = useState<ReturnType<typeof validateSettlement>>({});

  const submit = async () => {
    const e = validateSettlement({ bankName, accountNumber, accountName });
    setErrors(e);
    if (Object.keys(e).length) return;
    const dest: SettlementDestination = { bankName, accountMasked: maskAccount(accountNumber), accountName: accountName.trim().toUpperCase() };
    // The full number is discarded here; only the masked form goes into the request.
    setNumber('');
    const r = await act(
      {
        label: 'Request settlement change',
        apply: (draft, ctx) => {
          if (draft.approvals.some((a) => isSettlementRequest(a) && a.status === 'pending')) return { ok: false, error: 'A change is already waiting for approval' };
          draft.approvals.unshift({
            id: nextApprovalId(draft.approvals),
            kind: 'payments_activation',
            title: settlementRequestTitle(dest),
            note: settlementRequestNote(dest),
            requestedBy: ctx.actor,
            requestedAt: ctx.now,
            target: { type: 'integration', id: live?.id ?? 'int-pay-live', label: 'Paystack (live)' },
            status: 'pending',
            approverRoles: APPROVAL_RULES.payments_activation.approverRoles,
          });
          return { ok: true };
        },
        audit: (draft) => ({
          action: 'approval.requested',
          target: { type: 'approval', id: draft.approvals[0]!.id, label: 'Change settlement destination' },
          summary: 'Requested a settlement destination change',
          diff: [{ field: 'Settlement account', from: `${current.bankName} ${current.accountMasked}`, to: `${dest.bankName} ${dest.accountMasked}` }],
        }),
      },
      'Change requested. It waits for owner approval',
    );
    if (r.ok) onClose();
  };

  return (
    <Drawer
      title="Change settlement destination"
      sub="Creates an approval request; nothing changes until an owner approves"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            Request change
          </Button>
        </div>
      }
    >
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Bank" error={errors.bankName}>
          {(id) => (
            <select id={id} className="select" value={bankName} onChange={(e) => setBank(e.target.value)}>
              <option value="">Choose a bank</option>
              {TEST_BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Account number" error={errors.accountNumber} hint="10 digits. Only the last 4 are kept.">
          {(id) => <input id={id} className="input" inputMode="numeric" autoComplete="off" maxLength={10} value={accountNumber} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} />}
        </Field>
        <Field label="Account name" error={errors.accountName} hint="As the bank shows it. The provider confirms it in the real system.">
          {(id) => <input id={id} className="input" autoComplete="off" value={accountName} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Notice tone="info" icon="lock">
          In the real system this goes to protected server storage; it is never stored in the browser. This prototype keeps only the bank, the last 4 digits and the name on the request.
        </Notice>
        <p className="small muted">Current: {current.bankName} {current.accountMasked}. Settlements already paid keep their destination.</p>
      </form>
    </Drawer>
  );
}
