import { DRIVER_ACCESS_PACKAGES, PLANNED_TECH_COST_MONTH, driversToCover, monthKey, type Kobo } from '@gobye/core';
import { count, money } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { BarChart, Donut, Kpi, Ring, Sparkline } from '@/ui/charts';
import { PageHead, Pill } from '@/ui/kit';
import { BalanceRings } from '@/workspaces/costs/BalanceCards';
import { activeDriverCount, completedRidesIn, operatingSummary, recentMonths, shortMonth, subscriptionRevenue } from '@/workspaces/costs/logic';

const DAY = 86_400_000;
const naira0 = (k: number) => `₦${Math.round(k / 100).toLocaleString('en-NG')}`;
const compact = (k: number) => (k >= 100_000_000 ? `₦${(k / 100_000_000).toFixed(1)}m` : k >= 100_000 ? `₦${Math.round(k / 100_000)}k` : naira0(k));

/**
 * Business summary (D-068, D-069): the stakeholder's page. Figures and charts first, very little text,
 * nothing to change. Running cost falls back to the planned budget until real bills are entered.
 */
export default function Summary() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const month = monthKey(t);
  const s = operatingSummary(d, month);
  const months = recentMonths(t, 6);
  const revenue = months.map((m) => subscriptionRevenue(d, m));
  const actualCost = months.map((m) => operatingSummary(d, m).operating);
  const cost = actualCost.map((c) => (c > 0 ? c : PLANNED_TECH_COST_MONTH));
  const costNow = (s.operating > 0 ? s.operating : PLANNED_TECH_COST_MONTH) as Kobo;
  const planned = s.operating === 0;
  const coverage = costNow > 0 ? s.revenue / costNow : 0;
  const monthly = DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'monthly')!.price;

  const days = Array.from({ length: 14 }, (_, i) => t - (13 - i) * DAY);
  const ridesPerDay = days.map((day) => d.trips.filter((x) => x.status === 'completed' && x.completedAt && Math.floor(x.completedAt / DAY) === Math.floor(day / DAY)).length);
  const rides = completedRidesIn(d, month);

  const active = activeDriverCount(d, t);
  const approved = d.drivers.filter((x) => x.verification === 'approved').length;
  const waiting = d.drivers.filter((x) => ['applied', 'documents_pending', 'in_review'].includes(x.verification)).length;
  const stopped = d.drivers.filter((x) => x.verification === 'rejected' || x.verification === 'suspended').length;

  return (
    <>
      <PageHead
        eyebrow="Stakeholder"
        title="Business summary"
        meta={
          <>
            <Pill tone="neutral" icon="eye">View only</Pill>
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Money in this month" value={compact(s.revenue)} foot="Driver passes" spark={<Sparkline values={revenue} label="Money in, last 6 months" />} />
        <Kpi label="Running costs" value={compact(costNow)} foot={planned ? 'Planned budget' : 'Bills entered'} />
        <Kpi label="Rides completed" value={count(rides)} foot="This month" spark={<Sparkline values={ridesPerDay} label="Rides per day, last 14 days" />} />
        <Kpi label="Drivers able to drive" value={count(active)} foot={`${count(waiting)} waiting for checks`} />
      </div>

      <div className="section panel-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Money in vs running costs</h3>
            <span className="aside">Last 6 months</span>
          </div>
          <BarChart
            labels={months.map(shortMonth)}
            series={[
              { label: 'Money in', color: 'var(--chart)', values: revenue },
              { label: planned ? 'Running costs (planned)' : 'Running costs', color: 'var(--chart-alt)', values: cost, line: true },
            ]}
            label="Money in and running costs by month"
            format={naira0}
          />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Costs covered</h3>
            <span className="aside">This month</span>
          </div>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <Ring value={coverage} label="Share of running costs covered by money in" center={`${Math.round(coverage * 100)}%`} sub={coverage >= 1 ? 'Covered' : 'Not yet'} size={150} tone={coverage >= 1 ? 'var(--success)' : 'var(--chart-alt)'} />
          </div>
          <div className="figure-row" style={{ justifyContent: 'center' }}>
            <div>
              <span className="f-label">Break even</span>
              <span className="f-value">{count(driversToCover(costNow, monthly))} monthly passes</span>
            </div>
            <div>
              <span className="f-label">Gap</span>
              <span className="f-value">{money(Math.max(0, costNow - s.revenue))}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="section panel-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Rides per day</h3>
            <span className="aside">Last 14 days</span>
          </div>
          <BarChart labels={days.map((x) => new Date(x).toLocaleDateString('en-NG', { day: 'numeric', timeZone: 'Africa/Lagos' }))} series={[{ label: 'Completed rides', color: 'var(--chart)', values: ridesPerDay }]} label="Completed rides per day" height={170} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Drivers</h3>
            <span className="aside">{count(d.drivers.length)} registered</span>
          </div>
          <Donut
            label="Drivers by status"
            center={count(active)}
            sub="driving"
            slices={[
              { label: 'Driving (pass active)', value: active, color: 'var(--chart)' },
              { label: 'Approved, no pass', value: approved - active, color: 'var(--chart-2)' },
              { label: 'Waiting for checks', value: waiting, color: 'var(--chart-alt)' },
              { label: 'Rejected or suspended', value: stopped, color: 'var(--chart-3)' },
            ]}
          />
        </section>
      </div>

      <section className="section panel">
        <div className="panel-head">
          <h3>Pay per use services</h3>
          <span className="aside">Money left</span>
        </div>
        <BalanceRings integrations={d.integrations} />
      </section>
    </>
  );
}
