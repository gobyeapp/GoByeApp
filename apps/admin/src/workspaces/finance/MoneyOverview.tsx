import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CityId, CollectionRecord, WithdrawalRecord } from '@gobye/core';
import { count, money } from '@/data/format';
import { RANGE_MS, useFilters } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { ActivityFeed, Card, FeaturedStat, Notice, Section, Stat, type FeedItem, type TrendValue } from '@/ui/kit';
import { cityIndex, payerCity } from './logic';
import { FinanceHead, useInclude } from './parts';

const DAY = 86_400_000;
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

/** Change against the previous equal window, only when both windows are finite and the earlier one had activity. */
function trendOf(cur: number, prev: number, vs: string, prevCount: number, goodWhen: 'up' | 'down' = 'up'): TrendValue | undefined {
  // Too few earlier records makes a percentage meaningless (test data starts 30 days back): show none.
  if (!prev || prevCount < 5) return undefined;
  return { delta: (cur - prev) / prev, vs, goodWhen };
}

/**
 * Money overview (brief §19): wallet activity, pending and failed money, and GoBye's own revenue kept
 * apart from the money it only holds or passes on. 0% trip commission: trip fares are never revenue.
 */
export default function MoneyOverview() {
  const d = useData();
  const { now } = usePlatform();
  const navigate = useNavigate();
  const include = useInclude();
  const { range } = useFilters();
  const t = now();
  const ix = useMemo(() => cityIndex(d), [d]);
  const drvCity = useMemo(() => new Map(d.drivers.map((x) => [x.id, x.city as CityId])), [d.drivers]);
  const cityOfC = (c: CollectionRecord) => payerCity(ix, c);
  const cityOfW = (w: WithdrawalRecord) => drvCity.get(w.driverId);

  const cols = d.collections.filter((c) => include(cityOfC(c), c.createdAt));
  const wds = d.withdrawals.filter((w) => include(cityOfW(w), w.requestedAt));
  const ok = (c: CollectionRecord) => c.status === 'successful';
  const funding = cols.filter((c) => c.purpose === 'wallet_funding' && ok(c));
  const passes = cols.filter((c) => c.purpose === 'package_purchase' && ok(c));
  const paidOut = wds.filter((w) => w.status === 'successful');
  const pendingC = cols.filter((c) => c.status === 'pending' || c.status === 'initiated');
  const pendingW = wds.filter((w) => w.status === 'requested' || w.status === 'under_review' || w.status === 'processing');
  const failedC = cols.filter((c) => c.status === 'failed' || c.status === 'abandoned');
  const failedW = wds.filter((w) => w.status === 'failed' || w.status === 'reversed');
  // Wallet volume: every movement in passenger wallets (in and out) within the window.
  const walletMoves = d.ledger.filter((e) => e.account.kind === 'passenger_wallet' && t - e.at <= RANGE_MS[range]);
  const walletVolume = walletMoves.reduce((s, e) => s + Math.abs(e.amount), 0);
  const feeIncome = d.ledger.filter((e) => e.account.kind === 'fee_income' && t - e.at <= RANGE_MS[range]).reduce((s, e) => s + e.amount, 0);

  // Previous equal window for trends (not for "all time").
  const win = RANGE_MS[range];
  const prevOk = Number.isFinite(win);
  const inPrev = (at: number) => prevOk && t - at > win && t - at <= 2 * win;
  const prevFundingRows = d.collections.filter((c) => c.purpose === 'wallet_funding' && ok(c) && inPrev(c.createdAt));
  const prevPassRows = d.collections.filter((c) => c.purpose === 'package_purchase' && ok(c) && inPrev(c.createdAt));
  const vs = range === 'today' ? 'vs yesterday' : range === '7d' ? 'vs previous 7 days' : 'vs previous 30 days';

  // Calm 14-day activity: funding in, payouts out.
  const days = Array.from({ length: 14 }, (_, i) => {
    const end = Math.floor((t + 3_600_000) / DAY) * DAY + DAY - 3_600_000 - (13 - i) * DAY;
    const start = end - DAY;
    const inDay = (at?: number) => at !== undefined && at >= start && at < end;
    return {
      start,
      fundIn: sum(d.collections.filter((c) => c.purpose === 'wallet_funding' && ok(c) && inDay(c.verifiedAt ?? c.createdAt) && include(cityOfC(c), undefined))),
      out: sum(d.withdrawals.filter((w) => w.status === 'successful' && inDay(w.history.at(-1)?.at) && include(cityOfW(w), undefined))),
    };
  });
  const max = Math.max(1, ...days.flatMap((x) => [x.fundIn, x.out]));
  const dayLabel = (ms: number) => new Date(ms + 3_600_000).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const names = useMemo(() => new Map([...d.passengers.map((p) => [p.id, p.name] as const), ...d.drivers.map((x) => [x.id, x.name] as const)]), [d.passengers, d.drivers]);
  const feed: FeedItem[] = [
    ...cols.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((c) => ({
      key: c.id,
      at: c.verifiedAt ?? c.createdAt,
      icon: c.purpose === 'package_purchase' ? ('ticket' as const) : c.purpose === 'wallet_funding' ? ('wallet' as const) : ('exchange' as const),
      title: `${c.purpose === 'package_purchase' ? 'Driver pass' : c.purpose === 'wallet_funding' ? 'Wallet funding' : 'Trip payment'} · ${money(c.amount)}`,
      detail: names.get(c.payerId) ?? c.payerId,
      status: { tone: c.status === 'successful' ? ('success' as const) : c.status === 'pending' || c.status === 'initiated' ? ('warning' as const) : ('danger' as const), text: c.status === 'successful' ? 'Verified' : c.status === 'pending' || c.status === 'initiated' ? 'Pending' : 'Failed' },
    })),
    ...wds.slice().sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 4).map((w) => ({
      key: w.id,
      at: w.history.at(-1)?.at ?? w.requestedAt,
      icon: 'bank' as const,
      title: `Withdrawal · ${money(w.amount)}`,
      detail: names.get(w.driverId) ?? w.driverId,
      status: { tone: w.status === 'successful' ? ('success' as const) : w.status === 'failed' || w.status === 'reversed' ? ('danger' as const) : ('warning' as const), text: w.status === 'successful' ? 'Paid' : w.status.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()) },
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);

  return (
    <>
      <FinanceHead title="Money overview" sub="Wallet activity, money in flight and GoBye’s own revenue, kept apart. GoBye takes no trip commission." />

      <Section title="Wallets">
        <div className="grid featured money-grid">
          <FeaturedStat label="Wallet transaction volume" value={money(walletVolume)} sub="Money in and out of passenger wallets" art="wallet" onClick={() => navigate('/finance/wallets')} />
          <Stat icon="wallet" label="Funding received" value={money(sum(funding))} sub={`${count(funding.length)} verified payments`} trend={trendOf(sum(funding), sum(prevFundingRows), vs, prevFundingRows.length)} onClick={() => navigate('/finance/collections')} />
          <Stat icon="bank" label="Paid out to drivers" value={money(sum(paidOut))} sub={`${count(paidOut.length)} withdrawals confirmed`} onClick={() => navigate('/finance/withdrawals')} />
          <Stat icon="time" label="Pending" value={count(pendingC.length + pendingW.length)} tone={pendingC.length + pendingW.length ? 'warning' : undefined} sub={`${money(sum(pendingC) + sum(pendingW))} not settled yet`} onClick={() => navigate('/payments/operations')} />
        </div>
      </Section>

      <Section title="GoBye revenue" desc="Only what GoBye earns. Wallet balances belong to passengers; trip fares go to drivers in full.">
        <div className="grid cols-4">
          <Stat icon="ticket" label="Driver subscriptions" value={money(sum(passes))} sub={`${count(passes.length)} passes verified`} trend={trendOf(sum(passes), sum(prevPassRows), vs, prevPassRows.length)} onClick={() => navigate('/subscriptions')} />
          <Stat icon="receipt" label="Fee revenue" value={money(feeIncome)} sub="No fee schedule approved yet" onClick={() => navigate('/payments/fees')} />
          <Stat icon="alert" label="Failed" value={count(failedC.length + failedW.length)} tone={failedC.length + failedW.length ? 'danger' : undefined} sub={`${count(failedC.length)} payments · ${count(failedW.length)} payouts`} onClick={() => navigate('/finance/collections')} />
          <Stat icon="exchange" label="Trip commission" value="0%" sub="Drivers keep the full fare" />
        </div>
      </Section>

      <div className="split section">
        <Card title="Last 14 days" actions={<div className="legend"><span><i style={{ background: 'var(--chart)' }} />Funding in</span><span><i style={{ background: 'var(--chart-2)' }} />Paid out</span></div>}>
          {days.some((x) => x.fundIn || x.out) ? (
            <>
              <div className="pair-bars" role="img" aria-label={days.map((x) => `${dayLabel(x.start)}: in ${money(x.fundIn)}, out ${money(x.out)}`).join('; ')}>
                {days.map((x) => (
                  <div key={x.start} className="pb" title={`${dayLabel(x.start)}: in ${money(x.fundIn)}, out ${money(x.out)}`}>
                    <span className="in" style={{ height: `${(x.fundIn / max) * 100}%` }} />
                    <span className="out" style={{ height: `${(x.out / max) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                <span>{dayLabel(days[0]!.start)}</span>
                <span>Lagos time · test data</span>
                <span>{dayLabel(days.at(-1)!.start)}</span>
              </div>
            </>
          ) : (
            <div className="muted">No wallet funding or payouts in the last 14 days.</div>
          )}
        </Card>
        <Card title="Recent money activity" flush>
          <ActivityFeed items={feed} now={t} />
        </Card>
      </div>

      <div className="section">
        <Notice tone="info">Figures come from test collections and withdrawals verified with Paystack (test).</Notice>
      </div>
    </>
  );
}
