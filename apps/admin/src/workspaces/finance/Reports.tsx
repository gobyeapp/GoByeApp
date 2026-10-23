import { useMemo } from 'react';
import type { RefundRecord, WithdrawalRecord } from '@gobye/core';
import { count, date, downloadCsv, label, money } from '@/data/format';
import { RecordLink } from '@/data/records';
import { useFilters, useSession } from '@/data/session';
import { useData, useToast } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, Empty, Notice, Section, Stat, Table, type Column } from '@/ui/kit';
import { reportData } from './logic';
import { FinanceHead, REFUND_TONE, StatusPill, WITHDRAWAL_TONE, useInclude } from './parts';

const naira = (k: number) => (k / 100).toFixed(2);

export default function Reports() {
  const d = useData();
  const include = useInclude();
  const { city, range } = useFilters();
  const { can } = useSession();
  const toast = useToast();
  const r = useMemo(() => reportData(d, include), [d, include]);
  const pNames = useMemo(() => new Map(d.passengers.map((p) => [p.id, p.name])), [d.passengers]);
  const dNames = useMemo(() => new Map(d.drivers.map((x) => [x.id, x.name])), [d.drivers]);
  const suffix = `${city}-${range}`;

  const Export = ({ name, rows }: { name: string; rows: Record<string, string | number>[] }) =>
    can('reports.export') ? (
      <Button
        size="sm"
        icon="download"
        disabledReason={rows.length ? undefined : 'Nothing to export'}
        onClick={() => {
          downloadCsv(`gobye-test-${name}-${suffix}.csv`, rows);
          toast(`Exported ${rows.length} rows (test data)`);
        }}
      >
        Export CSV
      </Button>
    ) : (
      <Button size="sm" icon="download" disabledReason="Needs report export permission">Export CSV</Button>
    );

  const costRows = [
    { item: 'Processing costs (provider fees)', amount: r.costs.processing },
    { item: 'Referral rewards', amount: r.costs.referralRewards },
    { item: 'Goodwill refunds', amount: r.costs.goodwillRefunds },
    ...(r.costs.otherPromotions ? [{ item: 'Other promotions', amount: r.costs.otherPromotions }] : []),
  ];
  const outRows = [
    { item: 'Held in passenger wallets', note: 'Liability: passengers’ money for future trips', amount: r.outstanding.walletsHeld },
    { item: 'Driver earnings owed', note: 'Withdrawable by drivers', amount: r.outstanding.earningsOwed },
    { item: 'Reserved for withdrawals', note: 'Requested, transfer not final yet', amount: r.outstanding.reserves },
  ];

  const refundCols: Column<RefundRecord>[] = [
    { key: 'p', label: 'Passenger', render: (x) => <RecordLink type="passenger" id={x.passengerId}>{pNames.get(x.passengerId) ?? x.passengerId}</RecordLink> },
    { key: 'r', label: 'Reason', render: (x) => <span className="small">{x.reason}</span> },
    { key: 'd', label: 'Requested', render: (x) => <span className="small">{date(x.requestedAt)}</span> },
    { key: 's', label: 'Status', render: (x) => <StatusPill tone={REFUND_TONE[x.status]} status={x.status} /> },
    { key: 'a', label: 'Amount', align: 'right', sortValue: (x) => x.amount, render: (x) => <span className="num">{money(x.amount)}</span> },
  ];
  const payoutCols: Column<WithdrawalRecord>[] = [
    { key: 'd', label: 'Driver', render: (x) => <RecordLink type="driver" id={x.driverId}>{dNames.get(x.driverId) ?? x.driverId}</RecordLink> },
    { key: 'r', label: 'Requested', sortValue: (x) => x.requestedAt, render: (x) => <span className="small">{date(x.requestedAt)}</span> },
    { key: 'b', label: 'Bank account', render: (x) => <span className="small">{x.bankAccount.bankName} {x.bankAccount.accountNumberMasked}</span> },
    { key: 's', label: 'Status', render: (x) => <StatusPill tone={WITHDRAWAL_TONE[x.status]} status={x.status} /> },
    { key: 'a', label: 'Amount', align: 'right', sortValue: (x) => x.amount, render: (x) => <span className="num">{money(x.amount)}</span> },
  ];

  return (
    <>
      <FinanceHead title="Reports" sub="Revenue, costs, balances owed, refunds and payouts for the selected city and dates. Trip value, company revenue, wallet money and driver earnings are kept apart." />
      <div className="grid cols-4">
        <Stat icon="ticket" label="Company revenue" value={money(r.revenueTotal)} sub="Driver access packages" />
        <Stat icon="bill" label="Costs" value={money(r.costsTotal)} sub="Processing, rewards and goodwill" />
        <Stat icon="wallet" label="Wallet funding received" value={money(r.walletDeposits)} sub="Held for passengers, not revenue" />
        <Stat icon="route" label="Trip value" value={money(r.trips.value)} sub={`${count(r.trips.count)} completed trips, drivers’ money`} />
      </div>
      <div style={{ marginTop: 16 }}>
        <Notice tone="info">
          Test data only: figures come from the simulated ledger and Paystack (test). GoBye keeps no commission on trips, so trip value is not company revenue.
        </Notice>
      </div>

      <Section title="Available exports" desc="Each export is a CSV of the test data loaded in this dashboard, for the city and dates selected at the top. Server-side scheduled reports need the backend.">
        <div className="grid cols-3">
          {(
            [
              ['Revenue by plan', 'Package purchases and revenue per access plan', r.revenueByPlan.length, 'ticket'],
              ['Costs', 'Provider fees, referral rewards and goodwill refunds', costRows.length, 'bill'],
              ['Outstanding balances', 'Wallet money held, earnings owed, withdrawal reserves (as of now)', outRows.length, 'balance'],
              ['Trip value', 'Completed trips, paid through GoBye or directly to drivers', 1, 'route'],
              ['Refunds', 'Every refund with reason, destination and status', r.refunds.length, 'refresh'],
              ['Payouts', 'Driver withdrawals with bank account and status', r.payouts.length, 'bank'],
            ] as const
          ).map(([title, what, rows, icon]) => (
            <Card key={title}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <span aria-hidden style={{ width: 34, height: 34, borderRadius: 8, display: "grid", placeItems: "center", background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--e2)", color: "var(--jade)", flexShrink: 0 }}><Icon name={icon} size={18} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="strong" style={{ display: 'block' }}>{title}</span>
                  <span className="cell-sub">{what}</span>
                </span>
              </div>
              <div className="small muted num" style={{ marginTop: 10 }}>{count(rows)} {rows === 1 ? 'row' : 'rows'} · CSV</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Revenue by plan" actions={<Export name="revenue" rows={r.revenueByPlan.map((x) => ({ plan: x.plan, purchases: x.count, amount_naira: naira(x.amount) }))} />}>
        <Card flush>
          <Table
            rows={r.revenueByPlan}
            rowKey={(x) => x.plan}
            columns={[
              { key: 'p', label: 'Package', render: (x) => <span className="strong">{x.plan} access</span> },
              { key: 'c', label: 'Purchases', align: 'right', render: (x) => <span className="num">{count(x.count)}</span> },
              { key: 'a', label: 'Revenue', align: 'right', render: (x) => <span className="num strong">{money(x.amount)}</span> },
            ]}
            empty={<Empty title="No package purchases" icon="ticket">None in the selected city and dates.</Empty>}
          />
        </Card>
      </Section>

      <div className="grid cols-2" style={{ marginTop: 0 }}>
        <Section title="Costs" actions={<Export name="costs" rows={costRows.map((x) => ({ item: x.item, amount_naira: naira(x.amount) }))} />}>
          <Card flush>
            <Table rows={costRows} rowKey={(x) => x.item} columns={[{ key: 'i', label: 'Cost', render: (x) => x.item }, { key: 'a', label: 'Amount', align: 'right', render: (x) => <span className="num">{money(x.amount)}</span> }]} />
          </Card>
        </Section>
        <Section title="Outstanding balances" actions={<Export name="outstanding" rows={outRows.map((x) => ({ item: x.item, amount_naira: naira(x.amount) }))} />}>
          <Card flush>
            <Table rows={outRows} rowKey={(x) => x.item} columns={[{ key: 'i', label: 'As of now', render: (x) => <div><div>{x.item}</div><div className="cell-sub">{x.note}</div></div> }, { key: 'a', label: 'Amount', align: 'right', render: (x) => <span className="num strong">{money(x.amount)}</span> }]} />
          </Card>
          <div className="small muted" style={{ marginTop: 6 }}>Balances are current; the date range does not apply.</div>
        </Section>
      </div>

      <Section title="Trip value" actions={<Export name="trip-value" rows={[{ completed_trips: r.trips.count, trip_value_naira: naira(r.trips.value), via_gobye_naira: naira(r.trips.value - r.trips.directValue), direct_to_driver_trips: r.trips.directCount, direct_to_driver_naira: naira(r.trips.directValue) }]} />}>
        <div className="grid cols-3">
          <Stat label="Completed trips" value={count(r.trips.count)} sub={money(r.trips.value)} />
          <Stat label="Paid through GoBye" value={money(r.trips.value - r.trips.directValue)} sub="Wallet or collection account, credited to drivers" />
          <Stat label="Paid directly to drivers" value={money(r.trips.directValue)} sub={`${count(r.trips.directCount)} trips, recorded only`} />
        </div>
      </Section>

      <Section title="Refunds" actions={<Export name="refunds" rows={r.refunds.map((x) => ({ id: x.id, passenger: pNames.get(x.passengerId) ?? x.passengerId, reason: x.reason, destination: label(x.destination), status: label(x.status), requested: date(x.requestedAt), amount_naira: naira(x.amount) }))} />}>
        <div className="small muted" style={{ marginBottom: 8 }}>Completed refunds: {money(r.refundsCompleted)}</div>
        <Card flush>
          <Table rows={r.refunds} rowKey={(x) => x.id} columns={refundCols} empty={<Empty title="No refunds" icon="refresh">None in the selected city and dates.</Empty>} />
        </Card>
      </Section>

      <Section title="Payouts" actions={<Export name="payouts" rows={r.payouts.map((x) => ({ id: x.id, driver: dNames.get(x.driverId) ?? x.driverId, bank: `${x.bankAccount.bankName} ${x.bankAccount.accountNumberMasked}`, status: label(x.status), requested: date(x.requestedAt), amount_naira: naira(x.amount) }))} />}>
        <div className="row wrap small muted" style={{ marginBottom: 8, gap: 16 }}>
          <span>Paid out: <span className="num strong">{money(r.payoutTotals.successful)}</span></span>
          <span>In progress: <span className="num">{money(r.payoutTotals.inProgress)}</span></span>
          <span>Returned to drivers: <span className="num">{money(r.payoutTotals.returned)}</span></span>
        </div>
        <Card flush>
          <Table rows={r.payouts} rowKey={(x) => x.id} columns={payoutCols} caption="Payouts" empty={<Empty title="No payouts" icon="bank">None in the selected city and dates.</Empty>} />
        </Card>
      </Section>

      <Section title="Receipts">
        <Card muted>
          <div className="small">
            Trip receipts come from the trip record: fare, payment method and payment confirmation. Open any trip to see them. Sending receipts by email waits for the email provider, which is not chosen yet.
          </div>
        </Card>
      </Section>
    </>
  );
}
