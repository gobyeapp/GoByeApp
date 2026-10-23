import { useState, type ReactNode } from 'react';
import { APPROVAL_RULES, CITY_LABELS, ROLE_LABELS, type ApprovalKind, type ApprovalRequest, type PlatformDataset } from '@gobye/core';
import { date, label, money, signedMoney, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Drawer, Empty, KV, Notice, PageHead, Pill, Stat, Table, Tabs, Timeline, type Column, type Tone } from '@/ui/kit';
import { applyDecision, approvalEffectText, decideBlockReason, failingChecks, requestedRoles, type Decision } from './logic';

const KIND_LABEL: Record<ApprovalKind, string> = {
  config_publish: 'Configuration',
  refund: 'Refund',
  ledger_adjustment: 'Ledger correction',
  withdrawal: 'Withdrawal',
  payments_activation: 'Payments activation',
  announcement: 'Announcement',
  staff_role: 'Staff access',
  fee_schedule: 'Fee schedule',
  automation_config: 'Automation setting',
};
const STATUS: Record<ApprovalRequest['status'], { tone: Tone; text: string }> = {
  pending: { tone: 'warning', text: 'Pending' },
  approved: { tone: 'success', text: 'Approved' },
  rejected: { tone: 'danger', text: 'Rejected' },
};

export default function Approvals() {
  const d = useData();
  const { now } = usePlatform();
  const { staff } = useSession();
  const [tab, setTab] = useState<'pending' | 'decided'>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const t = now();
  const pending = d.approvals.filter((a) => a.status === 'pending').sort((a, b) => b.requestedAt - a.requestedAt);
  const decided = d.approvals.filter((a) => a.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  const selected = openId ? d.approvals.find((a) => a.id === openId) : undefined;
  const mineToDecide = staff ? pending.filter((a) => !decideBlockReason(a, staff)).length : 0;
  const blocked = pending.filter((a) => (failingChecks(d, a) ?? []).length).length;

  const columns: Column<ApprovalRequest>[] = [
    { key: 'req', label: 'Request', sortValue: (a) => a.title, render: (a) => (<><div className="cell-title">{a.title}</div><div className="cell-sub">{KIND_LABEL[a.kind]}</div></>) },
    { key: 'by', label: 'Requested by', sortValue: (a) => a.requestedAt, render: (a) => (<><div>{a.requestedBy.name}</div><div className="cell-sub">{when(a.requestedAt, t)}</div></>) },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (a) => a.amount ?? -1, render: (a) => (a.amount !== undefined ? <span className="num">{money(a.amount)}</span> : <span className="muted">None</span>) },
    { key: 'who', label: 'Decided by', sortValue: (a) => a.decidedAt ?? 0, render: (a) => (<><div>{a.decidedBy?.name ?? 'Unknown'}</div><div className="cell-sub">{when(a.decidedAt, t)}</div></>) },
    { key: 'status', label: 'Status', sortValue: (a) => a.status, render: (a) => <StatusPill d={d} a={a} /> },
  ];

  return (
    <>
      <PageHead eyebrow="Oversight" title="Approvals" sub="Sensitive changes need a second person. Nobody decides their own request." />
      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <Stat icon="time" label="Waiting for a decision" value={pending.length} sub="Newest request first" tone={pending.length ? 'warning' : undefined} onClick={() => setTab('pending')} />
        <Stat icon="user" label="You can decide" value={mineToDecide} sub="Your role is an approver and you didn’t ask" onClick={() => setTab('pending')} />
        <Stat icon="lock" label="Blocked by checks" value={blocked} sub="Can be rejected, not approved yet" tone={blocked ? 'danger' : undefined} onClick={() => setTab('pending')} />
        <Stat icon="history" label="Decided" value={decided.length} sub="Approved or rejected, with reasons" onClick={() => setTab('decided')} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <Notice icon="group">
          Two-person rule: the person who asks for a change can never approve it. The request waits until someone holding an approver role decides, and both names are saved to the audit trail.
        </Notice>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'pending', label: 'Pending', count: pending.length }, { value: 'decided', label: 'Decided', count: decided.length }]} />
      {tab === 'pending' ? (
        pending.length ? (
          <div className="stack" style={{ gap: 12 }}>
            {pending.map((a) => (
              <PendingCard key={a.id} a={a} now={t} onOpen={() => setOpenId(a.id)} />
            ))}
          </div>
        ) : (
          <Card>
            <Empty title="No approvals waiting" icon="checkCircle">New requests appear here when someone asks to publish settings, refund, pay out or change access.</Empty>
          </Card>
        )
      ) : (
        <Card flush>
          <Table
            rows={decided}
            columns={columns}
            rowKey={(a) => a.id}
            onRowClick={(a) => setOpenId(a.id)}
            pageSize={20}
            caption="Decided approvals"
            empty={<Empty title="No decisions yet" icon="history">Approved and rejected requests appear here with who decided and why.</Empty>}
          />
        </Card>
      )}
      {selected ? <ApprovalDrawer req={selected} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

/** One pending request: what changes, who asked, who may decide and whether this viewer can. */
function PendingCard({ a, now, onOpen }: { a: ApprovalRequest; now: number; onOpen: () => void }) {
  const d = useData();
  const { staff } = useSession();
  const block = staff ? decideBlockReason(a, staff) : 'Not signed in';
  const failing = failingChecks(d, a) ?? [];
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 14 }}>
        <span className="kpi-ico" style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--warning-bg)', color: 'var(--warning)', flexShrink: 0 }}>
          <Icon name="time" size={18} />
        </span>
        <div className="stack tight" style={{ flex: 1, minWidth: 220 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="strong">{a.title}</span>
            <Pill tone="neutral" icon={null}>{KIND_LABEL[a.kind]}</Pill>
            <StatusPill d={d} a={a} />
          </div>
          <div className="small">If approved: {approvalEffectText(a)}</div>
          <div className="small muted">
            Asked by {a.requestedBy.name} · {when(a.requestedAt, now)} · decided by {a.approverRoles.map((r) => ROLE_LABELS[r]).join(' or ')}
            {a.amount !== undefined ? <> · <span className="num">{money(a.amount)}</span></> : null}
          </div>
          {failing.length ? (
            <div className="small row" style={{ gap: 6, color: 'var(--danger)' }}>
              <Icon name="lock" size={14} /> {failing.length} live {failing.length === 1 ? 'check hasn’t' : 'checks haven’t'} passed
            </div>
          ) : null}
        </div>
        <div className="stack tight" style={{ alignItems: 'flex-end' }}>
          <Button size="sm" variant={block ? 'secondary' : 'primary'} icon="right" onClick={onOpen}>
            {block ? 'View' : 'Review'}
          </Button>
          {block ? <span className="small muted" style={{ maxWidth: 220, textAlign: 'right' }}>{block}</span> : null}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ d, a }: { d: PlatformDataset; a: ApprovalRequest }) {
  const failing = a.status === 'pending' ? failingChecks(d, a) : null;
  if (failing && failing.length) return <Pill tone="danger" icon="lock">Blocked</Pill>;
  return <Pill tone={STATUS[a.status].tone}>{STATUS[a.status].text}</Pill>;
}

function ApprovalDrawer({ req, onClose }: { req: ApprovalRequest; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { staff } = useSession();
  const act = useAction();
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const t = now();
  const rule = APPROVAL_RULES[req.kind];
  const failing = failingChecks(d, req);
  const blocked = staff ? decideBlockReason(req, staff) : 'Not signed in';
  const approveBlock = blocked ?? (failing && failing.length ? 'Live checks haven’t all passed' : null);
  const decision = d.audit.find((e) => e.action.startsWith('approval.') && e.target.id === req.target.id && e.at === req.decidedAt);

  const decide = async (dec: Decision, reason: string) => {
    if (!staff) return;
    const r = await act(
      {
        label: dec === 'approved' ? 'Approve request' : 'Reject request',
        apply: (draft, ctx) => applyDecision(draft, req.id, dec, { ...ctx, staff, reason }),
        audit: () => ({
          action: `approval.${dec}`,
          target: req.target,
          summary: `${dec === 'approved' ? 'Approved' : 'Rejected'}: ${req.title}`,
          diff: [{ field: 'Approval', from: 'Pending', to: label(dec) }],
          reason: reason || undefined,
        }),
      },
      dec === 'approved' ? 'Approved. The change has been applied.' : 'Rejected. The requester can see why.',
    );
    if (r.ok) setConfirm(null);
  };

  return (
    <Drawer
      title={req.title}
      sub={`${KIND_LABEL[req.kind]} · requested ${when(req.requestedAt, t)}`}
      onClose={onClose}
      footer={
        req.status === 'pending' ? (
          <>
            <Button variant="danger-soft" icon="close" onClick={() => setConfirm('rejected')} disabledReason={blocked ?? undefined}>Reject</Button>
            <Button variant="primary" icon="check" onClick={() => setConfirm('approved')} disabledReason={approveBlock ?? undefined}>Approve</Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="row wrap">
        <StatusPill d={d} a={req} />
        {req.amount !== undefined ? <Pill tone="neutral" icon="wallet">{money(req.amount)}</Pill> : null}
      </div>
      {req.status === 'pending' && blocked ? <Notice icon="lock">{blocked}.</Notice> : null}
      {req.status === 'pending' && failing && failing.length ? (
        <Notice tone="danger">
          Can’t approve yet. A provider goes live only after every connection check passes. Not passed: {failing.join(', ')}.
        </Notice>
      ) : null}
      <KV
        items={[
          ['Requested by', req.requestedBy.name],
          ['Requested', when(req.requestedAt, t)],
          ['Who can decide', `${req.approverRoles.map((r) => ROLE_LABELS[r]).join(' or ')}, never the requester`],
          ['Rule', rule.note],
          ...(req.note ? ([['Note', req.note]] as [string, ReactNode][]) : []),
          ...(req.status !== 'pending'
            ? ([
                ['Decided by', req.decidedBy?.name ?? 'Unknown'],
                ['Decided', when(req.decidedAt, t)],
                ...(decision?.reason ? ([['Reason', decision.reason]] as [string, ReactNode][]) : []),
              ] as [string, ReactNode][])
            : []),
        ]}
      />
      <div>
        <h3 className="strong" style={{ marginBottom: 10 }}>What this changes</h3>
        <Target d={d} req={req} now={t} />
      </div>
      {req.status === 'pending' ? (
        <Card muted>
          <div className="row small" style={{ alignItems: 'flex-start' }}>
            <Icon name="info" size={16} />
            <span>If approved: {approvalEffectText(req)}</span>
          </div>
        </Card>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm === 'approved' ? 'Approve this request?' : 'Reject this request?'}
          body={confirm === 'approved' ? approvalEffectText(req) : 'Nothing is applied. The reason is saved to the audit trail and shown to the requester.'}
          confirmLabel={confirm === 'approved' ? 'Approve' : 'Reject'}
          danger={confirm === 'rejected'}
          requireReason={confirm === 'rejected'}
          onConfirm={(reason) => decide(confirm, reason)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </Drawer>
  );
}

function Target({ d, req, now }: { d: PlatformDataset; req: ApprovalRequest; now: number }) {
  const missing = <Notice tone="warning">The target record ({req.target.label}) isn’t in the test data.</Notice>;
  switch (req.kind) {
    case 'refund': {
      const r = d.refunds.find((x) => x.id === req.target.id);
      if (!r) return missing;
      const trip = r.tripId ? d.trips.find((x) => x.id === r.tripId) : undefined;
      const p = d.passengers.find((x) => x.id === r.passengerId);
      return (
        <KV
          items={[
            ['Amount', money(r.amount)],
            ['Reason', r.reason],
            ['Refund to', r.destination === 'wallet' ? 'GoBye Wallet' : 'Original payment method'],
            ['Refund status', label(r.status)],
            ['Passenger', p ? <RecordLink type="passenger" id={p.id}>{p.name}</RecordLink> : 'Unknown'],
            ['Trip', trip ? <RecordLink type="trip" id={trip.id}>{trip.ref}</RecordLink> : 'Not linked'],
          ]}
        />
      );
    }
    case 'withdrawal': {
      const w = d.withdrawals.find((x) => x.id === req.target.id);
      if (!w) return missing;
      const dr = d.drivers.find((x) => x.id === w.driverId);
      return (
        <div className="stack">
          <KV
            items={[
              ['Driver', dr ? <RecordLink type="driver" id={dr.id}>{dr.name}</RecordLink> : 'Unknown'],
              ['Amount', money(w.amount)],
              ['Bank account', `${w.bankAccount.bankName} ${w.bankAccount.accountNumberMasked} · ${w.bankAccount.accountName}`],
              ['Withdrawal status', label(w.status)],
            ]}
          />
          <div className="small muted">The amount is reserved from the driver’s earnings until a decision. Rejecting returns it.</div>
          <Timeline items={w.history.map((h) => ({ at: h.at, title: label(h.status), sub: [h.by.name, h.note].filter(Boolean).join(' · ') }))} />
        </div>
      );
    }
    case 'config_publish': {
      const v = d.configVersions.find((x) => x.id === req.target.id);
      if (!v) return missing;
      const active = d.configVersions.find((x) => x.key === v.key && x.status === 'active' && x.id !== v.id);
      const keys = Object.keys({ ...(active?.value as object | undefined), ...(v.value as object) });
      const fmt = (x: unknown) => (x === undefined ? 'Not set' : typeof x === 'object' ? JSON.stringify(x) : String(x));
      return (
        <div className="stack">
          <KV items={[['Setting', label(v.key)], ['Version', `v${v.version} · ${label(v.status)}`], ['Effective from', `${date(v.effectiveFrom)}${v.effectiveFrom > now ? ' (future)' : ''}`], ['Change note', v.note], ['Prepared by', v.createdBy.name]]} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Field</th><th>In force{active ? ` (v${active.version})` : ''}</th><th>Proposed</th></tr></thead>
              <tbody>
                {keys.map((k) => {
                  const from = fmt((active?.value as Record<string, unknown> | undefined)?.[k]);
                  const to = fmt((v.value as Record<string, unknown>)[k]);
                  return (
                    <tr key={k}>
                      <td>{label(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</td>
                      <td className="muted">{from}</td>
                      <td className={from !== to ? 'strong' : undefined}>{to}{from !== to ? ' (changed)' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    case 'announcement': {
      const a = d.announcements.find((x) => x.id === req.target.id);
      if (!a) return missing;
      return (
        <KV
          items={[
            ['Title', a.title],
            ['Message', a.body],
            ['Audience', `${label(a.audience.type)}s in ${a.audience.cities.map((c) => CITY_LABELS[c]).join(' and ')} · about ${a.audienceSize}`],
            ['Channels', a.channels.map((c) => (c === 'inbox' ? 'App inbox' : c === 'sms' ? 'SMS' : label(c))).join(', ')],
            ['Schedule', a.scheduledFor ? when(a.scheduledFor, now) : 'Send when approved'],
            ['Status', label(a.status)],
          ]}
        />
      );
    }
    case 'payments_activation': {
      const i = d.integrations.find((x) => x.id === req.target.id);
      if (!i) return missing;
      return (
        <div className="stack">
          <KV items={[['Provider', i.provider], ['Environment', label(i.environment)], ['Connection', label(i.state)], ['Owner', i.owner]]} />
          <div className="stack tight">
            {i.checks.length ? (
              i.checks.map((c) => (
                <div key={c.name} className="row small">
                  <Pill tone={c.passed ? 'success' : 'danger'}>{c.passed ? 'Passed' : 'Not passed'}</Pill>
                  <span>{c.name}</span>
                  {c.detail ? <span className="muted">{c.detail}</span> : null}
                </div>
              ))
            ) : (
              <span className="muted small">No connection checks recorded yet.</span>
            )}
          </div>
        </div>
      );
    }
    case 'staff_role': {
      const s = d.staff.find((x) => x.id === req.target.id);
      const roles = requestedRoles(req);
      return (
        <KV
          items={[
            ['Staff member', s ? `${s.name} · ${s.email}` : req.target.label],
            ['Current roles', s ? s.roles.map((r) => ROLE_LABELS[r]).join(', ') : 'Unknown'],
            ['Requested', roles.length ? roles.map((r) => ROLE_LABELS[r]).join(', ') : 'Not stated'],
          ]}
        />
      );
    }
    case 'ledger_adjustment':
      return (
        <div className="stack">
          <KV items={[['Record', req.target.label], ['Amount', req.amount !== undefined ? money(req.amount) : 'Not stated'], ['Posts', req.adjustment?.reverseJournalId ? `Reversal of journal ${req.adjustment.reverseJournalId}` : (req.adjustment?.description ?? 'Missing details')]]} />
          {req.adjustment?.lines?.length ? (
            <div className="stack tight small">
              {req.adjustment.lines.map((l, i) => (
                <div key={i} className="row">
                  <span style={{ flex: 1 }}>{label(l.account.kind)}{'ownerId' in l.account ? ` · ${l.account.ownerId}` : ''}</span>
                  <span className="num strong">{signedMoney(l.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
  }
}
