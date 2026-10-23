import { useState } from 'react';
import { CITY_LABELS, type CityId } from '@gobye/core';
import { count, money, pct } from '@/data/format';
import { RANGE_MS, useFilters, useScopedFilter, useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { ActivityFeed, AttentionList, Button, Card, Empty, FeaturedStat, LAGOS, PageHead, Pill, Section, Segmented, Stat } from '@/ui/kit';
import '../home/home.css';
import { homeAttention, platformActivity, recentActivity, rideActivity } from '../home/insights';
import { RideChart, type ChartView } from '../home/RideChart';
import { greeting, useOpener } from '../home/useOpener';
import { overviewMetrics, type Keep, type OverviewMetrics } from './logic';

const RANGE_TEXT = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' } as const;
type Period = '7' | '14' | '30';

export default function Overview() {
  const d = useData();
  const { now } = usePlatform();
  const { staff, can, inScope } = useSession();
  const { city, range } = useFilters();
  const keepRow = useScopedFilter();
  const open = useOpener();
  const [view, setView] = useState<ChartView>('volume');
  const [period, setPeriod] = useState<Period>('14');
  const t = now();

  const here = (c: CityId) => inScope(c) && (city === 'all' || city === c);
  const inRange = (at: number | undefined) => at === undefined || t - at <= RANGE_MS[range];
  const keep: Keep = (c, at) => (c ? keepRow(c, at, t) : city === 'all' && !staff?.cities.length && inRange(at));
  const m = overviewMetrics(d, keep, t);
  const act = platformActivity(d, t, inScope, city, RANGE_MS[range], RANGE_TEXT[range]);
  const points = rideActivity(d.trips, t, Number(period), (x) => here(x.city));
  const totals = points.reduce((s, p) => ({ requested: s.requested + p.requested, completed: s.completed + p.completed, negotiated: s.negotiated + p.negotiated }), { requested: 0, completed: 0, negotiated: 0 });
  const attention = homeAttention(d, t, here);
  const feed = recentActivity(d, t, here).filter((e) => can(e.needs)).slice(0, 7);
  const byCity = (['lagos', 'abuja'] as CityId[]).filter(inScope).map((c) => ({ city: c, m: overviewMetrics(d, (rc, at) => rc === c && inRange(at), t) }));
  const pendingApprovals = d.approvals.filter((a) => a.status === 'pending').length;
  const seeMoney = can('finance.view') || can('ledger.view');
  const scopeText = `${city === 'all' ? (staff?.cities.length ? 'Your cities' : 'Lagos and Abuja') : CITY_LABELS[city]} · ${RANGE_TEXT[range]}`;
  const reviewApprovals = can('approvals.view') ? open('/approvals') : undefined;

  return (
    <>
      <PageHead
        eyebrow={new Date(t).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: LAGOS })}
        title={greeting(t)}
        sub="Here’s what’s happening across GoBye today."
        meta={
          <>
            <Pill tone="brand" icon="mapPin">{scopeText}</Pill>
            <Pill tone="neutral" icon="info">Test data</Pill>
          </>
        }
        actions={
          reviewApprovals ? (
            <Button variant="primary" icon="checkCircle" onClick={reviewApprovals}>
              Review approvals{pendingApprovals ? ` (${pendingApprovals})` : ''}
            </Button>
          ) : null
        }
      />

      <Section title="Platform activity" desc="Live counts are the current state; completed rides follow the date range.">
        <div className="grid featured">
          <FeaturedStat
            label="Active rides"
            value={count(act.activeRides)}
            art="activeTrips"
            sub={act.activeByStatus.length ? act.activeByStatus.map((s) => `${s.n} ${s.label.toLowerCase()}`).join(' · ') : 'No rides in progress'}
            onClick={open('/live')}
          />
          <Stat label="Completed rides" icon="checkCircle" value={count(act.completed)} trend={act.completedTrend} sub={act.completedTrend ? undefined : RANGE_TEXT[range]} onClick={open('/trips')} />
          <Stat label="Available drivers" icon="steering" value={count(act.availableDrivers)} sub={`${count(act.busyDrivers)} on a trip · simulated status`} onClick={open('/live')} />
          <Stat
            label="Pending ride requests"
            icon="radar"
            value={count(act.pendingRequests)}
            tone={act.oldestPendingMin && act.oldestPendingMin > 5 ? 'warning' : undefined}
            sub={act.oldestPendingMin !== undefined ? `Oldest waiting ${act.oldestPendingMin} min` : 'Nobody waiting'}
            onClick={open('/live')}
          />
        </div>
      </Section>

      <Section title="Ride activity">
        <div className="home-grid">
          <Card>
            <div className="row wrap" style={{ gap: 12, marginBottom: 18 }}>
              <Segmented<ChartView> label="Chart" value={view} onChange={setView} options={[{ value: 'volume', label: 'Requests' }, { value: 'mode', label: 'Booking mode' }]} />
              <span style={{ marginLeft: 'auto' }}>
                <Segmented<Period> label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} />
              </span>
            </div>
            {totals.requested ? (
              <>
                <div className="rc-summary" style={{ marginBottom: 14 }}>
                  <div><div className="k">Ride requests</div><div className="v">{count(totals.requested)}</div></div>
                  <div><div className="k">Completed</div><div className="v">{count(totals.completed)}</div></div>
                  <div><div className="k">Negotiated share</div><div className="v">{pct(totals.negotiated / totals.requested)}</div></div>
                </div>
                <RideChart points={points} view={view} />
              </>
            ) : (
              <Empty title="No ride requests in this period" art="navigationPath">Try a longer period or another city.</Empty>
            )}
          </Card>
          <Card title="By city" actions={<span className="small muted">{RANGE_TEXT[range]}</span>}>
            {byCity.length ? (
              <div>
                {byCity.map((r) => (
                  <div key={r.city} className="city-row">
                    <span>
                      <span className="strong" style={{ display: 'block' }}>{CITY_LABELS[r.city]}</span>
                      <span className="cell-sub">{pct(r.m.cancellationRate)} cancelled · {pct(r.m.matchingSuccess)} matched</span>
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span className="strong num" style={{ display: 'block' }}>{count(r.m.completedTrips)}</span>
                      <span className="cell-sub">rides</span>
                    </span>
                    <span style={{ textAlign: 'right', minWidth: 56 }}>
                      <span className="strong num" style={{ display: 'block' }}>{count(r.m.activeDrivers)}</span>
                      <span className="cell-sub">drivers</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No cities in your scope" icon="mapPin" />
            )}
          </Card>
        </div>
      </Section>

      <div className="home-grid section">
        <section aria-labelledby="attn-h">
          <div className="panel-head"><h2 id="attn-h">Operational attention</h2></div>
          <Card flush>
            <AttentionList
              items={attention.map((a) => {
                const go = open(a.path);
                return { key: a.key, title: a.title, count: a.count, severity: a.severity, context: a.context, action: { label: a.action, onClick: go, disabledReason: go ? undefined : 'Your role can’t open this page' } };
              })}
              empty={<Empty title="Nothing needs attention" art="completedTrips">No unmatched requests, safety incidents, escalations or reviews waiting.</Empty>}
            />
          </Card>
        </section>
        <section aria-labelledby="feed-h">
          <div className="panel-head"><h2 id="feed-h">Recent activity</h2></div>
          <Card flush>
            <ActivityFeed now={t} items={feed.map((e) => ({ key: e.key, at: e.at, icon: e.icon, title: e.title, detail: e.detail }))} />
          </Card>
        </section>
      </div>

      {seeMoney ? <MoneySection m={m} open={open} /> : null}
    </>
  );
}

function MoneySection({ m, open }: { m: OverviewMetrics; open: (path: string) => (() => void) | undefined }) {
  return (
    <Section title="Revenue and money" desc="Kept apart and never added together. GoBye earns from driver subscriptions only; it takes no trip commission.">
      <div className="grid cols-4">
        <Stat label="Subscription revenue" icon="ticket" value={money(m.companyRevenue)} sub={`${count(m.packagePurchases)} driver passes · ₦2,000 daily, ₦60,000 monthly`} onClick={open('/subscriptions') ?? open('/finance/collections')} />
        <Stat label="Wallet funding received" icon="wallet" value={money(m.walletDeposits)} sub="Held for passengers, not revenue" onClick={open('/finance/wallets')} />
        <Stat label="Trip value" icon="route" value={money(m.tripValue)} sub="Fares drivers keep in full, not GoBye revenue" onClick={open('/trips')} />
        <Stat label="Driver earnings credited" icon="steering" value={money(m.driverEarnings)} sub={m.directToDriverTrips ? `${count(m.directToDriverTrips)} paid directly, recorded only` : 'Credited to GoBye earnings'} onClick={open('/finance/earnings')} />
      </div>
    </Section>
  );
}
