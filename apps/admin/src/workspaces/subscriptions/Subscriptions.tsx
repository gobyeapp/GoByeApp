import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CITY_LABELS, DRIVER_ACCESS_PACKAGES, type DriverRecord } from '@gobye/core';
import { count, label, money, when } from '@/data/format';
import { PanelSection, RecordLink } from '@/data/records';
import { RANGE_MS, useFilters, useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, ConfirmDialog, Drawer, Empty, FeaturedStat, FilterBar, KV, Notice, PageHead, Pill, SearchInput, Section, Select, Stat, Table, Tabs, type Column, type Tone, type TrendValue } from '@/ui/kit';
import '@/workspaces/people/people.css';
import { PASS_DAYS, PLAN_LABEL, applyPassVoid, currentAccess, eligibility, subscriptionRecords, subscriptionRevenue, timelineFor, type Plan, type SubscriptionRecord, type SubscriptionStatus } from './logic';

type Tab = 'all' | 'active' | 'expiring' | 'expired' | 'issues';
const STATUS: Record<SubscriptionStatus, { tone: Tone; text: string }> = {
  active: { tone: 'success', text: 'Active' },
  scheduled: { tone: 'info', text: 'Queued' },
  cancelled: { tone: 'neutral', text: 'Cancelled' },
  refunded: { tone: 'neutral', text: 'Refunded' },
  reversed: { tone: 'danger', text: 'Reversed' },
  expired: { tone: 'neutral', text: 'Expired' },
  pending_payment: { tone: 'warning', text: 'Payment pending' },
  failed: { tone: 'danger', text: 'Payment failed' },
  needs_review: { tone: 'warning', text: 'Needs review' },
};
const RANGE_TEXT = { today: 'today', '7d': 'in the last 7 days', '30d': 'in the last 30 days', all: 'all time' } as const;
const PREV_TEXT = { today: 'vs yesterday', '7d': 'vs previous 7 days', '30d': 'vs previous 30 days', all: '' } as const;
const HOUR = 3_600_000;

export default function Subscriptions() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const { range } = useFilters();
  const keepRow = useScopedFilter();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState<Plan | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const t = now();

  // Drivers follow the city filter and your city scope; the date range applies to revenue only.
  const drivers = d.drivers.filter((x) => keepRow(x.city, undefined, t));
  const byId = useMemo(() => new Map(d.drivers.map((x) => [x.id, x])), [d.drivers]);
  const inScope = new Set(drivers.map((x) => x.id));
  const records = useMemo(() => subscriptionRecords(d.collections, d.subscriptions, t), [d.collections, d.subscriptions, t]).filter((r) => inScope.has(r.driverId));
  const access = currentAccess(drivers, d.subscriptions, t);
  const R = RANGE_MS[range];
  const revenue = subscriptionRevenue(records, (at) => t - at <= R);
  const prev = range === 'all' ? null : subscriptionRevenue(records, (at) => t - at > R && t - at <= 2 * R);
  // Compare only when the earlier period has enough payments to mean something.
  const trend: TrendValue | undefined = prev && prev.count >= 10 && prev.total > 0 ? { delta: (revenue.total - prev.total) / prev.total, vs: PREV_TEXT[range] } : undefined;
  const issues = records.filter((r) => r.status === 'failed' || r.status === 'pending_payment' || r.status === 'needs_review');
  const failed = records.filter((r) => r.status === 'failed').length;

  const s = q.trim().toLowerCase();
  const tabRows: Record<Tab, SubscriptionRecord[]> = {
    all: records,
    active: records.filter((r) => r.status === 'active' || r.status === 'scheduled'),
    expiring: records.filter((r) => r.status === 'active' && (timelineFor(d.subscriptions, r.driverId, t).access.activeUntil ?? 0) - t <= 72 * HOUR),
    expired: records.filter((r) => r.status === 'expired' || r.status === 'cancelled' || r.status === 'refunded' || r.status === 'reversed'),
    issues,
  };
  const rows = tabRows[tab].filter((r) => (plan === 'all' || r.plan === plan) && (!s || (byId.get(r.driverId)?.name.toLowerCase().includes(s) ?? false) || r.reference.toLowerCase().includes(s)));
  const selected = openId ? records.find((r) => r.id === openId) : undefined;

  const columns: Column<SubscriptionRecord>[] = [
    { key: 'driver', label: 'Driver', sortValue: (r) => byId.get(r.driverId)?.name ?? '', render: (r) => { const x = byId.get(r.driverId); return (<><div className="cell-title">{x?.name ?? r.driverId}</div><div className="cell-sub">{x ? CITY_LABELS[x.city] : ''}</div></>); } },
    { key: 'plan', label: 'Plan', sortValue: (r) => r.plan ?? '', render: (r) => (r.plan ? PLAN_LABEL[r.plan] : <Pill tone="warning">Unknown amount</Pill>) },
    { key: 'paid', label: 'Paid', align: 'right', sortValue: (r) => r.amount, render: (r) => <span className="num">{money(r.amount)}</span> },
    { key: 'paidAt', label: 'Confirmed', sortValue: (r) => r.paidAt ?? 0, render: (r) => <span className="small">{r.paidAt ? when(r.paidAt, t) : 'Not confirmed'}</span> },
    { key: 'start', label: 'Starts', sortValue: (r) => r.startsAt ?? 0, render: (r) => <span className="small">{r.startsAt ? when(r.startsAt, t) : 'No pass'}</span> },
    { key: 'end', label: 'Ends', sortValue: (r) => r.accessEndsAt ?? 0, render: (r) => <span className="small">{r.accessEndsAt !== undefined ? (r.accessEndsAt <= r.startsAt! ? 'No access given' : when(r.accessEndsAt, t)) : 'Not set'}</span> },
    { key: 'status', label: 'Pass period', sortValue: (r) => r.status, render: (r) => <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill> },
    {
      key: 'elig',
      label: 'Can accept rides',
      render: (r) => {
        const x = byId.get(r.driverId);
        if (!x) return null;
        const e = eligibility(x, timelineFor(d.subscriptions, x.id, t));
        return <Pill tone={e.eligible ? 'success' : 'neutral'} icon={e.eligible ? 'checkCircle' : 'lock'}>{e.eligible ? 'Yes' : e.reason}</Pill>;
      },
    },
  ];

  const daily = DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'daily')!;
  const monthly = DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'monthly')!;
  const go = (next: Tab) => () => setTab(next);
  const emptyFor: Record<Tab, { title: string; body: string }> = {
    all: { title: s || plan !== 'all' ? 'No subscriptions match' : 'No package payments yet', body: s ? 'Search by driver name or payment reference.' : 'Drivers appear here after they pay for a daily or monthly pass.' },
    active: { title: 'No active passes', body: 'Drivers with access running now, or bought to start later, appear here.' },
    expiring: { title: 'Nothing expiring in 3 days', body: 'Passes ending within 72 hours appear here, so operations can expect who goes offline.' },
    expired: { title: 'No expired passes', body: 'Passes whose time has run out appear here.' },
    issues: { title: 'No payment issues', body: 'Pending, failed or unrecognised package payments appear here.' },
  };

  return (
    <>
      <PageHead
        eyebrow="Revenue"
        title="Driver subscriptions"
        sub="GoBye earns from driver passes, not from trips (0% commission). Access starts when a payment is verified with the provider."
        meta={<><Pill tone="neutral" icon="info">Test data</Pill><Pill tone="neutral" icon="refresh">Renewal is manual</Pill></>}
      />

      <div className="grid featured">
        <FeaturedStat label="Active subscriptions" value={count(access.active)} sub={`${count(access.daily)} daily · ${count(access.monthly)} monthly · ${count(access.queued)} with a queued pass`} art="subscription" onClick={go('active')} />
        <Stat icon="time" label="Expiring soon" value={count(access.expiring3d)} sub={`${count(access.expiring24h)} within 24 hours`} tone={access.expiring24h ? 'warning' : undefined} onClick={go('expiring')} />
        <Stat icon="wallet" label="Subscription revenue" value={money(revenue.total)} trend={trend} sub={`${count(revenue.count)} verified payments ${RANGE_TEXT[range]}`} />
        <Stat icon="alert" label="Payment issues" value={count(issues.length)} sub={failed ? `${count(failed)} failed or abandoned` : 'None failed'} tone={failed ? 'danger' : undefined} onClick={go('issues')} />
      </div>

      <Section title="Plans" desc="Confirmed prices. Plans are not part of fee schedules and change only through Settings with owner approval.">
        <div className="grid cols-3">
          {[daily, monthly].map((p) => (
            <Card key={p.id} className="compact">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="small muted strong">{p.name}</div>
                  <div className="num" style={{ fontSize: 28, lineHeight: '34px', fontWeight: 650, color: 'var(--ink)', marginTop: 6 }}>{money(p.price)}</div>
                  <div className="small muted" style={{ marginTop: 4 }}>{p.id === 'daily' ? '24 hours from successful activation' : '30 consecutive days'}</div>
                </div>
                <Pill tone="success" icon="checkCircle">Confirmed</Pill>
              </div>
              <div className="small" style={{ marginTop: 14 }}>
                <span className="strong num">{count(p.id === 'daily' ? access.daily : access.monthly)}</span> <span className="muted">active now · revenue {RANGE_TEXT[range]}</span>{' '}
                <span className="strong num">{money(p.id === 'daily' ? revenue.daily : revenue.monthly)}</span>
              </div>
            </Card>
          ))}
          <Card className="compact">
            <div className="small muted strong">Trip commission</div>
            <div className="num" style={{ fontSize: 28, lineHeight: '34px', fontWeight: 650, color: 'var(--ink)', marginTop: 6 }}>0%</div>
            <div className="small muted" style={{ marginTop: 4 }}>Drivers keep the full fare</div>
            {can('config.view') ? (
              <div style={{ marginTop: 14 }}>
                <Button size="sm" variant="secondary" iconEnd="right" onClick={() => navigate('/config/packages')}>Change plans in Settings</Button>
              </div>
            ) : null}
          </Card>
        </div>
        <div style={{ marginTop: 16 }}>
          <Notice tone="info" icon="info">
            A pass bought while another is active or queued starts when the last queued pass ends, so drivers never lose time they paid for. Queued passes start on their own at their start time. When access ends the driver stops receiving new ride requests; a ride already in progress may finish. Renewal is manual: the driver buys the next pass. Failed package payments are listed under Payment issues.
          </Notice>
        </div>
      </Section>

      <Section title="Subscription records" desc="One row per package payment. Start and end come from the driver’s pass timeline, the same one the Driver App shows.">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: 'All', count: records.length },
            { value: 'active', label: 'Active', count: tabRows.active.length },
            { value: 'expiring', label: 'Expiring in 3 days', count: tabRows.expiring.length },
            { value: 'expired', label: 'Ended or refunded', count: tabRows.expired.length },
            { value: 'issues', label: 'Payment issues', count: issues.length },
          ]}
        />
        <FilterBar count={`${count(rows.length)} shown`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search driver or payment reference" />
          <Select<Plan | 'all'> label="Plan" value={plan} onChange={setPlan} options={[{ value: 'all', label: 'Daily and monthly' }, { value: 'daily', label: 'Daily' }, { value: 'monthly', label: 'Monthly' }]} />
        </FilterBar>
        <Card flush>
          <Table
            caption="Subscription records"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            pageSize={25}
            empty={<Empty title={emptyFor[tab].title} art={tab === 'issues' ? undefined : 'subscription'} icon="checkCircle">{emptyFor[tab].body}</Empty>}
          />
        </Card>
      </Section>
      {selected ? <RecordDrawer r={selected} driver={byId.get(selected.driverId)} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function RecordDrawer({ r, driver, onClose }: { r: SubscriptionRecord; driver?: DriverRecord; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const [voidKind, setVoidKind] = useState<'cancelled' | 'refunded' | null>(null);
  const t = now();
  const tl = timelineFor(d.subscriptions, r.driverId, t);
  const e = driver ? eligibility(driver, tl) : null;
  const canVoid = can('refunds.approve');
  const voidable = r.status === 'active' || r.status === 'scheduled';
  return (
    <Drawer
      title={r.plan ? `${PLAN_LABEL[r.plan]} pass` : 'Package payment'}
      sub={driver ? `${driver.name} · ${CITY_LABELS[driver.city]}` : r.driverId}
      onClose={onClose}
      footer={
        <>
          {voidable ? (
            <>
              <Button variant="secondary" disabledReason={canVoid ? undefined : 'Needs finance approval rights'} onClick={() => setVoidKind('cancelled')}>Cancel pass</Button>
              <Button variant="danger-soft" disabledReason={canVoid ? undefined : 'Needs finance approval rights'} onClick={() => setVoidKind('refunded')}>Refund pass</Button>
            </>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="panel-pills">
        <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>
        {e ? <Pill tone={e.eligible ? 'success' : 'neutral'} icon={e.eligible ? 'checkCircle' : 'lock'}>{e.eligible ? 'Can accept rides' : e.reason}</Pill> : null}
        {driver ? <RecordLink type="driver" id={driver.id}>Open driver record</RecordLink> : null}
      </div>
      {r.status === 'needs_review' ? <Notice tone="warning">The amount matches neither confirmed plan, so no access was given. Finance should check the payment with the provider.</Notice> : null}
      {r.status === 'failed' ? <Notice tone="danger">This payment did not succeed, so no access was given. The driver can pay again.</Notice> : null}
      {r.voidReason ? <Notice tone="info">{STATUS[r.status].text}: {r.voidReason}. The record is kept; only access not yet given was removed.</Notice> : null}
      <PanelSection title="Payment" icon="wallet">
        <KV
          items={[
            ['Amount', <span className="num strong">{money(r.amount)}</span>],
            ['Provider', r.provider],
            ['Reference', can('finance.view') ? r.reference : 'Hidden for your role'],
            ['Payment status', label(r.paymentStatus)],
            ['Confirmed', r.paidAt ? when(r.paidAt, t) : 'Not confirmed'],
          ]}
        />
      </PanelSection>
      <PanelSection title="Pass period" icon="ticket">
        <KV
          items={[
            ['Plan', r.plan ? `${PLAN_LABEL[r.plan]} (${PASS_DAYS[r.plan]})` : 'Unknown'],
            ['Starts', r.startsAt ? when(r.startsAt, t) : 'No pass'],
            ['Scheduled end', r.expiresAt ? when(r.expiresAt, t) : 'Not set'],
            ['Access ends', r.accessEndsAt !== undefined ? (r.accessEndsAt <= (r.startsAt ?? 0) ? 'No access given' : when(r.accessEndsAt, t)) : 'Not set'],
          ]}
        />
        <span className="small muted">Lagos time. Starts at the later of payment confirmation and the end of the driver’s last queued pass. Only a provider-confirmed payment creates a pass; a repeated webhook never adds time.</span>
      </PanelSection>
      <PanelSection title="Driver’s pass timeline" icon="calendar">
        <KV
          items={[
            ['Access now', tl.access.active ? `${PLAN_LABEL[tl.access.currentPlan!]} pass` : 'None'],
            ['Continuous access until', tl.access.activeUntil ? when(tl.access.activeUntil, t) : 'Not active'],
            ['Queued passes', String(tl.summary.scheduled)],
            ['New ride requests', e?.eligible ? 'Receives requests' : `Blocked: ${e?.reason ?? ''}`],
          ]}
        />
        <ol className="timeline" style={{ marginTop: 8 }}>
          {tl.passes.slice(0, 8).map((p) => (
            <li key={p.id}>
              <div className="strong">
                {PLAN_LABEL[p.plan]} · <span style={{ fontWeight: 500 }}>{STATUS[p.status].text}</span>
              </div>
              <div className="when">
                {when(p.startsAt, t)} to {p.accessEndsAt <= p.startsAt ? 'no access given' : when(p.accessEndsAt, t)}
              </div>
            </li>
          ))}
        </ol>
      </PanelSection>
      {voidKind && driver ? (
        <ConfirmDialog
          title={voidKind === 'refunded' ? 'Refund this pass?' : 'Cancel this pass?'}
          body={r.status === 'active' ? 'Access from this pass ends now. Any queued passes start at once, so the driver keeps the time they paid for. The record stays in history.' : 'This queued pass gives no access. Later passes move up. The record stays in history.'}
          confirmLabel={voidKind === 'refunded' ? 'Refund pass' : 'Cancel pass'}
          danger
          requireReason
          onCancel={() => setVoidKind(null)}
          onConfirm={async (reason) => {
            const ok = await act(
              {
                label: voidKind === 'refunded' ? 'Refund pass' : 'Cancel pass',
                apply: (draft, ctx) => {
                  const res = applyPassVoid(draft, driver.id, { paymentRef: r.reference, kind: voidKind, at: ctx.now, reason, by: ctx.actor.name }, ctx.now);
                  return res.ok ? { ok: true } : { ok: false, error: res.error };
                },
                audit: () => ({ action: `subscription.${voidKind}`, target: { type: 'driver', id: driver.id, label: driver.name }, summary: `${voidKind === 'refunded' ? 'Refunded' : 'Cancelled'} ${r.plan ?? ''} pass ${r.reference}`, reason }),
              },
              voidKind === 'refunded' ? 'Pass refunded. Pay the money back through finance.' : 'Pass cancelled',
            );
            if (ok) setVoidKind(null);
          }}
        />
      ) : null}
    </Drawer>
  );
}
