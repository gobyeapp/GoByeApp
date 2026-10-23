import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SettlementRecord } from '@gobye/core';
import { date, money } from '@/data/format';
import { RANGE_MS, useFilters } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Drawer, Empty, KV, Notice, Pill, Stat, Table, type Column } from '@/ui/kit';
import { collectionTotals } from './logic';
import { FinanceHead, SubHead } from './parts';

const PURPOSE_LABEL = { wallet_funding: 'Wallet funding', package_purchase: 'Package purchases', trip_payment: 'Trip payments' } as const;

export default function Settlements() {
  const d = useData();
  const { now } = usePlatform();
  const { range, city } = useFilters();
  const [openId, setOpenId] = useState<string | null>(null);
  // Settlements cover every city, so only the date range applies (by period end).
  const rows = useMemo(() => d.settlements.filter((s) => now() - s.periodEnd <= RANGE_MS[range]).sort((a, b) => b.periodEnd - a.periodEnd), [d.settlements, range, now]);
  const pending = rows.filter((s) => !s.settledAt);
  const total = (k: 'collected' | 'fees' | 'settled') => rows.reduce((s, x) => s + x[k], 0);
  const open = openId ? d.settlements.find((s) => s.id === openId) : undefined;

  const columns: Column<SettlementRecord>[] = [
    { key: 'p', label: 'Provider and period', render: (s) => <div><div className="cell-title">{s.provider}</div><div className="cell-sub">{date(s.periodStart)} to {date(s.periodEnd)}</div></div> },
    { key: 'c', label: 'Collected', align: 'right', sortValue: (s) => s.collected, render: (s) => <span className="num">{money(s.collected)}</span> },
    { key: 'f', label: 'Fees', align: 'right', sortValue: (s) => s.fees, render: (s) => <span className="num muted"><span className="sr">Deducted </span>−{money(s.fees)}</span> },
    { key: 's', label: 'Settled', align: 'right', sortValue: (s) => s.settled, render: (s) => (s.settledAt ? <span className="num strong">{money(s.settled)}</span> : <span className="num muted">{money(s.settled)} expected</span>) },
    { key: 'd', label: 'Settled date', sortValue: (s) => s.settledAt ?? Number.MAX_SAFE_INTEGER, render: (s) => (s.settledAt ? <span className="small">{date(s.settledAt)}</span> : <Pill tone="warning">Pending settlement</Pill>) },
    { key: 'r', label: 'Bank reference', render: (s) => <span className="num small">{s.bankReference ?? 'Not yet'}</span> },
  ];

  return (
    <>
      <FinanceHead title="Settlements" sub="What the provider collected, what it deducted in fees, and what reached the company bank account." />
      <div className="grid cols-4">
        <Stat icon="exchange" label="Collected by provider" value={money(total('collected'))} sub={`${rows.length} periods`} />
        <Stat icon="bill" label="Provider fees" value={money(total('fees'))} sub="Processing cost" />
        <Stat icon="bank" label="Settled to bank" value={money(rows.filter((s) => s.settledAt).reduce((t, s) => t + s.settled, 0))} sub="Bank reference received" />
        <Stat icon="time" label="Pending settlement" value={money(pending.reduce((t, s) => t + s.settled, 0))} sub={`${pending.length} period${pending.length === 1 ? '' : 's'} not settled yet`} tone={pending.length ? 'warning' : undefined} />
      </div>
      <div style={{ marginTop: 16 }}>
        <Notice tone="info">
          Test data from Paystack (test). Settlements cover both cities{city !== 'all' ? ', so the city filter does not apply here' : ''}. Differences against our ledger are explained in <Link to="/finance/reconciliation">Reconciliation</Link>.
        </Notice>
      </div>
      <div className="section">
        <div className="card flush">
          <Table rows={rows} columns={columns} rowKey={(s) => s.id} onRowClick={(s) => setOpenId(s.id)} empty={<Empty title="No settlement periods in this range" icon="bill">Widen the date range at the top.</Empty>} />
        </div>
      </div>
      {open ? <SettlementDrawer s={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function SettlementDrawer({ s, onClose }: { s: SettlementRecord; onClose: () => void }) {
  const d = useData();
  const inPeriod = d.collections.filter((c) => c.provider === s.provider && c.createdAt >= s.periodStart && c.createdAt < s.periodEnd);
  const byPurpose = (Object.keys(PURPOSE_LABEL) as (keyof typeof PURPOSE_LABEL)[]).map((p) => ({ p, t: collectionTotals(inPeriod.filter((c) => c.purpose === p)).successful }));
  return (
    <Drawer title={`${date(s.periodStart)} to ${date(s.periodEnd)}`} sub={s.provider} onClose={onClose}>
      {s.settledAt ? <Pill tone="success">Settled {date(s.settledAt)}</Pill> : <Notice tone="warning" icon="time">Pending settlement. The provider has not paid this period into the bank yet.</Notice>}
      <KV
        items={[
          ['Collected', money(s.collected)],
          ['Fees', `−${money(s.fees)}`],
          ['Collected minus fees', money(s.collected - s.fees)],
          ['Settled', s.settledAt ? money(s.settled) : `${money(s.settled)} expected`],
          ['Bank reference', s.bankReference ?? 'Not yet'],
          ['Our ledger, same period', money(s.ledgerTotal)],
        ]}
      />
      <div>
        <SubHead>Successful collections in this period</SubHead>
        <div className="stack tight">
          {byPurpose.map(({ p, t }) => (
            <div key={p} className="row small">
              <span style={{ flex: 1 }}>{PURPOSE_LABEL[p]}</span>
              <span className="muted">{t.count} payments</span>
              <span className="num strong" style={{ width: 110, textAlign: 'right' }}>{money(t.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}
