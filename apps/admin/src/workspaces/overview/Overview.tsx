import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CITY_LABELS, ROLE_LABELS, type CityId } from '@gobye/core';
import { count, date, money, pct, when } from '@/data/format';
import { RANGE_MS, useFilters, useScopedFilter, useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { ALL_ITEMS } from '@/nav';
import { Icon } from '@/ui/Icon';
import { Bars, Button, Card, Empty, Notice, PageHead, Pill, Section, Stat, Table, type Column } from '@/ui/kit';
import { dailyCompleted, integrationAlerts, needsAttention, overviewMetrics, type Keep, type OverviewMetrics } from './logic';

const RANGE_TEXT = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' } as const;

/** Navigate to a workspace only when the viewer's role can open it. */
function useOpener() {
  const navigate = useNavigate();
  const { can } = useSession();
  return (path: string) => {
    const item = ALL_ITEMS.find((i) => i.path === path);
    return item && item.anyOf.some((p) => can(p)) ? () => navigate(path) : undefined;
  };
}

export default function Overview() {
  const d = useData();
  const { now } = usePlatform();
  const { staff, can, inScope } = useSession();
  const { city, range } = useFilters();
  const keepRow = useScopedFilter();
  const open = useOpener();
  const t = now();

  const inRange = (at: number | undefined) => at === undefined || t - at <= RANGE_MS[range];
  // Ledger lines that can't be tied to a city count only in the unfiltered, unscoped view.
  const keep: Keep = (c, at) => (c ? keepRow(c, at, t) : city === 'all' && !staff?.cities.length && inRange(at));
  // Cheap over the test dataset (hundreds of rows); the backend will serve these as one summary call.
  const m = overviewMetrics(d, keep, t);
  const attention = needsAttention(d, keep);
  const days = range === '30d' || range === 'all' ? 30 : 7;
  const daily = dailyCompleted(d, keep, t, days);
  const byCity = (['lagos', 'abuja'] as CityId[]).filter(inScope).map((c) => ({ city: c, m: overviewMetrics(d, (rc, at) => rc === c && inRange(at), t) }));
  const alerts = useMemo(() => integrationAlerts(d), [d]);
  const pending = d.approvals.filter((a) => a.status === 'pending').sort((a, b) => b.requestedAt - a.requestedAt);
  const seeMoney = can('finance.view') || can('ledger.view');
  const scopeText = `${city === 'all' ? (staff?.cities.length ? 'Your cities' : 'Lagos and Abuja') : CITY_LABELS[city]} · ${RANGE_TEXT[range]}`;

  return (
    <>
      <PageHead title="Business overview" sub={`${scopeText}. How the business is doing, what needs attention and what is waiting for a decision.`} />

      <Section title="Needs attention">
        {attention.length ? (
          <Card flush>
            <div className="stack" style={{ gap: 0 }}>
              {attention.map((a, i) => {
                const go = open(a.path);
                return (
                  <div key={a.key} className="row" style={{ padding: '12px 16px', borderTop: i ? '1px solid var(--border)' : undefined }}>
                    <Pill tone={a.tone} icon={a.tone === 'danger' ? 'alert' : a.tone === 'warning' ? 'time' : 'info'}>{count(a.count)}</Pill>
                    <span style={{ flex: 1 }}>{a.label}</span>
                    <Button size="sm" variant="ghost" icon="arrowRight" onClick={go} disabledReason={go ? undefined : 'Your role can’t open this page'}>
                      Open
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : (
          <Card>
            <Empty title="Nothing needs attention" icon="checkCircle">No waiting approvals, urgent safety cases, new cases, withdrawals or driver reviews right now.</Empty>
          </Card>
        )}
      </Section>

      <Section title="Growth and usage">
        <div className="grid cols-4">
          <Stat label="Completed trips" value={count(m.completedTrips)} sub={`${count(m.requestedTrips)} requested`} onClick={open('/trips')} />
          <Stat label="Active drivers" value={count(m.activeDrivers)} sub="Approved with active access now" onClick={open('/drivers')} />
          <Stat label="Active passengers" value={count(m.activePassengers)} sub="Took a trip in this period" onClick={open('/passengers')} />
          <Stat label="Repeat usage" value={pct(m.repeatShare)} sub={`${count(m.repeatPassengers)} passengers with 2 or more trips`} onClick={open('/passengers')} />
        </div>
      </Section>

      {seeMoney ? <MoneySection m={m} open={open} /> : (
        <Section title="Money">
          <Notice icon="lock">Money figures need finance or ledger access. Ask the company owner if you need them.</Notice>
        </Section>
      )}

      <Section title="Service quality">
        <div className="grid cols-4">
          <Stat label="Cancellation rate" value={pct(m.cancellationRate)} sub={`${count(m.cancelled)} cancelled`} onClick={open('/trips')} />
          <Stat label="Matching success" value={pct(m.matchingSuccess)} sub={`${count(m.noDriver)} found no driver`} onClick={open('/live')} />
          <Stat label="Unresolved support cases" value={count(m.unresolvedCases)} sub="Open now, all dates" onClick={open('/cases')} />
          <Stat label="Open safety cases" value={count(m.openSafety)} sub={m.urgentSafety ? `${count(m.urgentSafety)} urgent` : 'None urgent'} tone={m.urgentSafety ? 'danger' : undefined} onClick={open('/safety')} />
        </div>
      </Section>

      <div className="split section">
        <Card title={`Completed trips per day, last ${days} days`}>
          {daily.some((x) => x.count) ? (
            <>
              <Bars values={daily.map((x) => x.count)} highlight={daily.length - 1} label={`Completed trips per day: ${daily.map((x) => `${date(x.day)} ${x.count}`).join(', ')}`} />
              <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                <span>{date(daily[0]!.day)}</span>
                <span>{count(daily.reduce((s, x) => s + x.count, 0))} completed · today highlighted</span>
                <span>{date(daily.at(-1)!.day)}</span>
              </div>
            </>
          ) : (
            <Empty title="No completed trips in this period" icon="chart">Try a longer date range or another city.</Empty>
          )}
        </Card>
        <Card title="Lagos and Abuja">
          <CityBreakdown rows={byCity} seeMoney={seeMoney} />
          <div className="small muted" style={{ marginTop: 10 }}>Uses the date range; shows every city you can see, whatever the city filter.</div>
        </Card>
      </div>

      <Section title="Decisions and alerts">
        <div className="grid cols-2">
          <Card title={<span className="row">Pending approvals <Pill tone={pending.length ? 'warning' : 'success'}>{pending.length}</Pill></span>}>
            {pending.length ? (
              <div className="stack">
                {pending.slice(0, 5).map((a) => (
                  <div key={a.id} className="row small">
                    <Icon name="time" size={16} />
                    <span style={{ flex: 1 }}>
                      <span className="strong">{a.title}</span>
                      <span className="muted" style={{ display: 'block' }}>
                        {a.requestedBy.name} · {when(a.requestedAt, t)} · decided by {a.approverRoles.map((r) => ROLE_LABELS[r]).join(' or ')}
                      </span>
                    </span>
                  </div>
                ))}
                <div>
                  <Button size="sm" icon="arrowRight" onClick={open('/approvals')} disabledReason={open('/approvals') ? undefined : 'Your role can’t open approvals'}>
                    Review approvals
                  </Button>
                </div>
              </div>
            ) : (
              <Empty title="No decisions waiting" icon="checkCircle" />
            )}
          </Card>
          <Card title="Integration health">
            <div className="stack">
              <div className="row">
                <Pill tone="warning" icon="plugin">{alerts.notLive} of {alerts.total} not live</Pill>
                {alerts.degraded.length ? <Pill tone="danger">{alerts.degraded.length} degraded</Pill> : <Pill tone="success">None degraded</Pill>}
              </div>
              <div className="small muted">Every integration is prototype, configured or tested. Nothing here takes real payments or sends real messages yet.</div>
              {alerts.degraded.map((x) => (
                <div key={x.id} className="row small"><Icon name="alert" size={16} /> {x.label} is degraded</div>
              ))}
              {alerts.unresolvedFailures.length ? (
                alerts.unresolvedFailures.slice(0, 4).map((f, i) => (
                  <div key={i} className="row small"><Icon name="warning" size={16} /><span>{f.label}: {f.message} <span className="muted">({when(f.at, t)})</span></span></div>
                ))
              ) : (
                <div className="row small"><Icon name="checkCircle" size={16} /> No unresolved failures</div>
              )}
              <div>
                <Button size="sm" icon="arrowRight" onClick={open('/developer') ?? open('/payments')} disabledReason={open('/developer') || open('/payments') ? undefined : 'Your role can’t open integrations'}>
                  {open('/developer') ? 'Open integrations' : 'Open payments setup'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </Section>
    </>
  );
}

function MoneySection({ m, open }: { m: OverviewMetrics; open: (path: string) => (() => void) | undefined }) {
  return (
    <Section title="Money">
      <div className="stack" style={{ gap: 14 }}>
        <Notice icon="wallet">
          These four figures are kept apart and never added together. Wallet funding is money held for passengers to spend later, not revenue.
        </Notice>
        <div className="grid cols-4">
          <Stat label="Trip value" value={money(m.tripValue)} sub="Fares on completed trips; drivers keep them (0% commission)" onClick={open('/trips')} />
          <Stat label="Company revenue" value={money(m.companyRevenue)} sub={`Driver access packages · ${count(m.packagePurchases)} purchases`} onClick={open('/finance/collections')} />
          <Stat label="Wallet deposits" value={money(m.walletDeposits)} sub="Held for passengers, not revenue" onClick={open('/finance/wallets')} />
          <Stat label="Driver earnings" value={money(m.driverEarnings)} sub={`Credited to GoBye earnings${m.directToDriverTrips ? ` · ${count(m.directToDriverTrips)} paid directly, recorded only` : ''}`} onClick={open('/finance/earnings')} />
        </div>
        <div className="grid cols-4">
          <Stat label="Package renewals" value={count(m.packageRenewals)} sub="Drivers who bought more than once" onClick={open('/finance/collections')} />
          <Stat label="Collections" value={money(m.collections)} sub={`${count(m.collectionsCount)} successful payments received`} onClick={open('/finance/collections')} />
          <Stat label="Payouts" value={money(m.payouts)} sub="Driver withdrawals confirmed paid" onClick={open('/finance/withdrawals')} />
          <Stat label="Refunds" value={money(m.refunds)} sub="Completed refunds to passengers" onClick={open('/finance/refunds')} />
          <Stat label="Promotional spending" value={money(m.promotions)} sub="Referral rewards and promotions" onClick={open('/promos')} />
          <Stat label="Processing costs" value={money(m.processingCosts)} sub="Provider fees (test provider)" onClick={open('/finance/settlements')} />
        </div>
      </div>
    </Section>
  );
}

function CityBreakdown({ rows, seeMoney }: { rows: { city: CityId; m: OverviewMetrics }[]; seeMoney: boolean }) {
  const columns: Column<{ city: CityId; m: OverviewMetrics }>[] = [
    { key: 'city', label: 'City', render: (r) => <span className="strong">{CITY_LABELS[r.city]}</span> },
    { key: 'trips', label: 'Trips', align: 'right', render: (r) => <span className="num">{count(r.m.completedTrips)}</span> },
    { key: 'drivers', label: 'Drivers', align: 'right', render: (r) => <span className="num">{count(r.m.activeDrivers)}</span> },
    { key: 'cancel', label: 'Cancelled', align: 'right', render: (r) => <span className="num">{pct(r.m.cancellationRate)}</span> },
    ...(seeMoney ? [{ key: 'rev', label: 'Revenue', align: 'right' as const, render: (r: { m: OverviewMetrics }) => <span className="num">{money(r.m.companyRevenue)}</span> }] : []),
  ];
  return <Table rows={rows} columns={columns} rowKey={(r) => r.city} empty={<Empty title="No cities in your scope" />} />;
}
