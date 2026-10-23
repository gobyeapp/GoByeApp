import { useNavigate } from 'react-router-dom';
import { COST_CATEGORY_LABEL, budgetUtilisation, monthKey, monthSpend, perUnit, projectedMonthEnd, spendByCategory, OPERATING_CATEGORIES } from '@gobye/core';
import { money, pct } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Dimensional } from '@/ui/Dimensional';
import { Card, Section, Stat, Table, type Column } from '@/ui/kit';
import { CostsHead, ExpenseStatusPill, FreePlanNote, RecordExpense, SpendBar, VendorStatusPill } from './parts';
import { INFRA_CATEGORIES, activeDriverCount, completedRidesIn, monthLabel, monthsWithSpend, operatingSummary, shortMonth } from './logic';

export default function CostDashboard() {
  const d = useData();
  const { now } = usePlatform();
  const navigate = useNavigate();
  const t = now();
  const month = monthKey(t);
  const s = operatingSummary(d, month);
  const util = budgetUtilisation(s.operating, s.budget);
  const projection = projectedMonthEnd(s.operating, t);
  const drivers = activeDriverCount(d, t);
  const rides = completedRidesIn(d, month);
  const perDriver = s.operating > 0 ? perUnit(s.operating, drivers) : null;
  const perRide = s.operating > 0 ? perUnit(s.operating, rides) : null;
  const byCat = spendByCategory(d.expenses, month);
  const maxCat = Math.max(0, ...byCat.map((c) => c.amount));
  const months = monthsWithSpend(d.expenses).slice(0, 6).reverse();
  const monthTotals = months.map((m) => ({ m, v: monthSpend(d.expenses, m, OPERATING_CATEGORIES) }));
  const maxMonth = Math.max(1, ...monthTotals.map((x) => x.v));
  const recorded = d.expenses.length > 0;
  const waiting = d.expenses.filter((e) => e.status === 'pending_approval');

  const vendorCols: Column<(typeof d.vendors)[number]>[] = [
    { key: 'name', label: 'Vendor', sortValue: (v) => v.name, render: (v) => <div><div className="cell-title">{v.name}</div><div className="cell-sub">{COST_CATEGORY_LABEL[v.category]}</div></div> },
    { key: 'plan', label: 'Plan', render: (v) => v.plan },
    { key: 'status', label: 'Status', render: (v) => <VendorStatusPill status={v.status} /> },
    { key: 'spend', label: monthLabel(month), align: 'right', sortValue: (v) => monthSpend(d.expenses.filter((e) => e.vendorId === v.id), month), render: (v) => <span className="num">{money(monthSpend(d.expenses.filter((e) => e.vendorId === v.id), month))}</span> },
  ];

  return (
    <>
      <CostsHead title="Cost dashboard" sub={`What it costs to run GoBye in ${monthLabel(month)}. Approved and paid expenses only; marketing is shown but kept out of the operating total.`} actions={<RecordExpense />} />

      {!recorded ? (
        <Card className="cost-intro">
          <div>
            <h2>No costs recorded yet</h2>
            <p>Services in use today are on free plans: Vercel for the website and dashboard, Cloudflare for the gateway and R2 storage, Supabase for the demo relay. Record an expense with its invoice when a bill arrives; it counts once approved.</p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <RecordExpense />
              <span className="small muted">No billing integration is connected, so nothing arrives on its own.</span>
            </div>
          </div>
          <div className="art" aria-hidden>
            <Dimensional name="server" size={120} />
            <Dimensional name="cloudStorage" size={104} />
          </div>
        </Card>
      ) : null}

      <Section title={monthLabel(month)} desc="Operating cost excludes marketing (agreed break-even rule).">
        <div className="grid cols-4">
          <Stat icon="chart" label="Total operating cost" value={money(s.operating)} sub={s.marketing ? `Marketing kept apart: ${money(s.marketing)}` : 'Approved and paid'} onClick={() => navigate('/costs/expenses')} />
          <Stat icon="server" label="Infrastructure spend" value={money(s.infra)} sub="Hosting, network, data, messaging, monitoring" />
          <Stat icon="balance" label="Budget used" value={util === null ? <span className="stat-text">No budget set</span> : pct(util)} tone={util !== null && util > 1 ? 'danger' : util !== null && util > 0.85 ? 'warning' : undefined} sub={s.budget ? `of ${money(s.budget.amount)}` : 'Set one in Budgets'} onClick={() => navigate('/costs/budgets')} />
          <Stat icon="calendar" label="Projected month end" value={projection === null ? <span className="stat-text">Not enough data</span> : money(projection)} sub="Estimate: straight line from spend so far" />
        </div>
        <div className="grid cols-4" style={{ marginTop: 16 }}>
          <Stat icon="steering" label="Cost per active driver" value={perDriver === null ? <span className="stat-text">No data</span> : money(perDriver)} sub={`${drivers.toLocaleString('en-NG')} drivers with active access`} />
          <Stat icon="route" label="Cost per completed ride" value={perRide === null ? <span className="stat-text">No data</span> : money(perRide)} sub={`${rides.toLocaleString('en-NG')} completed this month`} />
          <Stat icon="ticket" label="Subscription revenue" value={money(s.revenue)} sub="Driver passes verified this month" onClick={() => navigate('/costs/break-even')} />
          <Stat icon="receipt" label="Waiting approval" value={waiting.length.toLocaleString('en-NG')} tone={waiting.length ? 'warning' : undefined} sub={waiting.length ? money(waiting.reduce((a, e) => a + e.amount, 0)) : 'Nothing waiting'} onClick={() => navigate('/costs/expenses')} />
        </div>
      </Section>

      <div className="split section">
        <Card title="Spend by category">
          {byCat.length ? (
            <div className="spend-rows">
              {byCat.map((c) => (
                <div key={c.category} className="spend-row">
                  <span className="small">{COST_CATEGORY_LABEL[c.category]}{c.category === 'marketing' ? <span className="muted"> (not operating)</span> : null}</span>
                  <SpendBar value={c.amount} max={maxCat} label={`${COST_CATEGORY_LABEL[c.category]} ${money(c.amount)}`} />
                  <span className="num strong">{money(c.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="stack">
              <div className="muted">No approved spend in {monthLabel(month)}.</div>
              <FreePlanNote />
            </div>
          )}
        </Card>
        <Card title="Operating cost by month">
          {monthTotals.length ? (
            <>
              <div className="month-bars" role="img" aria-label={monthTotals.map((x) => `${monthLabel(x.m)} ${money(x.v)}`).join(', ')}>
                {monthTotals.map((x) => (
                  <div key={x.m} className="mb" title={`${monthLabel(x.m)}: ${money(x.v)}`}>
                    <span style={{ height: `${(x.v / maxMonth) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="month-axis">{monthTotals.map((x) => <span key={x.m}>{shortMonth(x.m)}</span>)}</div>
            </>
          ) : (
            <div className="muted">A trend appears once there are approved expenses in more than one month.</div>
          )}
        </Card>
      </div>

      <Section title="Vendors" desc="Every service GoBye uses or plans to, with its plan today." actions={<a className="btn ghost sm" href="#/costs/vendors">Manage vendors</a>}>
        <Card flush>
          <Table rows={d.vendors} columns={vendorCols} rowKey={(v) => v.id} caption="Vendors" />
        </Card>
      </Section>

      {recorded ? (
        <Section title="Latest expenses">
          <Card flush>
            <Table
              rows={d.expenses.slice(0, 6)}
              rowKey={(e) => e.id}
              onRowClick={() => navigate('/costs/expenses')}
              columns={[
                { key: 'd', label: 'Expense', render: (e) => <div><div className="cell-title">{e.description}</div><div className="cell-sub">{d.vendors.find((v) => v.id === e.vendorId)?.name} · {monthLabel(e.month)}</div></div> },
                { key: 's', label: 'Status', render: (e) => <ExpenseStatusPill status={e.status} /> },
                { key: 'a', label: 'Amount', align: 'right', render: (e) => <span className="num strong">{money(e.amount)}</span> },
              ]}
            />
          </Card>
        </Section>
      ) : null}
      <div className="small muted" style={{ marginTop: 24 }}>Infrastructure categories: {INFRA_CATEGORIES.map((c) => COST_CATEGORY_LABEL[c]).join(', ')}.</div>
    </>
  );
}
