import { payPerUseServices, type IntegrationRecord } from '@gobye/core';
import { count, money, when } from '@/data/format';
import { usePlatform } from '@/data/store';
import { Card, Meter, Pill } from '@/ui/kit';

const SOURCE: Record<'provider_api' | 'our_records' | 'simulated', string> = {
  provider_api: 'From the provider’s balance',
  our_records: 'Worked out from our own records',
  simulated: 'Simulated figures',
};

/** Pay per use services in plain words (D-068): money left, spent this month, and how many more uses it pays for. */
export function BalanceCards({ integrations, showPrices = true }: { integrations: IntegrationRecord[]; showPrices?: boolean }) {
  const { now } = usePlatform();
  const t = now();
  const services = payPerUseServices(integrations);
  if (!services.length) return <p className="muted small">No pay per use services yet.</p>;
  return (
    <div className="grid cols-2">
      {services.map(({ integration: i, usage: u, summary: s }) => {
        const name = i.provider.replace(/\s*\(.*\)$/, '');
        const share = u.toppedUp > 0 ? s.balance / u.toppedUp : 0;
        return (
          <Card key={i.id} title={<span>{name}</span>} actions={s.low ? <Pill tone="warning">Top up soon</Pill> : <Pill tone="success">Enough for now</Pill>}>
            <div className="balance-card" aria-label={`${name} balance`}>
              <div className="balance-big">{money(s.balance)} <span className="muted small">left</span></div>
              <Meter value={share} label={`${name}: share of money paid in that is left`} />
              {s.bundlesLeft !== undefined && u.bundle ? (
                <p className="strong">
                  Enough for about {count(s.bundlesLeft)} more {u.bundle.label === 'sign in code' ? 'sign in codes' : `drivers fully checked`}
                </p>
              ) : null}
              <p className="small">
                Spent this month: {money(s.spentThisMonth)} ({count(s.usesThisMonth)} {s.usesThisMonth === 1 ? 'use' : 'uses'}) · Spent in total: {money(s.spent)} of {money(u.toppedUp)} paid in
              </p>
              {showPrices ? (
                <ul className="small balance-prices">
                  {u.unitPrices.map((p) => {
                    const left = s.left.find((l) => l.item === p.item)!;
                    return (
                      <li key={p.item}>
                        {p.label}: {money(p.price)} each · {count(left.count)} more possible
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <p className="muted small">
                {SOURCE[u.source]} · {u.pricesConfirmed ? 'Prices confirmed' : 'Placeholder prices until the provider sends a quote'} · As of {when(u.asOf, t)}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
