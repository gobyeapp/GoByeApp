import { useMemo, useState } from 'react';
import type { DriverRecord } from '@gobye/core';
import { city, count, money, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { useData, usePlatform } from '@/data/store';
import { Card, Drawer, Empty, KV, Notice, SearchInput, Segmented, Stat, Table, type Column } from '@/ui/kit';
import { earningsSummary, type EarningsSummary } from './logic';
import { Amount, FinanceHead, LedgerLines, StatusPill, SubHead, WITHDRAWAL_TONE, useInclude } from './parts';

type Row = EarningsSummary & { driver: DriverRecord };

export default function Earnings() {
  const d = useData();
  const include = useInclude();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const [openId, setOpenId] = useState<string | null>(null);

  const scoped: Row[] = useMemo(() => d.drivers.filter((x) => include(x.city, undefined)).map((x) => ({ ...earningsSummary(d, x.id), driver: x })), [d, include]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const active = (r: Row) => r.tripEarnings || r.reserved || r.withdrawable || r.paidOut || r.directCount;
    return scoped.filter((r) => (show === 'all' || active(r)) && (!t || r.driver.name.toLowerCase().includes(t))).sort((a, b) => b.withdrawable - a.withdrawable);
  }, [scoped, q, show]);
  const tot = (k: keyof EarningsSummary) => scoped.reduce((s, r) => s + (r[k] as number), 0);
  const open = openId ? scoped.find((r) => r.driverId === openId) : undefined;

  const columns: Column<Row>[] = [
    { key: 'd', label: 'Driver', render: (r) => <div><RecordLink type="driver" id={r.driverId}>{r.driver.name}</RecordLink><div className="cell-sub" style={{ paddingLeft: 4 }}>{city(r.driver.city)}</div></div> },
    { key: 'trip', label: 'Trip earnings', align: 'right', render: (r) => <Amount value={r.tripEarnings} plain /> },
    { key: 'res', label: 'Reserved', align: 'right', render: (r) => (r.reserved ? <span className="num" style={{ color: 'var(--warning)' }}>{money(r.reserved)}</span> : <span className="muted">None</span>) },
    { key: 'wd', label: 'Withdrawable', align: 'right', render: (r) => <Amount value={r.withdrawable} plain strong /> },
    { key: 'paid', label: 'Paid out', align: 'right', render: (r) => <Amount value={r.paidOut} plain /> },
    { key: 'dir', label: 'Direct to driver', align: 'right', render: (r) => (r.directCount ? <div><div className="num">{money(r.directValue)}</div><div className="cell-sub">{r.directCount} trip{r.directCount > 1 ? 's' : ''}, recorded only</div></div> : <span className="muted">None</span>) },
  ];

  return (
    <>
      <FinanceHead title="Driver earnings" sub="Trip earnings credited through GoBye, what is reserved for withdrawals, what drivers can withdraw, and what was paid out." />
      <div className="grid cols-4">
        <Stat label="Withdrawable, owed to drivers" value={money(tot('withdrawable'))} sub="Available to withdraw now" />
        <Stat label="Reserved for withdrawals" value={money(tot('reserved'))} sub="Requested, not yet paid" tone={tot('reserved') ? 'warning' : undefined} />
        <Stat label="Paid out" value={money(tot('paidOut'))} sub="Confirmed by the provider, after reversals" />
        <Stat label="Paid directly to drivers" value={money(tot('directValue'))} sub={`${count(tot('directCount'))} trips, recorded only, never credited`} />
      </div>
      <div style={{ marginTop: 16 }}>
        <Notice tone="info">
          Withdrawable earnings are the driver earnings balance in the ledger. A trip the passenger paid to the driver’s own account is recorded but never credited here, so the fare is not counted twice. Balances are as of now; only the city filter applies.
        </Notice>
      </div>

      <div className="section">
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Search driver" />
          <Segmented label="Show" value={show} onChange={setShow} options={[{ value: 'active', label: 'With earnings' }, { value: 'all', label: 'All drivers' }]} />
        </div>
        <div className="card flush">
          <Table rows={rows} columns={columns} rowKey={(r) => r.driverId} onRowClick={(r) => setOpenId(r.driverId)} empty={<Empty title="No drivers match" icon="steering">Clear the search or show all drivers.</Empty>} />
        </div>
      </div>
      {open ? <EarningsDrawer row={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function EarningsDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const mine = d.ledger.filter((e) => 'ownerId' in e.account && e.account.ownerId === row.driverId && (e.account.kind === 'driver_earnings' || e.account.kind === 'driver_withdrawal_reserve')).sort((a, b) => b.at - a.at);
  const earnings = mine.filter((e) => e.account.kind === 'driver_earnings' && (e.kind === 'trip_charge' || e.kind === 'driver_trip_earning'));
  const adjustments = mine.filter((e) => e.account.kind === 'driver_earnings' && (e.kind === 'adjustment' || e.kind === 'reversal'));
  const withdrawals = d.withdrawals.filter((w) => w.driverId === row.driverId).sort((a, b) => b.requestedAt - a.requestedAt);
  const direct = d.trips.filter((x) => x.driverId === row.driverId && x.status === 'completed' && x.directToDriver);
  const dr = row.driver;

  return (
    <Drawer title={`${dr.name}: earnings`} sub={`Driver · ${city(dr.city)}`} onClose={onClose}>
      <RecordLink type="driver" id={dr.id}>Open driver record</RecordLink>
      <KV
        items={[
          ['Trip earnings', <Amount value={row.tripEarnings} plain />],
          ['Adjustments', row.adjustments ? <Amount value={row.adjustments} /> : 'None'],
          ['Reserved', money(row.reserved)],
          ['Withdrawable', <Amount value={row.withdrawable} plain strong />],
          ['Paid out', money(row.paidOut)],
          ['Returned after reversal', row.returnedAfterReversal ? <Amount value={row.returnedAfterReversal} /> : 'None'],
          ['Payout account', dr.bankAccount ? `${dr.bankAccount.bankName} ${dr.bankAccount.accountNumberMasked}${dr.bankAccount.verified ? ', verified' : ', not verified'}` : 'None on file'],
        ]}
      />
      <div>
        <SubHead aside={<span className="small muted">{earnings.length}</span>}>Earnings lines</SubHead>
        <LedgerLines entries={earnings} now={t} showAccount={false} empty="No trip earnings yet" />
      </div>
      <div>
        <SubHead>Adjustments and reversals</SubHead>
        <LedgerLines entries={adjustments} now={t} showAccount={false} empty="No adjustments" />
      </div>
      <div>
        <SubHead>Withdrawals</SubHead>
        {withdrawals.length ? (
          <div className="stack tight">
            {withdrawals.map((w) => (
              <div key={w.id} className="row small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="num muted">{w.id}</span>
                <span className="muted">{when(w.requestedAt, t)}</span>
                <span style={{ marginLeft: 'auto' }} className="num strong">{money(w.amount)}</span>
                <StatusPill tone={WITHDRAWAL_TONE[w.status]} status={w.status} />
              </div>
            ))}
          </div>
        ) : (
          <div className="muted small">No withdrawals requested</div>
        )}
      </div>
      <div>
        <SubHead aside={<span className="small muted">{direct.length}</span>}>Paid directly to driver</SubHead>
        {direct.length ? (
          <Card muted>
            <div className="small" style={{ marginBottom: 8 }}>Recorded only. These fares went to the driver’s own account and are not part of withdrawable earnings.</div>
            <div className="stack tight">
              {direct.map((x) => (
                <div key={x.id} className="row small">
                  <RecordLink type="trip" id={x.id}>{x.ref}</RecordLink>
                  <span className="muted">{when(x.completedAt, t)}</span>
                  <span className="num" style={{ marginLeft: 'auto' }}>{money(x.agreedFare ?? 0)}</span>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <div className="muted small">None</div>
        )}
      </div>
    </Drawer>
  );
}
