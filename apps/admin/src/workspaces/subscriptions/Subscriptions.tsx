import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CITY_LABELS, DRIVER_ACCESS_PACKAGES, type DriverRecord } from '@gobye/core';
import { count, label, money, when } from '@/data/format';
import { PanelSection, RecordLink } from '@/data/records';
import { RANGE_MS, useFilters, useScopedFilter, useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Button, Card, Drawer, Empty, FeaturedStat, FilterBar, KV, Notice, PageHead, Pill, SearchInput, Section, Select, Stat, Table, Tabs, type Column, type Tone, type TrendValue } from '@/ui/kit';
import '@/workspaces/people/people.css';
import { PLAN_LABEL, currentAccess, eligibility, subscriptionRecords, subscriptionRevenue, type Plan, type SubscriptionRecord, type SubscriptionStatus } from './logic';

type Tab = 'all' | 'active' | 'expiring' | 'expired' | 'issues';
const STATUS: Record<SubscriptionStatus, { tone: Tone; text: string }> = {
  active: { tone: 'success', text: 'Active' },
  scheduled: { tone: 'info', text: 'Starts later' },
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
  const records = useMemo(() => subscriptionRecords(d.collections, t), [d.collections, t]).filter((r) => inScope.has(r.driverId));
  const access = currentAccess(drivers, t);
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
    expiring: records.filter((r) => r.status === 'active' && r.expiresAt! - t <= 72 * HOUR),
    expired: records.filter((r) => r.status === 'expired'),
    issues,
  };
  const rows = tabRows[tab].filter((r) => (plan === 'all' || r.plan === plan) && (!s || (byId.get(r.driverId)?.name.toLowerCase().includes(s) ?? false) || r.reference.toLowerCase().includes(s)));
  const selected = openId ? records.find((r) => r.id === openId) : undefined;

  const columns: Column<SubscriptionRecord>[] = [
    { key: 'driver', label: 'Driver', sortValue: (r) => byId.get(r.driverId)?.name ?? '', render: (r) => { const x = byId.get(r.driverId); return (<><div className="cell-title">{x?.name ?? r.driverId}</div><div className="cell-sub">{x ? CITY_LABELS[x.city] : ''}</div></>); } },
    { key: 'plan', label: 'Plan', sortValue: (r) => r.plan ?? '', render: (r) => (r.plan ? PLAN_LABEL[r.plan] : <Pill tone="warning">Unknown amount</Pill>) },
    { key: 'paid', label: 'Paid', align: 'right', sortValue: (r) => r.amount, render: (r) => <span className="num">{money(r.amount)}</span> },
    { key: 'start', label: 'Activated', sortValue: (r) => r.startsAt ?? 0, render: (r) => <span className="small">{r.startsAt ? when(r.startsAt, t) : 'Not activated'}</span> },
    { key: 'end', label: 'Expires', sortValue: (r) => r.expiresAt ?? 0, render: (r) => <span className="small">{r.expiresAt ? when(r.expiresAt, t) : 'Not set'}</span> },
    { key: 'status', label: 'Pass period', sortValue: (r) => r.status, render: (r) => <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill> },
    {
      key: 'elig',
      label: 'Can accept rides',
      render: (r) => {
        const x = byId.get(r.driverId);
        if (!x) return null;
        const e = eligibility(x, t);
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
        <FeaturedStat label="Active subscriptions" value={count(access.active)} sub={`${count(access.daily)} daily · ${count(access.monthly)} monthly`} art="subscription" onClick={go('active')} />
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
            When a pass expires the driver stops receiving new ride requests; a ride already in progress may finish. Renewal is manual (Q-043): no automatic renewal runs, so there are no failed renewals to show. Failed package payments are listed under Payment issues.
          </Notice>
        </div>
      </Section>

      <Section title="Subscription records" desc="One row per package payment, each running from its own verified activation. The driver’s current access record is what decides ride requests.">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: 'All', count: records.length },
            { value: 'active', label: 'Active', count: tabRows.active.length },
            { value: 'expiring', label: 'Expiring in 3 days', count: tabRows.expiring.length },
            { value: 'expired', label: 'Expired', count: tabRows.expired.length },
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
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const e = driver ? eligibility(driver, t) : null;
  return (
    <Drawer title={r.plan ? `${PLAN_LABEL[r.plan]} pass` : 'Package payment'} sub={driver ? `${driver.name} · ${CITY_LABELS[driver.city]}` : r.driverId} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="panel-pills">
        <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>
        {e ? <Pill tone={e.eligible ? 'success' : 'neutral'} icon={e.eligible ? 'checkCircle' : 'lock'}>{e.eligible ? 'Can accept rides' : e.reason}</Pill> : null}
        {driver ? <RecordLink type="driver" id={driver.id}>Open driver record</RecordLink> : null}
      </div>
      {r.status === 'active' && driver && !(driver.access && driver.access.expiresAt > t) ? (
        <Notice tone="warning">This pass is within its paid period, but the driver’s access record shows no active access, so they don’t receive ride requests. Activation should write both; check the access record before acting. (Test data mismatch.)</Notice>
      ) : null}
      {r.status === 'needs_review' ? <Notice tone="warning">The amount matches neither confirmed plan, so no access was given. Finance should check the payment with the provider.</Notice> : null}
      {r.status === 'failed' ? <Notice tone="danger">This payment did not succeed, so no access was given. The driver can pay again.</Notice> : null}
      <PanelSection title="Payment" icon="wallet">
        <KV
          items={[
            ['Amount', <span className="num strong">{money(r.amount)}</span>],
            ['Provider', r.provider],
            ['Reference', can('finance.view') ? r.reference : 'Hidden for your role'],
            ['Payment status', label(r.paymentStatus)],
            ['Verified', r.paidAt ? when(r.paidAt, t) : 'Not verified'],
          ]}
        />
      </PanelSection>
      <PanelSection title="Activation" icon="ticket">
        <KV
          items={[
            ['Plan', r.plan ? `${PLAN_LABEL[r.plan]} (${r.plan === 'daily' ? '24 hours' : '30 days'})` : 'Unknown'],
            ['Starts', r.startsAt ? when(r.startsAt, t) : 'Not activated'],
            ['Expires', r.expiresAt ? when(r.expiresAt, t) : 'Not set'],
            ['Renewal', 'Manual: the driver buys a new pass'],
          ]}
        />
        <span className="small muted">Times in Lagos time. Activation happens only after the provider confirms the payment; a webhook alone never activates a pass. Whether a pass bought during another extends it is still open (Q-043).</span>
      </PanelSection>
      {driver ? (
        <PanelSection title="Driver eligibility" icon="steering">
          <KV
            items={[
              ['Verification', label(driver.verification)],
              ['Current access', driver.access ? `${PLAN_LABEL[driver.access.packageId]} until ${when(driver.access.expiresAt, t)}` : 'None'],
              ['New ride requests', e?.eligible ? 'Receives requests' : `Blocked: ${e?.reason ?? ''}`],
            ]}
          />
        </PanelSection>
      ) : null}
    </Drawer>
  );
}
