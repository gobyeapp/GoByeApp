import { useState } from 'react';
import { DRIVER_ACCESS_PACKAGES, monthKey } from '@gobye/core';
import { money, pct } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Card, Empty, KV, Notice, Section, Select, Stat } from '@/ui/kit';
import { CostsHead, RecordExpense } from './parts';
import { monthLabel, operatingSummary, recentMonths } from './logic';

export default function BreakEven() {
  const d = useData();
  const { now } = usePlatform();
  const [month, setMonth] = useState(monthKey(now()));
  const s = operatingSummary(d, month);
  const b = s.breakEven;
  const daily = DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'daily')!;
  const monthly = DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'monthly')!;
  const covered = b.coverage === null ? null : Math.min(b.coverage, 1);

  return (
    <>
      <CostsHead title="Break-even" sub="Operating cost against driver subscription revenue. GoBye earns no trip commission, so passes are the only revenue counted here." />
      <div className="row" style={{ marginBottom: 16 }}>
        <Select label="Month" value={month} onChange={setMonth} options={recentMonths(now(), 6).reverse().map((m) => ({ value: m, label: monthLabel(m) }))} />
      </div>
      <div className="grid cols-4">
        <Stat icon="chart" label="Operating cost" value={money(b.operatingCost)} sub="Approved and paid, marketing excluded" />
        <Stat icon="ticket" label="Subscription revenue" value={money(b.subscriptionRevenue)} sub="Daily and monthly passes verified" />
        <Stat icon="balance" label="Coverage" value={b.coverage === null ? <span className="stat-text">No costs recorded</span> : pct(b.coverage)} tone={b.coverage !== null && b.coverage < 1 ? 'warning' : undefined} sub="Revenue as a share of cost" />
        <Stat icon="exchange" label="Gap to break even" value={b.operatingCost ? money(b.gap) : <span className="stat-text">No costs recorded</span>} sub={b.operatingCost && !b.gap ? 'Costs covered' : 'Revenue still needed'} />
      </div>

      {b.operatingCost ? (
        <Section title="What covers the cost" desc={`At the confirmed prices: daily ${money(daily.price)} for 24 hours, monthly ${money(monthly.price)} for 30 days.`}>
          <Card>
            <div className="be-scale" role="img" aria-label={`Revenue covers ${pct(covered ?? 0)} of operating cost`}>
              <span style={{ width: `${(covered ?? 0) * 100}%` }} />
            </div>
            <div className="be-legend"><span>{money(b.subscriptionRevenue)} revenue</span><span>{money(b.operatingCost)} cost</span></div>
            <div className="be-grid" style={{ marginTop: 20 }}>
              <div>
                <div className="small muted">Monthly passes needed</div>
                <div className="cost-big">{b.monthlyPassesNeeded.toLocaleString('en-NG')}</div>
                <div className="small muted">to cover {monthLabel(month)} on monthly passes alone</div>
              </div>
              <div>
                <div className="small muted">Or daily passes needed</div>
                <div className="cost-big">{b.dailyPassesNeeded.toLocaleString('en-NG')}</div>
                <div className="small muted">driver days in the month</div>
              </div>
              <KV items={[['Marketing (excluded)', money(s.marketing)], ['Trip commission', '0%']]} />
            </div>
          </Card>
        </Section>
      ) : (
        <Card className="section">
          <Empty title={`No operating costs recorded for ${monthLabel(month)}`} art="analytics" action={<RecordExpense variant="secondary" />}>
            Break-even needs real costs. Services in use are on free plans today; record bills as they arrive.
          </Empty>
        </Card>
      )}
      <div className="section">
        <Notice tone="info">Marketing is excluded from the agreed operating break-even. Revenue counts only passes verified with the payment provider (test data in this prototype).</Notice>
      </div>
    </>
  );
}
