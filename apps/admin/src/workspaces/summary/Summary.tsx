import { monthKey } from '@gobye/core';
import { count, money } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { BalanceCards } from '@/workspaces/costs/BalanceCards';
import { activeDriverCount, completedRidesIn, monthLabel, operatingSummary } from '@/workspaces/costs/logic';
import { Card, Notice, PageHead, Pill, Stat } from '@/ui/kit';

/**
 * Business summary (D-068): the stakeholder's page. Plain words, no technical terms, nothing to change.
 * Every figure here is computed from the same records the staff pages use.
 */
export default function Summary() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const month = monthKey(t);
  const s = operatingSummary(d, month);
  const drivers = activeDriverCount(d, t);
  const rides = completedRidesIn(d, month);
  const waiting = d.drivers.filter((x) => x.verification === 'applied' || x.verification === 'documents_pending' || x.verification === 'in_review').length;
  const coverage = s.breakEven.coverage;

  return (
    <>
      <PageHead
        eyebrow="Stakeholder"
        title="Business summary"
        sub={`How GoBye is doing in ${monthLabel(month)}, in plain words.`}
        meta={
          <>
            <Pill tone="neutral" icon="eye">View only</Pill>
            <Pill tone="neutral">Test data until launch</Pill>
          </>
        }
      />
      <Notice tone="info">You can see everything on this page but you cannot change anything. Staff and the technical team make changes, and every change is recorded.</Notice>

      <div className="section grid cols-4">
        <Stat icon="steering" label="Drivers able to drive" value={count(drivers)} sub={`${count(waiting)} more waiting for checks`} />
        <Stat icon="route" label="Rides completed" value={count(rides)} sub={`In ${monthLabel(month)}`} />
        <Stat icon="wallet" label="Money in" value={money(s.revenue)} sub="Driver passes paid this month" />
        <Stat icon="receipt" label="Running costs" value={money(s.operating)} sub="Services and tools this month" />
      </div>

      <div className="section">
        <Card title="Are the costs covered?">
          {coverage === null ? (
            <p>No running costs recorded for this month yet.</p>
          ) : coverage >= 1 ? (
            <p>
              <strong>Yes.</strong> Driver passes brought in {money(s.revenue)}, more than the {money(s.operating)} it cost to run GoBye this month.
            </p>
          ) : (
            <p>
              <strong>Not yet.</strong> Driver passes brought in {money(s.revenue)} against {money(s.operating)} of running costs, a gap of {money(s.breakEven.gap)}. About {count(s.breakEven.monthlyPassesNeeded)} monthly passes cover all of it.
            </p>
          )}
        </Card>
      </div>

      <div className="section">
        <Card title="Pay per use services">
          <p className="muted small">Money left with each service and how far it goes.</p>
          <BalanceCards integrations={d.integrations} showPrices={false} />
        </Card>
      </div>
    </>
  );
}
