import { useMemo, useState, type ReactNode } from 'react';
import type { CaseCategory, CasePriority, CaseRecord, CaseStatus, RefundRecord, RefundStatus } from '@gobye/core';
import { RecordLink, PAYMENT_STATE } from '@/data/records';
import { useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { city, label, money, when } from '@/data/format';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Empty, Field, FilterBar, KV, Notice, PageHead, Pill, SearchInput, Segmented, Select, Stat, Table, Tabs, type Column, type Tone } from '@/ui/kit';
import { ActionTimeline, Block, FormDialog, MessageStreams, PriorityPill, STATUS_PILL, StatusPill, WideDrawer, actorName, useDeepLinkedCase } from './caseKit';
import {
  CARE_CATEGORIES,
  CARE_RESPONSE_TARGET_MIN,
  LOST_ITEM_STEPS,
  PRIORITIES,
  TEAM_LABEL,
  allowedCaseActions,
  applyAssign,
  applyEscalate,
  applyLostItemStep,
  applyMessage,
  applyNewCase,
  applyPriority,
  applyRefundRequest,
  applyReopen,
  applyResolve,
  applyStatus,
  formatAge,
  inTab,
  isOpen,
  lostItemDone,
  overResponseTarget,
  refundBlockReason,
  refundableKobo,
  searchPeople,
  sortQueue,
  validateNewCase,
  validateRefund,
  type EscalationTeam,
  type NewCaseInput,
  type Person,
  type QueueTab,
} from './logic';

export const REFUND_PILL: Record<RefundStatus, { tone: Tone; text: string }> = {
  requested: { tone: 'warning', text: 'Waiting for approval' },
  approved: { tone: 'info', text: 'Approved' },
  rejected: { tone: 'danger', text: 'Rejected' },
  processing: { tone: 'warning', text: 'Processing' },
  completed: { tone: 'success', text: 'Completed' },
  failed: { tone: 'danger', text: 'Failed' },
};

const caseTarget = (c: CaseRecord) => ({ type: 'case' as const, id: c.id, label: c.ref });
const PRIORITY_ORDER: Record<CasePriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_ORDER: Record<CaseStatus, number> = { new: 0, escalated: 1, in_progress: 2, waiting: 3, resolved: 4, closed: 5 };

export default function Cases() {
  const d = useData();
  const { now } = usePlatform();
  const { staff, can, inScope } = useSession();
  const keep = useScopedFilter();
  const [tab, setTab] = useState<QueueTab>(can('cases.work') ? 'mine' : 'open');
  const [category, setCategory] = useState<CaseCategory | 'all'>('all');
  const [priority, setPriority] = useState<CasePriority | 'all'>('all');
  const [status, setStatus] = useState<CaseStatus | 'all'>('all');
  const [q, setQ] = useState('');
  // `?open=<case id>` (command palette, links) opens that case when the viewer can see it.
  const { openId, setOpenId, close, missing } = useDeepLinkedCase((id) => d.cases.some((c) => c.id === id && c.team === 'care' && inScope(c.city)));
  const [creating, setCreating] = useState(false);
  const t = now();
  const me = staff?.id;

  const scoped = useMemo(() => d.cases.filter((c) => c.team === 'care' && keep(c.city, c.openedAt, t)), [d.cases, keep, t]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    d.passengers.forEach((p) => m.set(p.id, p.name));
    d.drivers.forEach((x) => m.set(x.id, x.name));
    d.staff.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [d.passengers, d.drivers, d.staff]);
  const customerOf = (c: CaseRecord) => (c.openedBy.kind === 'passenger' || c.openedBy.kind === 'driver' ? c.openedBy.name : c.links.passengerId ? nameOf.get(c.links.passengerId) : c.links.driverId ? nameOf.get(c.links.driverId) : undefined) ?? 'Unknown';

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return sortQueue(
      scoped.filter(
        (c) =>
          inTab(c, tab, me) &&
          (category === 'all' || c.category === category) &&
          (priority === 'all' || c.priority === priority) &&
          (status === 'all' || c.status === status) &&
          (!s || c.ref.toLowerCase().includes(s) || c.subject.toLowerCase().includes(s) || customerOf(c).toLowerCase().includes(s)),
      ),
    );
  }, [scoped, tab, me, category, priority, status, q, nameOf]);

  const counts = {
    mine: scoped.filter((c) => inTab(c, 'mine', me)).length,
    unassigned: scoped.filter((c) => inTab(c, 'unassigned', me)).length,
    open: scoped.filter((c) => inTab(c, 'open', me)).length,
    done: scoped.filter((c) => inTab(c, 'done', me)).length,
  };
  const escalated = scoped.filter((c) => c.status === 'escalated').length;
  const waiting = scoped.filter((c) => c.status === 'waiting').length;
  const overTarget = scoped.filter((c) => overResponseTarget(c, t)).length;

  const columns: Column<CaseRecord>[] = [
    {
      key: 'case',
      label: 'Case',
      sortValue: (c) => c.ref,
      render: (c) => (
        <div>
          <div className="cell-title">{c.subject}</div>
          <div className="cell-sub">
            {c.ref} · {label(c.category)} · {city(c.city)}
          </div>
        </div>
      ),
    },
    { key: 'customer', label: 'Customer', sortValue: (c) => customerOf(c), render: (c) => customerOf(c) },
    { key: 'priority', label: 'Priority', sortValue: (c) => PRIORITY_ORDER[c.priority], render: (c) => <PriorityPill p={c.priority} /> },
    { key: 'status', label: 'Status', sortValue: (c) => STATUS_ORDER[c.status], render: (c) => <StatusPill s={c.status} /> },
    { key: 'owner', label: 'Owner', render: (c) => (c.ownerId ? (c.ownerId === me ? 'You' : (nameOf.get(c.ownerId) ?? 'Unknown')) : <span className="muted">Unassigned</span>) },
    {
      key: 'age',
      label: 'Age',
      // Oldest first when ascending: the case that has waited longest.
      sortValue: (c) => c.openedAt,
      render: (c) => (
        <div className="stack tight">
          <span className="num">{isOpen(c.status) ? `Open ${formatAge(t - c.openedAt)}` : when(c.resolution?.at ?? c.openedAt, t)}</span>
          {overResponseTarget(c, t) ? (
            <Pill tone="danger" icon="time">
              Over target
            </Pill>
          ) : null}
        </div>
      ),
    },
  ];

  const emptyCopy: Record<QueueTab, { title: string; body: string }> = {
    mine: { title: 'No open cases assigned to you', body: 'Pick one from Unassigned to start.' },
    unassigned: { title: 'Nothing waiting for an owner', body: 'New cases appear here until someone takes them.' },
    open: { title: 'No open cases', body: 'Try another city, date range or filter.' },
    done: { title: 'No resolved or closed cases', body: 'Try a wider date range.' },
  };
  const filtered = category !== 'all' || priority !== 'all' || status !== 'all' || q.trim();

  return (
    <>
      <PageHead
        eyebrow="Care and safety"
        title="Support cases"
        sub="Passenger and driver issues, each linked to its trip, people and payment. Test data."
        actions={
          <Button variant="primary" icon="add" onClick={() => setCreating(true)} disabledReason={can('cases.work') ? undefined : 'Your role can view cases but not open them'}>
            New case
          </Button>
        }
      />
      {missing ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warning" icon="lock">That case isn’t in your support queue. It may belong to Safety, another city or a team you can’t see.</Notice>
        </div>
      ) : null}
      {!can('cases.work') ? (
        <div style={{ marginBottom: 16 }}>
          <Notice icon="eye">You have read only access to support cases. Actions are hidden for your role.</Notice>
        </div>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        {can('cases.work') ? (
          <Stat icon="user" label="My open cases" value={counts.mine} sub={`${waiting} waiting on a customer in the queue`} onClick={() => setTab('mine')} />
        ) : (
          <Stat icon="time" label="Waiting on customer" value={waiting} sub="Paused until the customer replies" onClick={() => (setTab('open'), setStatus('waiting'))} />
        )}
        <Stat icon="userAdd" label="Unassigned" value={counts.unassigned} sub="New, waiting for an owner" tone={counts.unassigned ? 'warning' : undefined} onClick={() => setTab('unassigned')} />
        <Stat icon="flag" label="Escalated" value={escalated} sub="With Finance, Safety or Operations" onClick={() => (setTab('open'), setStatus('escalated'))} />
        <Stat icon="alarm" label="Over response target" value={overTarget} tone={overTarget ? 'danger' : undefined} sub={`Placeholder targets: urgent ${CARE_RESPONSE_TARGET_MIN.urgent} min, high ${CARE_RESPONSE_TARGET_MIN.high / 60} h`} onClick={() => setTab('unassigned')} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(can('cases.work') ? [{ value: 'mine' as const, label: 'My cases', count: counts.mine }] : []),
          { value: 'unassigned', label: 'Unassigned', count: counts.unassigned },
          { value: 'open', label: 'All open', count: counts.open },
          { value: 'done', label: 'Resolved and closed', count: counts.done },
        ]}
      />
      <FilterBar
        count={`${rows.length} ${rows.length === 1 ? 'case' : 'cases'} · urgent first, then oldest`}
        end={
          filtered ? (
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              onClick={() => {
                setCategory('all');
                setPriority('all');
                setStatus('all');
                setQ('');
              }}
            >
              Clear filters
            </Button>
          ) : null
        }
      >
        <SearchInput value={q} onChange={setQ} placeholder="Search ref, subject or name" />
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ value: 'all', label: 'All statuses' }, ...(Object.keys(STATUS_PILL) as CaseStatus[]).map((x) => ({ value: x, label: STATUS_PILL[x].text }))]}
        />
        <Select label="Priority" value={priority} onChange={setPriority} options={[{ value: 'all', label: 'All priorities' }, ...PRIORITIES.map((p) => ({ value: p, label: label(p) }))]} />
        <Select label="Category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All categories' }, ...CARE_CATEGORIES.map((c) => ({ value: c, label: label(c) }))]} />
      </FilterBar>
      <Card flush>
        <Table
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          onRowClick={(c) => setOpenId(c.id)}
          pageSize={25}
          caption="Support cases"
          empty={
            <Empty icon="headphone" title={filtered ? 'No cases match these filters' : emptyCopy[tab].title}>
              {filtered ? 'Clear the filters to see the whole queue.' : emptyCopy[tab].body}
            </Empty>
          }
        />
      </Card>

      {openId ? <CaseView id={openId} onClose={close} /> : null}
      {creating ? (
        <NewCase
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      ) : null}
    </>
  );
}

/* ---------------- Case view ---------------- */

type Dialog = null | 'assign' | 'priority' | 'escalate' | 'resolve' | 'reopen' | 'close' | 'refund' | 'waiting' | 'in_progress';

function CaseView({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { staff, can } = useSession();
  const act = useAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const c = d.cases.find((x) => x.id === id && x.team === 'care');
  if (!c) {
    return (
      <WideDrawer title="Case not found" onClose={onClose}>
        <Empty icon="headphone" title="This case isn’t available">It may have been removed from the test data. Close this panel and pick another case.</Empty>
      </WideDrawer>
    );
  }
  const t = now();
  const me = staff?.id;
  const canWork = can('cases.work');
  const actions = allowedCaseActions(c, { canWork, canAssign: can('cases.assign'), meId: me });
  const has = (a: (typeof actions)[number]) => actions.includes(a);
  const owner = c.ownerId ? d.staff.find((s) => s.id === c.ownerId) : undefined;
  const trip = c.links.tripId ? d.trips.find((x) => x.id === c.links.tripId) : undefined;
  const passenger = c.links.passengerId ? d.passengers.find((x) => x.id === c.links.passengerId) : undefined;
  const driver = c.links.driverId ? d.drivers.find((x) => x.id === c.links.driverId) : undefined;
  const safetyLinks = d.cases.filter((x) => x.team === 'safety' && x.actions.some((a) => a.label === `Created from care case ${c.ref}`));

  const run = async (spec: Parameters<typeof act>[0], ok: string) => {
    const r = await act(spec, ok);
    if (r.ok) setDialog(null);
    return r.ok;
  };

  const header = (
    <div className="card compact stack">
      <div className="row wrap">
        <PriorityPill p={c.priority} />
        <StatusPill s={c.status} />
        <Pill tone="neutral" icon="list">{label(c.category)}</Pill>
        <Pill tone={owner ? 'neutral' : 'warning'} icon="user">
          {owner ? `Owner: ${owner.id === me ? 'you' : owner.name}` : 'Unassigned'}
        </Pill>
        {overResponseTarget(c, t) ? (
          <Pill tone="danger" icon="time">
            Over response target
          </Pill>
        ) : null}
      </div>
      <KV
        items={[
          ['Opened', `${when(c.openedAt, t)} by ${actorName(c.openedBy)}`],
          ['Open for', isOpen(c.status) ? formatAge(t - c.openedAt) : 'Closed out'],
          ['Response target', `${CARE_RESPONSE_TARGET_MIN[c.priority] >= 60 ? `${CARE_RESPONSE_TARGET_MIN[c.priority] / 60} h` : `${CARE_RESPONSE_TARGET_MIN[c.priority]} min`} for ${label(c.priority).toLowerCase()} priority (placeholder)`],
        ]}
      />
    </div>
  );

  const footer = canWork ? (
        <div className="row wrap" style={{ gap: 8, width: '100%' }}>
          {has('assign_me') ? (
            <Button
              size="sm"
              variant="primary"
              icon="userAdd"
              onClick={() =>
                run(
                  { label: 'Assign case', apply: (dr, x) => applyAssign(dr, c.id, me!, x.actor, x.now), audit: () => ({ action: 'case.assigned', target: caseTarget(c), summary: `Assigned ${c.ref} to ${staff!.name}` }) },
                  'Case assigned to you',
                )
              }
            >
              Assign to me
            </Button>
          ) : null}
          {has('assign') ? (
            <Button size="sm" icon="group" onClick={() => setDialog('assign')}>
              Assign
            </Button>
          ) : null}
          {has('priority') ? (
            <Button size="sm" icon="flag" onClick={() => setDialog('priority')}>
              Priority
            </Button>
          ) : null}
          {has('in_progress') ? (
            <Button size="sm" icon="refresh" onClick={() => setDialog('in_progress')}>
              {c.status === 'escalated' ? 'Back to in progress' : 'Mark in progress'}
            </Button>
          ) : null}
          {has('waiting') ? (
            <Button size="sm" icon="time" onClick={() => setDialog('waiting')}>
              Waiting on customer
            </Button>
          ) : null}
          {has('escalate') ? (
            <Button size="sm" icon="arrowRight" onClick={() => setDialog('escalate')}>
              Escalate
            </Button>
          ) : null}
          {has('resolve') ? (
            <Button size="sm" icon="checkCircle" onClick={() => setDialog('resolve')}>
              Resolve
            </Button>
          ) : null}
          {has('reopen') ? (
            <Button size="sm" icon="refresh" onClick={() => setDialog('reopen')}>
              Reopen
            </Button>
          ) : null}
          {has('close') ? (
            <Button size="sm" icon="lock" onClick={() => setDialog('close')}>
              Close
            </Button>
          ) : null}
        </div>
  ) : (
    <span className="muted small row" style={{ gap: 6, marginRight: 'auto' }}>
      <Icon name="eye" size={14} /> Read only for your role
    </span>
  );

  return (
    <WideDrawer
      title={`${c.ref} · ${c.subject}`}
      sub={`${label(c.category)} · ${city(c.city)} · opened ${when(c.openedAt, t)} by ${actorName(c.openedBy)}`}
      onClose={onClose}
      footer={footer}
    >
      {header}

      {c.resolution ? (
        <Notice tone="success" icon="checkCircle">
          <div className="strong">Resolution</div>
          <div>{c.resolution.summary}</div>
          <div className="small">
            {when(c.resolution.at, t)}
            {c.resolution.followUpAt ? ` · follow up ${new Date(c.resolution.followUpAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })}` : ''}
          </div>
        </Notice>
      ) : null}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Linked records">
          <KV
            items={[
              ['Trip', trip ? <RecordLink type="trip" id={trip.id}>{trip.ref}</RecordLink> : <span className="muted">No trip linked</span>],
              ['Route', trip ? `${trip.pickup} to ${trip.destination}` : <span className="muted">Not available</span>],
              ['Passenger', passenger ? <RecordLink type="passenger" id={passenger.id}>{passenger.name}</RecordLink> : <span className="muted">None</span>],
              ['Driver', driver ? <RecordLink type="driver" id={driver.id}>{driver.name}</RecordLink> : <span className="muted">None</span>],
              ...(safetyLinks.length
                ? ([
                    [
                      'Safety case',
                      <span className="row wrap" style={{ gap: 6 }}>
                        {safetyLinks.map((s) => (
                          <Pill key={s.id} tone="danger" icon="safeAlert">
                            {s.ref}
                          </Pill>
                        ))}
                        {!can('safety.view') ? <span className="muted small">Safety team only</span> : null}
                      </span>,
                    ],
                  ] as [string, ReactNode][])
                : []),
            ]}
          />
        </Card>
        <PaymentBlock c={c} onRequestRefund={() => setDialog('refund')} />
      </div>

      {c.category === 'lost_item' ? <LostItemChecklist c={c} /> : null}

      <MessageStreams
        c={c}
        canWrite={canWork && isOpen(c.status)}
        writeReason={!canWork ? 'Read only for your role' : !isOpen(c.status) ? 'Reopen the case to add messages' : undefined}
        onSend={async (channel, body) => {
          const r = await act(
            {
              label: channel === 'customer' ? 'Reply to customer' : 'Add internal note',
              apply: (dr, x) => applyMessage(dr, c.id, channel, body, x.actor, x.now),
              audit: () => ({ action: channel === 'customer' ? 'case.replied' : 'case.note_added', target: caseTarget(c), summary: channel === 'customer' ? `Replied to customer on ${c.ref}` : `Added internal note on ${c.ref}` }),
            },
            channel === 'customer' ? 'Reply added to the conversation' : 'Internal note added',
          );
          return r.ok;
        }}
      />

      <Block title="Actions taken and escalation history" icon="history">
        <ActionTimeline c={c} />
      </Block>

      {dialog === 'assign' ? <AssignDialog c={c} onCancel={() => setDialog(null)} run={run} /> : null}
      {dialog === 'priority' ? <PriorityDialog c={c} onCancel={() => setDialog(null)} run={run} /> : null}
      {dialog === 'escalate' ? <EscalateDialog c={c} onCancel={() => setDialog(null)} run={run} /> : null}
      {dialog === 'resolve' ? <ResolveDialog c={c} onCancel={() => setDialog(null)} run={run} /> : null}
      {dialog === 'refund' && trip ? <RefundDialog c={c} onCancel={() => setDialog(null)} run={run} /> : null}
      {dialog === 'waiting' || dialog === 'in_progress' ? (
        <ConfirmDialog
          title={dialog === 'waiting' ? 'Mark as waiting on customer' : 'Mark as in progress'}
          body={dialog === 'waiting' ? 'Use this when you need something from the customer before you can continue.' : 'The case moves back into active work.'}
          confirmLabel="Update status"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const to = dialog;
            return run(
              { label: 'Change status', apply: (dr, x) => applyStatus(dr, c.id, to, x.actor, x.now, to === 'waiting' ? 'Waiting on customer' : 'Status set to in progress'), audit: () => ({ action: 'case.status_changed', target: caseTarget(c), summary: `${c.ref} set to ${label(to)}`, diff: [{ field: 'status', from: c.status, to }] }) },
              `Status set to ${label(to).toLowerCase()}`,
            );
          }}
        />
      ) : null}
      {dialog === 'reopen' ? (
        <ConfirmDialog
          title={`Reopen ${c.ref}`}
          body="The case returns to in progress. The earlier resolution stays in the history."
          confirmLabel="Reopen case"
          requireReason
          onCancel={() => setDialog(null)}
          onConfirm={(reason) =>
            run({ label: 'Reopen case', apply: (dr, x) => applyReopen(dr, c.id, reason, x.actor, x.now), audit: () => ({ action: 'case.reopened', target: caseTarget(c), summary: `Reopened ${c.ref}`, reason }) }, 'Case reopened')
          }
        />
      ) : null}
      {dialog === 'close' ? (
        <ConfirmDialog
          title={`Close ${c.ref}`}
          body="Closed cases can’t be reopened. Close once any follow up is done."
          confirmLabel="Close case"
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            run({ label: 'Close case', apply: (dr, x) => applyStatus(dr, c.id, 'closed', x.actor, x.now, 'Closed'), audit: () => ({ action: 'case.closed', target: caseTarget(c), summary: `Closed ${c.ref}`, diff: [{ field: 'status', from: c.status, to: 'closed' }] }) }, 'Case closed')
          }
        />
      ) : null}
    </WideDrawer>
  );
}

type Run = (spec: Parameters<ReturnType<typeof useAction>>[0], ok: string) => Promise<boolean>;

function PaymentBlock({ c, onRequestRefund }: { c: CaseRecord; onRequestRefund: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const trip = c.links.tripId ? d.trips.find((x) => x.id === c.links.tripId) : undefined;
  const canMoney = can('finance.view') || can('ledger.view');
  const caseRefunds = d.refunds.filter((r) => r.caseId === c.id);
  const tripRefunds: RefundRecord[] = trip ? d.refunds.filter((r) => r.tripId === trip.id) : caseRefunds;
  const refundIds = new Set(tripRefunds.map((r) => r.id));
  const entries = trip ? d.ledger.filter((e) => e.links?.tripId === trip.id || (e.links?.refundId && refundIds.has(e.links.refundId))).sort((a, b) => a.at - b.at) : [];
  const block = refundBlockReason(c, trip, d.refunds, can('refunds.request'));
  const showRefundButton = can('cases.work') || can('refunds.request');
  const t = now();

  return (
    <Card title="Payment">
      {!trip ? (
        <div className="muted small">No trip linked, so there is no payment to show.</div>
      ) : (
        <div className="stack">
          <div className="row wrap">
            <Pill tone={PAYMENT_STATE[trip.payment].tone}>Payment: {PAYMENT_STATE[trip.payment].text}</Pill>
            {trip.directToDriver ? <Pill tone="info">Paid directly to driver</Pill> : null}
          </div>
          <KV
            items={[
              ['Method', trip.paymentMethod === 'wallet' ? 'GoBye Wallet' : 'Bank transfer'],
              ['Agreed fare', canMoney ? (trip.agreedFare ? money(trip.agreedFare) : 'Not agreed') : <Locked />],
              ...(canMoney && trip.agreedFare ? ([['Still refundable', money(refundableKobo(trip, d.refunds))]] as [string, ReactNode][]) : []),
            ]}
          />
        </div>
      )}

      {tripRefunds.length ? (
        <div className="stack tight" style={{ marginTop: 14 }}>
          <div className="strong small">Refunds</div>
          {tripRefunds.map((r) => (
            <div key={r.id} className="row small wrap" style={{ gap: 8 }}>
              <span style={{ flex: 1, minWidth: 140 }}>
                {canMoney ? <span className="strong num">{money(r.amount)}</span> : 'Refund'} to {r.destination === 'wallet' ? 'wallet' : 'original method'}
                <span className="muted"> · {when(r.requestedAt, t)}</span>
              </span>
              <Pill tone={REFUND_PILL[r.status].tone}>{REFUND_PILL[r.status].text}</Pill>
            </div>
          ))}
        </div>
      ) : null}

      {trip && canMoney ? (
        <div className="stack tight" style={{ marginTop: 14 }}>
          <div className="strong small">Ledger entries for this trip</div>
          {entries.length ? (
            entries.map((e) => (
              <div key={e.id} className="row small">
                <span style={{ flex: 1 }}>
                  {e.description} <span className="muted">· {label(e.account.kind)}</span>
                </span>
                <span className="num strong">{money(e.amount)}</span>
              </div>
            ))
          ) : (
            <span className="muted small">No ledger entries for this trip in the test data.</span>
          )}
        </div>
      ) : trip ? (
        <div className="muted small row" style={{ gap: 6, marginTop: 14 }}>
          <Icon name="lock" size={14} /> Ledger entries need finance or ledger access.
        </div>
      ) : null}

      {showRefundButton ? (
        <div className="stack" style={{ marginTop: 14 }}>
          <div>
            <Button size="sm" icon="refresh" onClick={onRequestRefund} disabledReason={block}>
              Request refund
            </Button>
          </div>
          {block ? <span className="muted small">{block}.</span> : <span className="muted small">Finance approves refunds and posts them to the ledger. Care can’t complete a refund or change a balance.</span>}
        </div>
      ) : null}
    </Card>
  );
}

function Locked() {
  return (
    <span className="muted row" style={{ gap: 4 }}>
      <Icon name="lock" size={14} /> Hidden for your role
    </span>
  );
}

function LostItemChecklist({ c }: { c: CaseRecord }) {
  const { can } = useSession();
  const act = useAction();
  const done = lostItemDone(c.actions);
  const editable = can('cases.work') && isOpen(c.status);
  const n = Object.values(done).filter(Boolean).length;
  return (
    <Card title={`Lost item checklist (${n} of ${LOST_ITEM_STEPS.length})`}>
      <div className="stack">
        {LOST_ITEM_STEPS.map((s, i) => {
          const ok = done[s.key];
          const at = c.actions.find((a) => a.label === s.label);
          const text = ['Contact the driver', 'Arrange the return', 'Confirm with the passenger'][i];
          return (
            <div key={s.key} className="row wrap">
              <Icon name={ok ? 'checkCircle' : 'time'} size={18} style={{ color: ok ? 'var(--success)' : 'var(--text-2)' }} />
              <span style={{ flex: 1 }} className={ok ? undefined : 'muted'}>
                {text}
                {ok && at ? <span className="muted small"> · {actorName(at.by)}</span> : null}
              </span>
              {ok ? (
                <Pill tone="success">Done</Pill>
              ) : editable ? (
                <Button
                  size="sm"
                  icon="check"
                  onClick={() =>
                    act(
                      { label: text, apply: (dr, x) => applyLostItemStep(dr, c.id, s.key, x.actor, x.now), audit: () => ({ action: 'case.lost_item_step', target: caseTarget(c), summary: `${c.ref}: ${s.label}` }) },
                      'Checklist step recorded',
                    )
                  }
                >
                  Mark done
                </Button>
              ) : (
                <Pill tone="neutral">Not done</Pill>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------- Dialogs ---------------- */

function AssignDialog({ c, onCancel, run }: { c: CaseRecord; onCancel: () => void; run: Run }) {
  const d = useData();
  const agents = d.staff.filter((s) => s.status === 'active' && s.roles.includes('care'));
  const [to, setTo] = useState(agents.find((a) => a.id !== c.ownerId)?.id ?? '');
  const name = agents.find((a) => a.id === to)?.name ?? '';
  return (
    <FormDialog
      title={`Assign ${c.ref}`}
      body="Choose a customer care agent."
      confirmLabel="Assign"
      blockReason={!to ? 'No other active care agent' : to === c.ownerId ? 'Already the owner' : undefined}
      onCancel={onCancel}
      onConfirm={() => run({ label: 'Assign case', apply: (dr, x) => applyAssign(dr, c.id, to, x.actor, x.now), audit: () => ({ action: 'case.assigned', target: caseTarget(c), summary: `Assigned ${c.ref} to ${name}` }) }, `Assigned to ${name}`)}
    >
      {agents.length ? (
        <Field label="Care agent">{(id) => <select id={id} className="select" value={to} onChange={(e) => setTo(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === c.ownerId ? ' (current owner)' : ''}</option>)}</select>}</Field>
      ) : (
        <Notice tone="warning">No active staff hold the customer care role.</Notice>
      )}
    </FormDialog>
  );
}

function PriorityDialog({ c, onCancel, run }: { c: CaseRecord; onCancel: () => void; run: Run }) {
  const [p, setP] = useState<CasePriority>(c.priority);
  return (
    <FormDialog
      title={`Change priority of ${c.ref}`}
      confirmLabel="Save priority"
      blockReason={p === c.priority ? 'Choose a different priority' : undefined}
      onCancel={onCancel}
      onConfirm={() => run({ label: 'Change priority', apply: (dr, x) => applyPriority(dr, c.id, p, x.actor, x.now), audit: () => ({ action: 'case.priority_changed', target: caseTarget(c), summary: `${c.ref} priority set to ${p}`, diff: [{ field: 'priority', from: c.priority, to: p }] }) }, 'Priority updated')}
    >
      <Segmented label="Priority" value={p} onChange={setP} options={PRIORITIES.map((x) => ({ value: x, label: label(x) }))} />
    </FormDialog>
  );
}

function EscalateDialog({ c, onCancel, run }: { c: CaseRecord; onCancel: () => void; run: Run }) {
  const [team, setTeam] = useState<EscalationTeam>(c.category === 'payment' || c.category === 'fare' ? 'finance' : 'operations');
  const [reason, setReason] = useState('');
  return (
    <FormDialog
      title={`Escalate ${c.ref}`}
      body="The case stays with you and is marked escalated. The reason is saved to the case and the audit trail."
      confirmLabel={`Escalate to ${TEAM_LABEL[team]}`}
      danger={team === 'safety'}
      blockReason={!reason.trim() ? 'Add a reason first' : undefined}
      onCancel={onCancel}
      onConfirm={() =>
        run(
          { label: 'Escalate case', apply: (dr, x) => applyEscalate(dr, c.id, team, reason, x.actor, x.now), audit: () => ({ action: 'case.escalated', target: caseTarget(c), summary: `Escalated ${c.ref} to ${TEAM_LABEL[team]}`, reason: reason.trim() }) },
          team === 'safety' ? 'Escalated. A linked safety case was opened' : `Escalated to ${TEAM_LABEL[team]}`,
        )
      }
    >
      <Segmented
        label="Team"
        value={team}
        onChange={setTeam}
        options={(['finance', 'safety', 'operations'] as EscalationTeam[]).map((x) => ({ value: x, label: TEAM_LABEL[x] }))}
      />
      {team === 'safety' ? <Notice tone="warning">This opens a linked urgent case in the Safety queue with the same trip, passenger and driver.</Notice> : null}
      <Field label="Reason">{(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
    </FormDialog>
  );
}

function ResolveDialog({ c, onCancel, run }: { c: CaseRecord; onCancel: () => void; run: Run }) {
  const { now } = usePlatform();
  const [summary, setSummary] = useState('');
  const [follow, setFollow] = useState('');
  const tomorrow = new Date(now() + 86_400_000).toISOString().slice(0, 10);
  const followAt = follow ? new Date(`${follow}T09:00:00`).getTime() : undefined;
  const followErr = followAt !== undefined && (Number.isNaN(followAt) || followAt <= now()) ? 'Choose a date after today' : undefined;
  return (
    <FormDialog
      title={`Resolve ${c.ref}`}
      body="Summarise what was done. The customer conversation is not closed automatically."
      confirmLabel="Resolve case"
      blockReason={!summary.trim() ? 'Add a resolution summary' : followErr}
      onCancel={onCancel}
      onConfirm={() =>
        run(
          { label: 'Resolve case', apply: (dr, x) => applyResolve(dr, c.id, summary, followAt, x.actor, x.now), audit: () => ({ action: 'case.resolved', target: caseTarget(c), summary: `Resolved ${c.ref}: ${summary.trim()}`, diff: [{ field: 'status', from: c.status, to: 'resolved' }] }) },
          'Case resolved',
        )
      }
    >
      <Field label="Resolution summary">{(id) => <textarea id={id} className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />}</Field>
      <Field label="Follow up date (optional)" hint="A reminder for the owner to check in with the customer." error={followErr}>
        {(id) => <input id={id} type="date" className="input" min={tomorrow} value={follow} onChange={(e) => setFollow(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function RefundDialog({ c, onCancel, run }: { c: CaseRecord; onCancel: () => void; run: Run }) {
  const d = useData();
  const trip = d.trips.find((x) => x.id === c.links.tripId)!;
  const max = refundableKobo(trip, d.refunds);
  const [amountText, setAmount] = useState('');
  const [destination, setDestination] = useState<RefundRecord['destination']>('wallet');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const v = validateRefund({ amountText, reason }, trip, d.refunds);
  const amountErr = touched && !v.ok && v.field === 'amount' ? v.error : undefined;
  return (
    <FormDialog
      title="Request a refund"
      body={`Trip ${trip.ref}. Agreed fare ${trip.agreedFare ? money(trip.agreedFare) : 'not set'}; up to ${money(max)} can still be refunded.`}
      confirmLabel="Send for approval"
      blockReason={!v.ok ? v.error : undefined}
      onCancel={onCancel}
      onConfirm={() =>
        run(
          {
            label: 'Request refund',
            apply: (dr, x) => applyRefundRequest(dr, c.id, { amountText, reason, destination }, x.actor, x.now),
            audit: () => ({ action: 'refund.requested', target: caseTarget(c), summary: `Requested ${v.ok ? money(v.amount) : ''} refund to ${destination === 'wallet' ? 'wallet' : 'original method'} on ${c.ref}`, reason: reason.trim() }),
          },
          'Refund requested. Finance will review it',
        )
      }
    >
      <Field label="Amount in naira" hint={`Whole naira or with kobo, up to ${money(max)}.`} error={amountErr}>
        {(id) => <input id={id} className="input" inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} onBlur={() => setTouched(true)} placeholder="1500" autoFocus />}
      </Field>
      <div className="field">
        <span className="small strong">Refund to</span>
        <Segmented
          label="Refund destination"
          value={destination}
          onChange={setDestination}
          options={[
            { value: 'wallet', label: 'GoBye Wallet' },
            { value: 'original_method', label: 'Original method' },
          ]}
        />
      </div>
      <Field label="Reason for finance">{(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <Notice icon="lock">This creates a refund request and an approval for Finance. No money moves and no balance changes until Finance approves and processes it.</Notice>
    </FormDialog>
  );
}

/* ---------------- New case ---------------- */

function NewCase({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const d = useData();
  const { now } = usePlatform();
  const act = useAction();
  const [q, setQ] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const [category, setCategory] = useState<NewCaseInput['category']>('payment');
  const [priority, setPriority] = useState<CasePriority>('normal');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [tripId, setTripId] = useState('');
  const [tried, setTried] = useState(false);
  const results = useMemo(() => searchPeople(d.passengers, d.drivers, q), [d.passengers, d.drivers, q]);
  const trips = useMemo(
    () => (person ? d.trips.filter((t) => (person.type === 'passenger' ? t.passengerId : t.driverId) === person.rec.id).sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 12) : []),
    [d.trips, person],
  );
  const input: Partial<NewCaseInput> = { person: person ? { type: person.type, id: person.rec.id } : undefined, category, priority, subject, firstMessage: message, tripId: tripId || undefined };
  const errs = validateNewCase(input);
  const show = (k: keyof typeof errs) => (tried ? errs[k] : undefined);
  const t = now();

  const submit = async () => {
    setTried(true);
    if (Object.keys(errs).length) return;
    let created: string | undefined;
    let ref = '';
    const r = await act(
      {
        label: 'Open case',
        apply: (dr, x) => {
          const res = applyNewCase(dr, input as NewCaseInput, x.actor, x.now);
          created = res.caseId;
          ref = res.ref ?? '';
          return res;
        },
        audit: () => ({ action: 'case.created', target: { type: 'case', id: created ?? '', label: ref }, summary: `Opened ${ref} for ${person!.rec.name}: ${subject.trim()}` }),
      },
      'Case opened',
    );
    if (r.ok && created) onCreated(created);
  };

  return (
    <WideDrawer
      title="New case"
      sub="For a passenger or driver who contacted support"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="add" onClick={submit} disabledReason={tried && Object.keys(errs).length ? 'Fix the highlighted fields' : undefined}>
            Open case
          </Button>
        </>
      }
    >
      <div className="stack">
        <h3 className="strong" style={{ fontSize: 14 }}>Who is this for</h3>
        {person ? (
          <div className="row wrap">
            <Pill tone="neutral" icon={person.type === 'driver' ? 'steering' : 'user'}>
              {label(person.type)}
            </Pill>
            <span className="strong">{person.rec.name}</span>
            <span className="muted small">{city(person.rec.city)}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPerson(null);
                setTripId('');
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search passengers and drivers by name" />
            {q.trim().length >= 2 ? (
              results.length ? (
                <div className="card flush">
                  {results.map((p) => (
                    <button key={`${p.type}-${p.rec.id}`} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', height: 'auto', padding: '10px 14px', borderRadius: 0 }} onClick={() => setPerson(p)}>
                      <Icon name={p.type === 'driver' ? 'steering' : 'user'} size={16} />
                      <span style={{ flex: 1, textAlign: 'left' }}>{p.rec.name}</span>
                      <span className="muted small">
                        {label(p.type)} · {city(p.rec.city)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="muted small">No passengers or drivers match “{q.trim()}”.</span>
              )
            ) : (
              <span className="muted small">Type at least two letters.</span>
            )}
            {show('person') ? <span className="small" style={{ color: 'var(--danger)' }} role="alert">{show('person')}</span> : null}
          </>
        )}
      </div>

      <div className="grid cols-2">
        <Field label="Category">
          {(id) => (
            <select id={id} className="select" value={category} onChange={(e) => setCategory(e.target.value as NewCaseInput['category'])}>
              {CARE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Priority">
          {(id) => (
            <select id={id} className="select" value={priority} onChange={(e) => setPriority(e.target.value as CasePriority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Trip (optional)" hint={person ? (trips.length ? 'Links the trip, the other party and the payment to the case.' : 'No trips for this person.') : 'Choose a person first.'}>
        {(id) => (
          <select id={id} className="select" value={tripId} onChange={(e) => setTripId(e.target.value)} disabled={!person || !trips.length}>
            <option value="">No trip</option>
            {trips.map((x) => (
              <option key={x.id} value={x.id}>
                {x.ref} · {x.pickup} to {x.destination} · {when(x.requestedAt, t)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Subject" error={show('subject')}>
        {(id) => <input id={id} className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Charged twice for one trip" maxLength={120} />}
      </Field>
      <Field label="What the customer reported" hint="Saved as the first message in the customer conversation." error={show('firstMessage')}>
        {(id) => <textarea id={id} className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      {category === 'lost_item' ? <Notice>Lost item cases include a checklist: contact the driver, arrange the return, confirm with the passenger.</Notice> : null}
    </WideDrawer>
  );
}
