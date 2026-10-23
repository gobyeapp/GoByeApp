import { useMemo, useState, type ReactNode } from 'react';
import {
  ANNOUNCEMENT_FLOW,
  APPROVAL_RULES,
  canDecide,
  canTransition,
  type Announcement,
  type AnnouncementStatus,
  type ApprovalRequest,
  type AudienceFilter,
  type Channel,
  type CityId,
  type PlatformDataset,
} from '@gobye/core';
import { count, label as fmtLabel, pct, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import type { IconName } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, KV, Meter, Notice, PageHead, Pill, Section, Segmented, SearchInput, FilterBar, Stat, Table, Tabs, Timeline, type Column, type Tone } from '@/ui/kit';
import { Check, Steps, TextField } from '@/workspaces/config/fields';
import { fromLocalInput, toLocalInput } from '@/workspaces/config/logic';
import {
  ALL_CITIES,
  BODY_MAX,
  CHANNELS,
  CHANNEL_LABEL,
  DRIVER_STATUSES,
  PASSENGER_STATUSES,
  TITLE_MAX,
  announcementNeedsApproval,
  channelState,
  copyIssues,
  countAudience,
  deliveryOutcome,
  describeAudience,
  editedSinceSent,
  retryQueue,
  simulateDelivery,
  simulateRetry,
  smsSegments,
  validateAnnouncement,
  type RetryItem,
} from './logic';

const STATUS: Record<AnnouncementStatus, { tone: Tone; text: string; icon: IconName }> = {
  draft: { tone: 'neutral', text: 'Draft', icon: 'edit' },
  pending_approval: { tone: 'warning', text: 'Pending approval', icon: 'time' },
  scheduled: { tone: 'info', text: 'Scheduled', icon: 'calendar' },
  sending: { tone: 'info', text: 'Sending', icon: 'time' },
  sent: { tone: 'success', text: 'Sent', icon: 'checkCircle' },
  partly_failed: { tone: 'danger', text: 'Partly failed', icon: 'alert' },
  cancelled: { tone: 'neutral', text: 'Cancelled', icon: 'close' },
};

const approvalOf = (d: PlatformDataset, id: string): ApprovalRequest | undefined =>
  d.approvals.filter((a) => a.kind === 'announcement' && a.target.id === id).sort((a, b) => b.requestedAt - a.requestedAt)[0];

function StatusPill({ a, approval }: { a: Announcement; approval?: ApprovalRequest }) {
  if (a.status === 'pending_approval' && approval?.status === 'approved')
    return (
      <Pill tone="info" icon="check">
        Approved, ready to send
      </Pill>
    );
  if (a.status === 'pending_approval' && approval?.status === 'rejected')
    return (
      <Pill tone="danger" icon="close">
        Rejected, edit to try again
      </Pill>
    );
  const s = STATUS[a.status];
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {s.text}
    </Pill>
  );
}

type Draft = { id?: string; title: string; body: string; audience: AudienceFilter; channels: Channel[]; schedule: string };
const EMPTY: Draft = { title: '', body: '', audience: { type: 'passenger', cities: ['lagos', 'abuja'] }, channels: ['inbox'], schedule: '' };
const zero = () => ({ attempted: 0, delivered: 0, failed: 0 });

type Tab = 'all' | 'drafts' | 'waiting' | 'sent' | 'retry';

export default function Announcements() {
  const d = useData();
  const { now } = usePlatform();
  const { can, staff } = useSession();
  const act = useAction();
  const t = now();

  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [composer, setComposer] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'cancel' | 'reject' | 'edit_back'; a: Announcement }>(null);
  const [error, setError] = useState<string | null>(null);

  const canDraft = can('comms.draft') || can('comms.publish');
  const canPublish = can('comms.publish');
  const eventName = (id?: string) => d.events.find((e) => e.id === id)?.name;

  const list = useMemo(() => [...d.announcements].sort((a, b) => (b.sentVersion?.at ?? b.scheduledFor ?? 0) - (a.sentVersion?.at ?? a.scheduledFor ?? 0) || b.id.localeCompare(a.id)), [d.announcements]);
  const queue = retryQueue(d.announcements);
  const groups: Record<Tab, Announcement[]> = {
    all: list,
    drafts: list.filter((a) => a.status === 'draft'),
    waiting: list.filter((a) => a.status === 'pending_approval' || a.status === 'scheduled'),
    sent: list.filter((a) => a.status === 'sent' || a.status === 'partly_failed' || a.status === 'sending'),
    retry: [],
  };

  const sentList = groups.sent;
  const delivered = sentList.reduce((s, a) => s + CHANNELS.reduce((n, c) => n + a.delivery[c].delivered, 0), 0);
  const attempted = sentList.reduce((s, a) => s + CHANNELS.reduce((n, c) => n + a.delivery[c].attempted, 0), 0);

  /* ---------- Actions ---------- */
  const audit = (a: { id: string; title: string }, action: string, summary: string, reason?: string) => () => ({ action, target: { type: 'announcement' as const, id: a.id, label: a.title }, summary, reason });

  const saveDraft = async () => {
    if (!composer) return;
    const c = composer;
    const size = countAudience(d, c.audience, t).total;
    let id = c.id ?? '';
    let backToDraft = false;
    const r = await act(
      {
        label: c.id ? 'Save announcement' : 'Create announcement',
        apply: (draft, ctx) => {
          const errs = validateAnnouncement(c);
          if (errs.length) return { ok: false, error: errs[0]! };
          const scheduledFor = c.schedule ? fromLocalInput(c.schedule) : undefined;
          if (scheduledFor !== undefined && !(scheduledFor > ctx.now)) return { ok: false, error: 'Schedule time must be in the future.' };
          if (!c.id) {
            id = `ann-${ctx.now.toString(36)}`;
            draft.announcements.unshift({ id, title: c.title.trim(), body: c.body.trim(), audience: c.audience, channels: c.channels, status: 'draft', scheduledFor, createdBy: ctx.actor, audienceSize: size, delivery: { inbox: zero(), push: zero(), email: zero(), sms: zero() } });
            return { ok: true };
          }
          const a = draft.announcements.find((x) => x.id === c.id);
          if (!a) return { ok: false, error: 'Announcement not found.' };
          if (a.status === 'sending' || a.status === 'cancelled') return { ok: false, error: `Can’t edit while ${STATUS[a.status].text.toLowerCase()}.` };
          a.title = c.title.trim();
          a.body = c.body.trim();
          if (a.status === 'sent' || a.status === 'partly_failed') return { ok: true }; // copy only; sentVersion untouched
          a.audience = c.audience;
          a.channels = c.channels;
          a.scheduledFor = scheduledFor;
          a.audienceSize = size;
          if (a.status === 'pending_approval' || a.status === 'scheduled') {
            // A changed message needs a fresh decision.
            if (!canTransition(ANNOUNCEMENT_FLOW, a.status, 'draft')) return { ok: false, error: 'Can’t move back to draft.' };
            a.status = 'draft';
            a.approvedBy = undefined;
            backToDraft = true;
            const req = approvalOf(draft, a.id);
            if (req?.status === 'pending') Object.assign(req, { status: 'rejected', decidedAt: ctx.now, decidedBy: ctx.actor, note: 'Withdrawn: edited after the request' });
          }
          return { ok: true };
        },
        audit: () => ({ action: c.id ? 'announcement.edited' : 'announcement.created', target: { type: 'announcement', id, label: c.title.trim() }, summary: c.id ? `Edited “${c.title.trim()}”${backToDraft ? ', back to draft for a new decision' : ''}` : `Created draft “${c.title.trim()}” for ${count(size)} people` }),
      },
      c.id ? 'Saved' : 'Draft saved',
    );
    if (r.ok) {
      setComposer(null);
      setOpenId(id);
      setError(null);
    } else setError(r.error);
  };

  const requestApproval = (a: Announcement) => {
    const size = countAudience(d, a.audience, t).total;
    return act(
      {
        label: 'Request approval',
        apply: (draft, ctx) => {
          const x = draft.announcements.find((y) => y.id === a.id);
          if (!x || !canTransition(ANNOUNCEMENT_FLOW, x.status, 'pending_approval')) return { ok: false, error: 'Can’t request approval from this state.' };
          x.status = 'pending_approval';
          x.audienceSize = size;
          draft.approvals.unshift({
            id: `apr-${ctx.now.toString(36)}`,
            kind: 'announcement',
            title: `Send “${x.title}” to ${count(size)} ${x.audience.type === 'passenger' ? 'passengers' : 'drivers'}`,
            requestedBy: ctx.actor,
            requestedAt: ctx.now,
            target: { type: 'announcement', id: x.id, label: x.title },
            status: 'pending',
            approverRoles: [...APPROVAL_RULES.announcement.approverRoles],
          });
          return { ok: true };
        },
        audit: audit(a, 'announcement.approval_requested', `Asked for approval to send “${a.title}” to ${count(size)} people`),
      },
      'Approval requested',
    );
  };

  const decide = (a: Announcement, approve: boolean, reason = '') =>
    act(
      {
        label: approve ? 'Approve announcement' : 'Reject announcement',
        apply: (draft, ctx) => {
          const x = draft.announcements.find((y) => y.id === a.id);
          const req = approvalOf(draft, a.id);
          if (!x || !req || req.status !== 'pending' || x.status !== 'pending_approval') return { ok: false, error: 'This request was already decided.' };
          if (req.requestedBy.kind === 'staff' && ctx.actor.kind === 'staff' && req.requestedBy.id === ctx.actor.id) return { ok: false, error: 'You can’t approve your own request.' };
          Object.assign(req, { status: approve ? 'approved' : 'rejected', decidedBy: ctx.actor, decidedAt: ctx.now, note: reason || undefined });
          if (approve) {
            x.approvedBy = ctx.actor;
            if (x.scheduledFor && x.scheduledFor > ctx.now) x.status = 'scheduled';
          } else x.status = 'draft';
          return { ok: true };
        },
        audit: audit(a, approve ? 'announcement.approved' : 'announcement.rejected', approve ? `Approved “${a.title}”` : `Rejected “${a.title}”, back to draft`, reason),
      },
      approve ? 'Approved' : 'Rejected. Back to draft',
    );

  const schedule = (a: Announcement) =>
    act(
      {
        label: 'Schedule announcement',
        apply: (draft, ctx) => {
          const x = draft.announcements.find((y) => y.id === a.id);
          if (!x || !canTransition(ANNOUNCEMENT_FLOW, x.status, 'scheduled')) return { ok: false, error: 'Can’t schedule from this state.' };
          if (!x.scheduledFor || x.scheduledFor <= ctx.now) return { ok: false, error: 'Set a future time first.' };
          if (announcementNeedsApproval(x) && approvalOf(draft, x.id)?.status !== 'approved') return { ok: false, error: 'This announcement needs approval first.' };
          x.status = 'scheduled';
          return { ok: true };
        },
        audit: audit(a, 'announcement.scheduled', `Scheduled “${a.title}” for ${when(a.scheduledFor, t)}`),
      },
      'Scheduled',
    );

  /** Step 1: snapshot, inbox records and channel jobs. Step 2: provider results (simulated). */
  const publish = async (a: Announcement) => {
    const aud = countAudience(d, a.audience, t);
    const r1 = await act(
      {
        label: 'Publish announcement',
        apply: (draft, ctx) => {
          const x = draft.announcements.find((y) => y.id === a.id);
          if (!x || !canTransition(ANNOUNCEMENT_FLOW, x.status, 'sending')) return { ok: false, error: 'Can’t publish from this state.' };
          if (announcementNeedsApproval(x) && approvalOf(draft, x.id)?.status !== 'approved') return { ok: false, error: 'This announcement needs approval first.' };
          if (aud.total === 0) return { ok: false, error: 'Nobody matches this audience.' };
          x.status = 'sending';
          x.audienceSize = aud.total;
          x.sentVersion = { title: x.title, body: x.body, at: ctx.now };
          x.delivery = { inbox: zero(), push: zero(), email: zero(), sms: zero() };
          if (x.channels.includes('inbox')) x.delivery.inbox = simulateDelivery(aud.reach.inbox, 'inbox', channelState(draft.integrations, 'inbox'));
          return { ok: true };
        },
        audit: audit(
          a,
          'announcement.published',
          `Published “${a.title}” to ${count(aud.total)} people. ${a.channels.includes('inbox') ? `${count(aud.reach.inbox)} inbox messages created. ` : ''}Jobs queued: ${a.channels.filter((c) => c !== 'inbox').map((c) => CHANNEL_LABEL[c]).join(', ') || 'none'}`,
        ),
      },
      a.channels.includes('inbox') ? `Sending. ${count(aud.reach.inbox)} inbox messages created` : 'Sending',
    );
    if (r1.ok) await finishSending(a.id, a.title, a.channels);
  };

  const finishSending = (id: string, title: string, channels: Channel[]) => {
    const aud = (() => {
      const x = d.announcements.find((y) => y.id === id);
      return x ? countAudience(d, x.audience, t) : null;
    })();
    let outcome = '';
    return act(
      {
        label: 'Record delivery results',
        latency: 900,
        apply: (draft) => {
          const x = draft.announcements.find((y) => y.id === id);
          if (!x || x.status !== 'sending' || !aud) return { ok: false, error: 'Nothing is sending.' };
          for (const c of x.channels) if (c !== 'inbox') x.delivery[c] = simulateDelivery(aud.reach[c], c, channelState(draft.integrations, c));
          x.status = deliveryOutcome(x.delivery, x.channels);
          outcome = x.channels.map((c) => `${CHANNEL_LABEL[c]} ${x.delivery[c].delivered} of ${x.delivery[c].attempted}`).join(', ');
          return { ok: true };
        },
        audit: () => ({ action: 'announcement.delivery_results', target: { type: 'announcement', id, label: title }, summary: `Delivery results (simulated): ${outcome}` }),
      },
      channels.some((c) => c !== 'inbox' && !channelState(d.integrations, c).connected) ? 'Done. Some channels aren’t connected; see the retry queue' : 'Delivery results recorded',
    );
  };

  const retry = (item: RetryItem) => {
    let summary = '';
    return act(
      {
        label: `Retry ${CHANNEL_LABEL[item.channel]}`,
        apply: (draft) => {
          const x = draft.announcements.find((y) => y.id === item.announcement.id);
          if (!x || !canTransition(ANNOUNCEMENT_FLOW, x.status, 'sending')) return { ok: false, error: 'Can’t retry from this state.' };
          const st = channelState(draft.integrations, item.channel);
          const before = x.delivery[item.channel];
          x.delivery[item.channel] = simulateRetry(before, item.channel, st);
          x.status = deliveryOutcome(x.delivery, x.channels); // sending → sent / partly_failed in one step
          const still = x.delivery[item.channel].failed;
          summary = st.connected ? `Retried ${before.failed} ${CHANNEL_LABEL[item.channel]} messages; ${still} still failed` : `Retried ${before.failed} ${CHANNEL_LABEL[item.channel]} messages; all still failed because the provider isn’t connected`;
          return { ok: true };
        },
        audit: () => ({ action: 'announcement.retry', target: { type: 'announcement', id: item.announcement.id, label: item.announcement.title }, summary }),
      },
      channelState(d.integrations, item.channel).connected ? 'Retry done' : 'Retried. Still failing: provider not connected',
    );
  };

  const cancel = (a: Announcement, reason: string) =>
    act(
      {
        label: 'Cancel announcement',
        apply: (draft, ctx) => {
          const x = draft.announcements.find((y) => y.id === a.id);
          if (!x || !canTransition(ANNOUNCEMENT_FLOW, x.status, 'cancelled')) return { ok: false, error: 'Can’t cancel from this state.' };
          x.status = 'cancelled';
          const req = approvalOf(draft, a.id);
          if (req?.status === 'pending') Object.assign(req, { status: 'rejected', decidedAt: ctx.now, decidedBy: ctx.actor, note: 'Withdrawn: announcement cancelled' });
          return { ok: true };
        },
        audit: audit(a, 'announcement.cancelled', `Cancelled “${a.title}”`, reason),
      },
      'Cancelled',
    );

  const edit = (a: Announcement) => {
    setOpenId(null);
    setError(null);
    setComposer({ id: a.id, title: a.title, body: a.body, audience: structuredClone(a.audience), channels: [...a.channels], schedule: a.scheduledFor && a.scheduledFor > t ? toLocalInput(a.scheduledFor) : '' });
  };

  /* ---------- Table ---------- */
  const needle = q.trim().toLowerCase();
  const shownRows = tab === 'retry' ? [] : groups[tab].filter((a) => !needle || `${a.title} ${describeAudience(a.audience, eventName(a.audience.eventId))}`.toLowerCase().includes(needle));
  const cols: Column<Announcement>[] = [
    { key: 't', label: 'Announcement', sortValue: (a) => a.title, render: (a) => <div><div className="cell-title">{a.title}</div><div className="cell-sub">{describeAudience(a.audience, eventName(a.audience.eventId))}</div></div> },
    { key: 's', label: 'Status', render: (a) => <StatusPill a={a} approval={approvalOf(d, a.id)} /> },
    { key: 'c', label: 'Channels', render: (a) => <span className="small">{a.channels.map((c) => CHANNEL_LABEL[c]).join(', ')}</span> },
    { key: 'n', label: 'Audience', sortValue: (a) => a.audienceSize, render: (a) => <span className="num">{count(a.audienceSize)}</span>, align: 'right' },
    { key: 'b', label: 'Created by', render: (a) => <span className="small">{a.createdBy.name}</span> },
    { key: 'w', label: 'Sent or scheduled', render: (a) => <span className="small muted">{a.sentVersion ? `Sent ${when(a.sentVersion.at, t).toLowerCase()}` : a.scheduledFor ? `For ${when(a.scheduledFor, t).toLowerCase()}` : 'Not yet'}</span> },
  ];
  const retryCols: Column<RetryItem>[] = [
    { key: 't', label: 'Announcement', render: (r) => <div><div className="cell-title">{r.announcement.title}</div><div className="cell-sub">Sent {when(r.announcement.sentVersion?.at, t).toLowerCase()}</div></div> },
    { key: 'c', label: 'Channel', render: (r) => CHANNEL_LABEL[r.channel] },
    { key: 'f', label: 'Failed', sortValue: (r) => r.failed, render: (r) => <span className="num strong">{count(r.failed)}</span>, align: 'right' },
    { key: 'p', label: 'Provider', render: (r) => channelPill(r.channel) },
    {
      key: 'a',
      label: '',
      align: 'right',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          {canPublish ? <Button size="sm" icon="refresh" onClick={() => retry(r)}>Retry</Button> : <Button size="sm" disabledReason="Needs publish permission">Retry</Button>}
        </span>
      ),
    },
  ];

  function channelPill(ch: Channel) {
    const s = channelState(d.integrations, ch);
    if (s.connected) return <Pill tone={s.state === 'degraded' ? 'warning' : 'success'}>{s.state === 'internal' ? 'Built in' : `${fmtLabel(s.state)} (${s.provider})`}</Pill>;
    return (
      <Pill tone="warning" icon="plugin">
        Not connected: will queue, not send
      </Pill>
    );
  }

  const open = d.announcements.find((a) => a.id === openId);

  return (
    <>
      <PageHead
        eyebrow="Growth"
        title="Announcements"
        sub="Messages to passengers or drivers through the app inbox, push, email or SMS."
        actions={
          canDraft ? (
            <Button variant="primary" icon="add" onClick={() => (setError(null), setComposer({ ...EMPTY, audience: { ...EMPTY.audience, cities: [...ALL_CITIES] } }))}>
              New announcement
            </Button>
          ) : (
            <Button icon="add" disabledReason="Your role can view announcements only">New announcement</Button>
          )
        }
      />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="edit" label="Drafts" value={count(groups.drafts.length)} onClick={() => setTab('drafts')} />
        <Stat icon="time" label="Waiting" value={count(groups.waiting.length)} sub="Approval or schedule" onClick={() => setTab('waiting')} />
        <Stat icon="checkCircle" label="Delivered" value={attempted ? pct(delivered / attempted) : 'None yet'} sub={`${count(delivered)} of ${count(attempted)} attempts, all channels`} onClick={() => setTab('sent')} />
        <Stat icon="refresh" label="Retry queue" value={count(queue.reduce((s, q) => s + q.failed, 0))} sub="Failed email and SMS" tone={queue.length ? 'danger' : undefined} onClick={() => setTab('retry')} />
      </div>
      <Card muted>
        <div className="row wrap" style={{ gap: 14 }}>
          <span className="strong small">Channels</span>
          {CHANNELS.map((c) => (
            <span key={c} className="row" style={{ gap: 6 }}>
              <span className="small">{CHANNEL_LABEL[c]}</span>
              {channelPill(c)}
            </span>
          ))}
        </div>
      </Card>

      <Section title="Messages">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: 'All', count: groups.all.length },
            { value: 'drafts', label: 'Drafts', count: groups.drafts.length },
            { value: 'waiting', label: 'Waiting', count: groups.waiting.length },
            { value: 'sent', label: 'Sent', count: groups.sent.length },
            { value: 'retry', label: 'Retry queue', count: queue.length },
          ]}
        />
        {tab !== 'retry' ? (
          <FilterBar count={`${shownRows.length} of ${groups[tab].length}`}>
            <SearchInput value={q} onChange={setQ} placeholder="Search title or audience" />
          </FilterBar>
        ) : null}
        <Card flush>
          {tab === 'retry' ? (
            <Table rows={queue} columns={retryCols} rowKey={(r) => `${r.announcement.id}-${r.channel}`} onRowClick={(r) => setOpenId(r.announcement.id)} empty={<Empty title="No failed email or SMS" icon="checkCircle">Failed deliveries show here for a retry.</Empty>} />
          ) : (
            <Table
              rows={shownRows}
              columns={cols}
              caption="Announcements"
              rowKey={(a) => a.id}
              onRowClick={(a) => setOpenId(a.id)}
              empty={<Empty title="No announcements here" icon="announcement" action={canDraft ? <Button icon="add" onClick={() => setComposer({ ...EMPTY })}>New announcement</Button> : undefined}>Drafts, scheduled and sent messages appear in these tabs.</Empty>}
            />
          )}
        </Card>
      </Section>

      {composer ? Composer({ value: composer, onChange: setComposer, onClose: () => setComposer(null), onSave: saveDraft, error, now: t }) : null}

      {open ? (
        Detail({
          a: open,
          onClose: () => setOpenId(null),
          now: t,
          actions: (() => {
            const approval = approvalOf(d, open.id);
            const needs = announcementNeedsApproval(open);
            const approved = approval?.status === 'approved';
            const out: ReactNode[] = [];
            const pubBtn = (txt: string) =>
              canPublish ? (
                <Button key="pub" variant="primary" icon="announcement" onClick={() => publish(open)}>
                  {txt}
                </Button>
              ) : (
                <Button key="pub" disabledReason="Needs publish permission (marketing or owner)">{txt}</Button>
              );
            if (open.status === 'draft' && canDraft) {
              out.push(<Button key="cancel" variant="ghost" onClick={() => setConfirm({ kind: 'cancel', a: open })}>Cancel announcement</Button>);
              out.push(<Button key="edit" icon="edit" onClick={() => edit(open)}>Edit</Button>);
              if (needs) out.push(<Button key="req" variant="primary" icon="arrowRight" onClick={() => requestApproval(open)}>Request approval</Button>);
              else if (open.scheduledFor && open.scheduledFor > t) out.push(canPublish ? <Button key="sch" variant="primary" icon="calendar" onClick={() => schedule(open)}>Schedule</Button> : <Button key="sch" disabledReason="Needs publish permission">Schedule</Button>);
              else out.push(pubBtn('Publish now'));
            }
            if (open.status === 'pending_approval') {
              if (canDraft) out.push(<Button key="edit" variant="ghost" icon="edit" onClick={() => setConfirm({ kind: 'edit_back', a: open })}>Edit</Button>);
              if (approval?.status === 'pending' && staff) {
                if (canDecide(approval, staff)) {
                  out.push(<Button key="rej" variant="danger-soft" onClick={() => setConfirm({ kind: 'reject', a: open })}>Reject</Button>);
                  out.push(<Button key="app" variant="primary" icon="check" onClick={() => decide(open, true)}>Approve</Button>);
                } else out.push(<Button key="wait" disabledReason={approval.requestedBy.kind === 'staff' && approval.requestedBy.id === staff.id ? 'You can’t approve your own request' : 'Owner or administrator approves'}>Approve</Button>);
              }
              if (approved) {
                if (open.scheduledFor && open.scheduledFor > t) out.push(canPublish ? <Button key="sch" icon="calendar" onClick={() => schedule(open)}>Schedule</Button> : null);
                out.push(pubBtn('Publish now'));
              }
            }
            if (open.status === 'scheduled') {
              if (canDraft) out.push(<Button key="cancel" variant="ghost" onClick={() => setConfirm({ kind: 'cancel', a: open })}>Cancel</Button>);
              if (canDraft) out.push(<Button key="edit" icon="edit" onClick={() => setConfirm({ kind: 'edit_back', a: open })}>Edit</Button>);
              out.push(pubBtn('Send now'));
            }
            if (open.status === 'sending' && canPublish) out.push(<Button key="fin" variant="primary" icon="refresh" onClick={() => finishSending(open.id, open.title, open.channels)}>Check results</Button>);
            if ((open.status === 'sent' || open.status === 'partly_failed') && canDraft) {
              out.push(<Button key="edit" variant="ghost" icon="edit" onClick={() => edit(open)}>Edit copy</Button>);
              out.push(
                <Button key="dup" icon="copy" onClick={() => (setOpenId(null), setComposer({ title: open.title, body: open.body, audience: structuredClone(open.audience), channels: [...open.channels], schedule: '' }))}>
                  Duplicate as new draft
                </Button>,
              );
            }
            if (open.status === 'partly_failed') for (const item of queue.filter((q) => q.announcement.id === open.id)) out.push(canPublish ? <Button key={`r-${item.channel}`} variant="primary" icon="refresh" onClick={() => retry(item)}>Retry {CHANNEL_LABEL[item.channel]}</Button> : null);
            return out.filter(Boolean);
          })(),
        })
      ) : null}

      {confirm?.kind === 'cancel' ? (
        <ConfirmDialog title={`Cancel “${confirm.a.title}”`} body="Nothing is sent. A pending approval request is withdrawn." confirmLabel="Cancel announcement" danger requireReason onCancel={() => setConfirm(null)} onConfirm={async (reason) => { const r = await cancel(confirm.a, reason); if (r.ok) setConfirm(null); }} />
      ) : null}
      {confirm?.kind === 'reject' ? (
        <ConfirmDialog title={`Reject “${confirm.a.title}”`} body="It goes back to draft. The requester sees your reason." confirmLabel="Reject" danger requireReason onCancel={() => setConfirm(null)} onConfirm={async (reason) => { const r = await decide(confirm.a, false, reason); if (r.ok) setConfirm(null); }} />
      ) : null}
      {confirm?.kind === 'edit_back' ? (
        <ConfirmDialog title="Edit and go back to draft" body="Changing a message that is waiting or scheduled sends it back to draft. It needs a new approval or schedule." confirmLabel="Edit" onCancel={() => setConfirm(null)} onConfirm={() => { const a = confirm.a; setConfirm(null); edit(a); }} />
      ) : null}
    </>
  );

  /* ---------- Detail panel ---------- */
  function Detail({ a, onClose, actions, now: n }: { a: Announcement; onClose: () => void; actions: ReactNode[]; now: number }) {
    const approval = approvalOf(d, a.id);
    const needs = announcementNeedsApproval(a);
    const live = countAudience(d, a.audience, n);
    const history = d.audit.filter((e) => e.target.type === 'announcement' && e.target.id === a.id).sort((x, y) => y.at - x.at);
    const stepIndex = (() => {
      switch (a.status) {
        case 'draft':
          return 1;
        case 'pending_approval':
          return approval?.status === 'approved' ? 3 : 2;
        case 'scheduled':
          return 3;
        case 'sending':
          return 4;
        case 'sent':
        case 'partly_failed':
          return 6;
        default:
          return 0;
      }
    })();
    const shown = a.sentVersion && a.status !== 'draft';
    return (
      <Drawer title={a.title} sub={<StatusPill a={a} approval={approval} />} onClose={onClose} footer={actions.length ? actions : undefined}>
        {a.status === 'cancelled' ? (
          <Notice tone="info">Cancelled. Nothing was sent.</Notice>
        ) : (
          <Steps steps={['Draft', 'Audience preview', needs ? 'Approval' : 'No approval needed', 'Schedule or publish', 'Delivery', 'Results']} current={stepIndex} failedAt={a.status === 'partly_failed' ? 5 : undefined} />
        )}
        {a.status === 'scheduled' && a.scheduledFor ? (
          <Notice tone="warning">
            {a.scheduledFor <= n ? 'Due now. ' : `Scheduled for ${when(a.scheduledFor, n)}. `}
            Background jobs are not connected in this prototype, so scheduled messages don’t send on their own. Use Send now when it is time.
          </Notice>
        ) : null}
        {approval?.status === 'rejected' && a.status === 'draft' ? <Notice tone="danger">Rejected by {approval.decidedBy?.name}{approval.note ? `: ${approval.note}` : ''}</Notice> : null}
        <KV
          items={[
            ['Audience', describeAudience(a.audience, eventName(a.audience.eventId))],
            ['Audience size', a.sentVersion ? `${count(a.audienceSize)} when sent` : `${count(live.total)} now`],
            ['Channels', a.channels.map((c) => CHANNEL_LABEL[c]).join(', ')],
            ['Approval', needs ? (approval ? `${fmtLabel(approval.status)}${approval.decidedBy ? ` by ${approval.decidedBy.name}` : ''}` : 'Needed: all users or SMS') : 'Not needed'],
            ['Created by', a.createdBy.name],
            ['Approved by', a.approvedBy?.name ?? 'Not yet'],
            ['Scheduled for', a.scheduledFor ? when(a.scheduledFor, n) : 'Not scheduled'],
          ]}
        />
        <div className="grid" style={{ gridTemplateColumns: shown ? '1fr 1fr' : '1fr', gap: 12 }}>
          <Card muted title={shown ? 'Current copy' : 'Message'}>
            <div className="strong">{a.title}</div>
            <p className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.body}</p>
          </Card>
          {shown && a.sentVersion ? (
            <Card title={<span className="row"><span>Sent copy</span><Pill tone="neutral" icon="lock">{when(a.sentVersion.at, n)}</Pill></span>}>
              <div className="strong">{a.sentVersion.title}</div>
              <p className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.sentVersion.body}</p>
            </Card>
          ) : null}
        </div>
        {editedSinceSent(a) ? <Notice tone="info">Edited after sending. People keep the sent copy; edits never change messages already delivered.</Notice> : null}
        {a.sentVersion ? (
          <div className="stack">
            <h3>Results</h3>
            {a.status === 'sending' ? <Notice tone="info">Sending. Inbox records are created; waiting for channel results.</Notice> : null}
            <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th className="right">Attempted</th>
                    <th className="right">Delivered</th>
                    <th className="right">Failed</th>
                    <th style={{ width: 120 }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {a.channels.map((c) => {
                    const r = a.delivery[c];
                    return (
                      <tr key={c}>
                        <td className="strong">{CHANNEL_LABEL[c]}</td>
                        <td className="right num">{count(r.attempted)}</td>
                        <td className="right num">{count(r.delivered)}</td>
                        <td className="right num" style={r.failed ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{count(r.failed)}</td>
                        <td>{r.attempted ? <Meter value={r.delivered / r.attempted} label={`${CHANNEL_LABEL[c]} delivered`} /> : <span className="muted small">Not sent</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {a.channels.includes('inbox') ? <p className="muted small">{count(a.delivery.inbox.delivered)} app inbox records created. Results for other channels are simulated in this prototype.</p> : <p className="muted small">Results are simulated in this prototype.</p>}
          </div>
        ) : (
          <div className="stack">
            <h3>Audience preview</h3>
            {ReachTable({ aud: live, channels: a.channels })}
          </div>
        )}
        {history.length ? (
          <div className="stack">
            <h3>History</h3>
            <Timeline items={history.map((h) => ({ at: h.at, title: h.summary, sub: `${h.actor.name}${h.reason ? ` · ${h.reason}` : ''}` }))} />
          </div>
        ) : null}
      </Drawer>
    );
  }

  function ReachTable({ aud, channels }: { aud: ReturnType<typeof countAudience>; channels: Channel[] }) {
    return (
      <div className="stack">
        <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
          <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>{count(aud.total)}</span>
          <span className="muted">people match</span>
        </div>
        <div className="stack tight">
          {channels.map((c) => {
            const s = channelState(d.integrations, c);
            return (
              <div key={c} className="row wrap" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>
                  {CHANNEL_LABEL[c]} <span className="muted small">reaches {count(aud.reach[c])}</span>
                </span>
                {s.connected ? <Pill tone="success">Can send</Pill> : <Pill tone="warning" icon="plugin">Not connected: will queue, not send</Pill>}
              </div>
            );
          })}
        </div>
        <p className="muted small">Counts are before personal preferences: people who turned a channel off are skipped when sending. Email and SMS for marketing go only to people who agreed to receive them.</p>
      </div>
    );
  }

  /* ---------- Composer ---------- */
  function Composer({ value: c, onChange, onClose, onSave, error: err, now: n }: { value: Draft; onChange: (v: Draft) => void; onClose: () => void; onSave: () => Promise<void>; error: string | null; now: number }) {
    const aud = countAudience(d, c.audience, n);
    const errs = validateAnnouncement(c);
    const scheduleMs = c.schedule ? fromLocalInput(c.schedule) : undefined;
    const scheduleErr = scheduleMs !== undefined && !(scheduleMs > n) ? 'Choose a time in the future.' : undefined;
    const sms = smsSegments(c.body);
    const needs = announcementNeedsApproval(c);
    const existing = c.id ? d.announcements.find((a) => a.id === c.id) : undefined;
    const copyOnly = existing && (existing.status === 'sent' || existing.status === 'partly_failed');
    const f = c.audience;
    const setAud = (patch: Partial<AudienceFilter>) => onChange({ ...c, audience: { ...f, ...patch } });
    const toggle = <V,>(xs: V[] | undefined, v: V, on: boolean) => (on ? [...(xs ?? []), v] : (xs ?? []).filter((x) => x !== v));
    const statuses: readonly string[] = f.type === 'passenger' ? PASSENGER_STATUSES : DRIVER_STATUSES;
    const style = copyIssues(`${c.title} ${c.body}`);
    return (
      <Drawer
        title={c.id ? (copyOnly ? 'Edit copy' : 'Edit announcement') : 'New announcement'}
        sub={copyOnly ? 'Already sent. Edits change this record only, not messages people received.' : 'Saved as a draft. You preview the audience and publish from the next step.'}
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="check" onClick={onSave} disabledReason={errs[0] ?? scheduleErr}>
              {copyOnly ? 'Save copy' : 'Save draft'}
            </Button>
          </>
        }
      >
        {err ? <Notice tone="danger">{err}</Notice> : null}
        <TextField label="Title" value={c.title} onChange={(title) => onChange({ ...c, title })} max={TITLE_MAX} />
        <TextField label="Message" value={c.body} onChange={(body) => onChange({ ...c, body })} max={BODY_MAX} multiline hint={c.channels.includes('sms') ? `SMS sends the message only: ${sms.segments} segment${sms.segments === 1 ? '' : 's'} (${sms.encoding}, ${sms.perSegment} characters each)${sms.encoding === 'Unicode' ? '. Characters like ₦ switch SMS to Unicode' : ''}` : undefined} />
        {style.length ? <Notice tone="warning">House style: {style.join(' ')}</Notice> : null}
        {copyOnly ? null : (
          <>
            <Card>
              <h3 style={{ marginBottom: 12 }}>Audience</h3>
              <div className="stack" style={{ gap: 12 }}>
                <Segmented label="Audience type" value={f.type} onChange={(type) => setAud({ type, statuses: undefined, packages: undefined })} options={[{ value: 'passenger', label: 'Passengers' }, { value: 'driver', label: 'Drivers' }]} />
                <div className="row wrap" style={{ gap: 16 }}>
                  <span className="small strong">Cities</span>
                  {ALL_CITIES.map((ci: CityId) => (
                    <Check key={ci} checked={f.cities.includes(ci)} onChange={(on) => setAud({ cities: toggle(f.cities, ci, on) })}>
                      {ci === 'lagos' ? 'Lagos' : 'Abuja'}
                    </Check>
                  ))}
                </div>
                <div className="row wrap" style={{ gap: 16 }}>
                  <span className="small strong">{f.type === 'passenger' ? 'Account status' : 'Verification'}</span>
                  {statuses.map((s) => (
                    <Check key={s} checked={!!f.statuses?.includes(s)} onChange={(on) => setAud({ statuses: toggle(f.statuses, s, on) })}>
                      {fmtLabel(s)}
                    </Check>
                  ))}
                  <span className="muted small">None ticked means any</span>
                </div>
                {f.type === 'driver' ? (
                  <div className="row wrap" style={{ gap: 16 }}>
                    <span className="small strong">Active pass</span>
                    {(['daily', 'monthly'] as const).map((p) => (
                      <Check key={p} checked={!!f.packages?.includes(p)} onChange={(on) => setAud({ packages: toggle(f.packages, p, on) })}>
                        {fmtLabel(p)}
                      </Check>
                    ))}
                  </div>
                ) : null}
                <Field label="Event" hint="People who took or drove a trip in the event city during the event">
                  {(id) => (
                    <select id={id} className="select" value={f.eventId ?? ''} onChange={(e) => setAud({ eventId: e.target.value || undefined })}>
                      <option value="">Any</option>
                      {d.events.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            </Card>
            <Card>
              <h3 style={{ marginBottom: 12 }}>Channels</h3>
              <div className="stack" style={{ gap: 8 }}>
                {CHANNELS.map((ch) => {
                  const s = channelState(d.integrations, ch);
                  return (
                    <div key={ch} className="row wrap" style={{ justifyContent: 'space-between' }}>
                      <Check checked={c.channels.includes(ch)} onChange={(on) => onChange({ ...c, channels: toggle(c.channels, ch, on) })}>
                        {CHANNEL_LABEL[ch]}
                      </Check>
                      {s.connected ? <span className="muted small">{s.state === 'internal' ? 'Creates an inbox record for each person' : s.provider}</span> : <Pill tone="warning" icon="plugin">Not connected: will queue, not send</Pill>}
                    </div>
                  );
                })}
                <p className="muted small">Push, email and SMS respect each person’s notification preferences. Marketing email and SMS need consent.</p>
              </div>
            </Card>
            <Card muted>
              <h3 style={{ marginBottom: 12 }}>Audience preview</h3>
              {ReachTable({ aud, channels: c.channels })}
              {c.channels.includes('sms') && sms.segments ? <p className="small" style={{ marginTop: 8 }}>About {count(sms.segments * aud.reach.sms)} SMS segments in total.</p> : null}
            </Card>
            {needs ? <Notice tone="warning" icon="lock">Needs approval from the owner or an administrator: {APPROVAL_RULES.announcement.note.toLowerCase()}.</Notice> : <Notice tone="info">No approval needed for this audience and these channels.</Notice>}
            <Field label="Schedule (optional)" hint="Lagos time. Leave empty to publish when ready." error={scheduleErr}>
              {(id) => <input id={id} className="input" type="datetime-local" value={c.schedule} min={toLocalInput(n)} onChange={(e) => onChange({ ...c, schedule: e.target.value })} />}
            </Field>
          </>
        )}
      </Drawer>
    );
  }
}
