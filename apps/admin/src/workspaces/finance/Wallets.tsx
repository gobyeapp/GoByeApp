import { useMemo, useState } from 'react';
import type { PassengerRecord } from '@gobye/core';
import { city, money, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Button, Drawer, Empty, KV, Notice, Pill, SearchInput, Segmented, Stat, Table, type Column } from '@/ui/kit';
import { CorrectionDialog } from './CorrectionDialog';
import { pendingAdjustments, walletCorrectionLines, walletLiability, walletSummaries, type WalletSummary } from './logic';
import { Amount, FinanceHead, LedgerLines, SubHead, useInclude } from './parts';

type Row = WalletSummary & { passenger: PassengerRecord };

export default function Wallets() {
  const d = useData();
  const { now } = usePlatform();
  const include = useInclude();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'balance' | 'all'>('balance');
  const [openId, setOpenId] = useState<string | null>(null);

  const summaries = useMemo(() => walletSummaries(d.ledger), [d.ledger]);
  // Balances are as of now, so only the city filter applies (the date range would hide money still held).
  const scoped: Row[] = useMemo(
    () =>
      d.passengers
        .filter((p) => include(p.city, undefined))
        .map((p) => ({ ...(summaries.get(p.id) ?? { passengerId: p.id, balance: 0, deposits: 0, charges: 0, refunds: 0, rewards: 0, corrections: 0, lines: 0 }), passenger: p })),
    [d.passengers, summaries, include],
  );
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return scoped.filter((r) => (show === 'all' || r.balance !== 0) && (!t || r.passenger.name.toLowerCase().includes(t) || r.passenger.id.includes(t))).sort((a, b) => b.balance - a.balance);
  }, [scoped, q, show]);
  const held = walletLiability(scoped);
  const open = openId ? scoped.find((r) => r.passengerId === openId) : undefined;
  const pendingCount = d.approvals.filter((a) => a.kind === 'ledger_adjustment' && a.status === 'pending' && a.target.type === 'passenger').length;

  const columns: Column<Row>[] = [
    { key: 'p', label: 'Passenger', render: (r) => <div><RecordLink type="passenger" id={r.passengerId}>{r.passenger.name}</RecordLink><div className="cell-sub" style={{ paddingLeft: 4 }}>{city(r.passenger.city)}</div></div> },
    { key: 'bal', label: 'Balance', align: 'right', render: (r) => <Amount value={r.balance} plain strong /> },
    { key: 'dep', label: 'Deposits', align: 'right', render: (r) => (r.deposits ? <Amount value={r.deposits} /> : <span className="muted">None</span>) },
    { key: 'chg', label: 'Trip charges', align: 'right', render: (r) => (r.charges ? <Amount value={-r.charges} /> : <span className="muted">None</span>) },
    { key: 'ref', label: 'Refunds', align: 'right', render: (r) => (r.refunds ? <Amount value={r.refunds} /> : <span className="muted">None</span>) },
    { key: 'rew', label: 'Rewards', align: 'right', render: (r) => (r.rewards ? <Amount value={r.rewards} /> : <span className="muted">None</span>) },
    { key: 'cor', label: 'Corrections', align: 'right', render: (r) => (r.corrections ? <Amount value={r.corrections} /> : <span className="muted">None</span>) },
    { key: 'last', label: 'Last movement', render: (r) => <span className="small muted">{r.lastAt ? when(r.lastAt, now()) : 'No movements'}</span> },
  ];

  return (
    <>
      <FinanceHead title="Passenger wallets" sub="Balances come from the ledger. Wallet money belongs to passengers until they spend it, so the total is a liability, not revenue." />
      <div className="grid cols-4">
        <Stat label="Held for passengers" value={money(held)} sub="Liability, owed to passengers" />
        <Stat label="Wallets with money" value={String(scoped.filter((r) => r.balance > 0).length)} sub={`of ${scoped.length} passengers`} />
        <Stat label="Deposits, all time" value={money(scoped.reduce((s, r) => s + r.deposits, 0))} sub="Verified wallet funding" />
        <Stat label="Corrections waiting" value={String(pendingCount)} sub="Owner approval needed" tone={pendingCount ? 'warning' : undefined} />
      </div>

      <div className="section">
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Search passenger" />
          <Segmented label="Show" value={show} onChange={setShow} options={[{ value: 'balance', label: 'With activity' }, { value: 'all', label: 'All passengers' }]} />
          <span className="muted small" style={{ marginLeft: 'auto' }}>Balances as of now. The date range does not apply.</span>
        </div>
        <div className="card flush">
          <Table rows={rows} columns={columns} rowKey={(r) => r.passengerId} onRowClick={(r) => setOpenId(r.passengerId)} empty={<Empty title="No wallets match" icon="wallet">Clear the search or show all passengers.</Empty>} />
        </div>
      </div>

      {open ? <WalletDrawer row={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function WalletDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const [correcting, setCorrecting] = useState(false);
  const entries = d.ledger.filter((e) => e.account.kind === 'passenger_wallet' && e.account.ownerId === row.passengerId).sort((a, b) => b.at - a.at);
  const waiting = pendingAdjustments(d.approvals, row.passengerId);
  const p = row.passenger;

  return (
    <Drawer
      title={`${p.name}: wallet`}
      sub={`Passenger · ${city(p.city)}`}
      onClose={onClose}
      footer={
        can('ledger.adjust') ? (
          <Button variant="primary" icon="edit" onClick={() => setCorrecting(true)}>Correct balance</Button>
        ) : can('ledger.view') || can('finance.view') ? (
          <Button icon="edit" disabledReason="Needs ledger adjustment permission">Correct balance</Button>
        ) : undefined
      }
    >
      <div className="row wrap">
        <RecordLink type="passenger" id={p.id}>Open passenger record</RecordLink>
        {waiting.length ? <Pill tone="warning" icon="time">{waiting.length} correction{waiting.length > 1 ? 's' : ''} waiting</Pill> : null}
      </div>
      <KV
        items={[
          ['Balance', <Amount value={row.balance} plain strong />],
          ['Deposits', <Amount value={row.deposits} />],
          ['Trip charges', <Amount value={-row.charges} />],
          ['Refunds', <Amount value={row.refunds} />],
          ['Rewards', <Amount value={row.rewards} />],
          ['Corrections', <Amount value={row.corrections} />],
        ]}
      />
      {waiting.map((a) => (
        <Notice key={a.id} tone="warning" icon="time">
          <span className="strong">{a.title}</span> waiting for owner approval. Requested by {a.requestedBy.name}{a.note ? `. Reason: ${a.note}` : ''}
        </Notice>
      ))}
      <div>
        <SubHead aside={<span className="small muted">{entries.length} lines</span>}>Ledger lines</SubHead>
        <LedgerLines entries={entries} now={now()} showAccount={false} empty="No wallet movements yet" />
      </div>
      {correcting ? (
        <CorrectionDialog
          title="Correct wallet balance"
          intro="Balances are never edited. This asks the owner to approve an adjustment journal for this wallet."
          target={{ type: 'passenger', id: p.id, label: p.name }}
          balance={row.balance}
          describe={(dir, amt) => (dir === 'credit' ? `Credit ${amt} to ${p.name}’s wallet` : `Debit ${amt} from ${p.name}’s wallet`)}
          build={(dir, k) => walletCorrectionLines(p.id, dir, k)}
          onCancel={() => setCorrecting(false)}
          onDone={() => setCorrecting(false)}
        />
      ) : null}
    </Drawer>
  );
}
