import { payPerUseServices, type IntegrationRecord } from '@gobye/core';
import { count, money, when } from '@/data/format';
import { usePlatform } from '@/data/store';
import { HBars, Ring } from '@/ui/charts';
import { Pill } from '@/ui/kit';

/** Plain names: what the service does, then who provides it. */
const SERVICE_NAME: Partial<Record<IntegrationRecord['area'], string>> = {
  identity: 'Driver identity checks',
  sms: 'Sign in codes by SMS',
  email: 'Emails',
};
const providerOf = (i: IntegrationRecord) => (/^not chosen/i.test(i.provider) ? 'Provider not chosen yet' : i.provider.replace(/\s*\(.*\)$/, ''));
const nameOf = (i: IntegrationRecord) => SERVICE_NAME[i.area] ?? providerOf(i);
const unitWord = (label: string) => (label === 'sign in code' ? 'codes' : 'drivers');

const SOURCE: Record<'provider_api' | 'our_records' | 'simulated', string> = {
  provider_api: 'From the provider',
  our_records: 'From our records',
  simulated: 'Generated figures',
};

/** Compact rings for the stakeholder summary: money left and how far it goes. */
export function BalanceRings({ integrations }: { integrations: IntegrationRecord[] }) {
  const services = payPerUseServices(integrations);
  if (!services.length) return <p className="muted small">No pay per use services yet.</p>;
  return (
    <div className="balance-rings">
      {services.map(({ integration: i, usage: u, summary: s }) => (
        <div key={i.id} className="balance-ring">
          <Ring value={u.toppedUp ? s.balance / u.toppedUp : 0} label={`${nameOf(i)}: share of money left`} center={`${Math.round((u.toppedUp ? s.balance / u.toppedUp : 0) * 100)}%`} sub="left" size={96} tone={s.low ? 'var(--warning)' : 'var(--chart)'} />
          <div className="br-text">
            <span className="strong">{nameOf(i)}</span>
            <span className="br-big num">{money(s.balance)}</span>
            <span className="small muted">
              ≈ {count(s.bundlesLeft ?? 0)} more {u.bundle ? unitWord(u.bundle.label) : 'uses'}
            </span>
            {s.low ? <Pill tone="warning">Top up soon</Pill> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full cards for the Service balances page (D-068): ring, figures and uses by item. */
export function BalanceCards({ integrations }: { integrations: IntegrationRecord[] }) {
  const { now } = usePlatform();
  const t = now();
  const services = payPerUseServices(integrations);
  if (!services.length) return <p className="muted small">No pay per use services yet.</p>;
  return (
    <div className="panel-grid even">
      {services.map(({ integration: i, usage: u, summary: s }) => {
        const share = u.toppedUp > 0 ? s.balance / u.toppedUp : 0;
        return (
          <section key={i.id} className="panel" aria-label={`${nameOf(i)} balance`}>
            <div className="panel-head">
              <h3>
                {nameOf(i)} <span className="muted small">· {providerOf(i)}</span>
              </h3>
              {s.low ? <Pill tone="warning">Top up soon</Pill> : <Pill tone="success">Enough for now</Pill>}
            </div>
            <div className="balance-top">
              <Ring value={share} label={`${nameOf(i)}: share of money left`} center={money(s.balance)} sub="left" size={136} tone={s.low ? 'var(--warning)' : 'var(--chart)'} />
              <div className="figure-row" style={{ flexDirection: 'column', gap: 12 }}>
                <div>
                  <span className="f-label">Enough for about</span>
                  <span className="f-value">
                    {count(s.bundlesLeft ?? 0)} more {u.bundle ? (u.bundle.label === 'sign in code' ? 'sign in codes' : 'drivers fully checked') : 'uses'}
                  </span>
                </div>
                <div>
                  <span className="f-label">Spent this month</span>
                  <span className="f-value">
                    {money(s.spentThisMonth)} <span className="muted small">· {count(s.usesThisMonth)} uses</span>
                  </span>
                </div>
                <div>
                  <span className="f-label">Spent in total</span>
                  <span className="f-value">
                    {money(s.spent)} <span className="muted small">of {money(u.toppedUp)}</span>
                  </span>
                </div>
              </div>
            </div>
            <div>
              <div className="f-label small muted" style={{ marginBottom: 8 }}>Uses this month</div>
              <HBars label={`${nameOf(i)}: uses this month by item`} items={u.used.map((x) => ({ label: u.unitPrices.find((p) => p.item === x.item)?.label ?? x.item, value: x.thisMonth }))} />
            </div>
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="right">Price</th>
                  <th className="right">More possible</th>
                </tr>
              </thead>
              <tbody>
                {u.unitPrices.map((p) => (
                  <tr key={p.item}>
                    <td>{p.label}</td>
                    <td className="right num">{money(p.price)}</td>
                    <td className="right num">{count(s.left.find((l) => l.item === p.item)!.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="small muted">
              {SOURCE[u.source]} · {u.pricesConfirmed ? 'Prices confirmed' : 'Placeholder prices'} · {when(u.asOf, t)}
            </span>
          </section>
        );
      })}
    </div>
  );
}
