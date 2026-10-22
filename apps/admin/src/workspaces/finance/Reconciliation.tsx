import { useMemo, useState } from 'react';
import { date, money, when } from '@/data/format';
import { RecordLink } from '@/data/records';
import { RANGE_MS, useFilters, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, ConfirmDialog, Drawer, Empty, KV, Notice, Pill, Section, Stat, Table, type Column } from '@/ui/kit';
import { CorrectionDialog } from './CorrectionDialog';
import { ACCOUNT_LABEL, KIND_LABEL, pendingAdjustments, reconTargetId, reconcile, reconciliationCorrectionLines, unmatchedItems, type ReconRow } from './logic';
import { Amount, FinanceHead, SubHead } from './parts';

const periodLabel = (r: ReconRow) => `${date(r.settlement.periodStart)} to ${date(r.settlement.periodEnd)}`;

function Diff({ value, pending }: { value: number; pending?: boolean }) {
  if (pending) return <span className="muted small">Waiting for bank</span>;
  if (value === 0) return <span className="num muted">Matches</span>;
  return <Amount value={value} />;
}

export default function Reconciliation() {
  const d = useData();
  const { now } = usePlatform();
  const { range } = useFilters();
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => reconcile(d.settlements, d.audit).filter((r) => now() - r.settlement.periodEnd <= RANGE_MS[range]).sort((a, b) => b.settlement.periodEnd - a.settlement.periodEnd), [d.settlements, d.audit, range, now]);
  const un = useMemo(() => unmatchedItems(d), [d]);
  const names = useMemo(() => new Map([...d.passengers.map((p) => [p.id, p.name] as const), ...d.drivers.map((x) => [x.id, x.name] as const)]), [d.passengers, d.drivers]);
  const open = openId ? rows.find((r) => r.settlement.id === openId) : undefined;
  const differences = rows.filter((r) => r.state === 'difference');
  const unmatchedCount = un.collectionsWithoutJournal.length + un.duplicateEvents.length + un.entriesWithoutReference.length;

  const columns: Column<ReconRow>[] = [
    { key: 'p', label: 'Settlement period', render: (r) => <div><div className="cell-title">{periodLabel(r)}</div><div className="cell-sub">{r.settlement.provider}</div></div> },
    { key: 'prov', label: 'Provider collected', align: 'right', render: (r) => <span className="num">{money(r.settlement.collected)}</span> },
    { key: 'bank', label: 'Bank settled', align: 'right', render: (r) => (r.settlement.settledAt ? <span className="num">{money(r.settlement.settled)}</span> : <span className="muted small">Pending</span>) },
    { key: 'led', label: 'Our ledger', align: 'right', render: (r) => <span className="num">{money(r.settlement.ledgerTotal)}</span> },
    { key: 'pl', label: 'Provider vs ledger', align: 'right', render: (r) => <Diff value={r.providerVsLedger} /> },
    { key: 'pb', label: 'Bank vs expected', align: 'right', render: (r) => <Diff value={r.providerVsBank} pending={!r.settlement.settledAt} /> },
    {
      key: 'st',
      label: 'State',
      render: (r) =>
        r.state === 'difference' ? (r.investigated ? <Pill tone="info" icon="fileCheck">Investigated</Pill> : <Pill tone="danger">Difference</Pill>) : r.state === 'pending' ? <Pill tone="warning">Pending settlement</Pill> : <Pill tone="success">Matched</Pill>,
    },
  ];

  return (
    <>
      <FinanceHead title="Reconciliation" sub="Provider records, bank settlements and our ledger compared for each settlement period." />
      <div className="grid cols-4">
        <Stat label="Periods matched" value={String(rows.filter((r) => r.state === 'matched').length)} sub={`of ${rows.length} in range`} tone="success" />
        <Stat label="With differences" value={String(differences.length)} sub={`${differences.filter((r) => !r.investigated).length} not investigated`} tone={differences.some((r) => !r.investigated) ? 'danger' : undefined} />
        <Stat label="Pending settlement" value={String(rows.filter((r) => !r.settlement.settledAt).length)} sub="Bank side not in yet" />
        <Stat label="Unmatched items" value={String(unmatchedCount)} sub="Listed at the bottom" tone={unmatchedCount ? 'warning' : undefined} />
      </div>
      <div style={{ marginTop: 16 }}>
        <Notice tone="info">
          Test data. Provider figures come from Paystack (test), bank figures from simulated settlement records. A positive difference means the provider shows more than we recorded. Corrections go through owner approval; nothing is edited in place.
        </Notice>
      </div>

      <div className="section">
        <div className="card flush">
          <Table rows={rows} columns={columns} rowKey={(r) => r.settlement.id} onRowClick={(r) => setOpenId(r.settlement.id)} empty={<Empty title="No settlement periods in this range" icon="balance">Widen the date range at the top.</Empty>} />
        </div>
      </div>

      <Section title="Unmatched items" actions={<span className="small muted">Checked across all dates</span>}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <SubHead aside={<Pill tone={un.collectionsWithoutJournal.length ? 'danger' : 'success'}>{un.collectionsWithoutJournal.length}</Pill>}>Successful collections without a ledger journal</SubHead>
            {un.collectionsWithoutJournal.length ? (
              <div className="stack tight">
                {un.collectionsWithoutJournal.map((c) => (
                  <div key={c.id} className="row small">
                    <span className="num">{c.reference}</span>
                    <RecordLink type={c.payerType} id={c.payerId}>{names.get(c.payerId) ?? c.payerId}</RecordLink>
                    <span className="num strong" style={{ marginLeft: 'auto' }}>{money(c.amount)}</span>
                  </div>
                ))}
                <div className="small muted">Open the payment in Collections and check again with the provider: it posts the missing journal once.</div>
              </div>
            ) : (
              <div className="small muted">None. Every successful collection has its journal.</div>
            )}
          </div>
          <div className="card">
            <SubHead aside={<Pill tone="neutral" icon="copy">{un.duplicateEvents.length}</Pill>}>Duplicate provider events</SubHead>
            {un.duplicateEvents.length ? (
              <div className="stack tight">
                {un.duplicateEvents.map(({ collection: c, event: e }, i) => (
                  <div key={`${c.id}-${i}`} className="row small wrap">
                    <span className="num">{c.reference}</span>
                    <span className="muted">{e.event}, {when(e.at, now())}</span>
                    <span style={{ marginLeft: 'auto' }}><Pill tone="neutral" icon="copy">Duplicate, not applied</Pill></span>
                  </div>
                ))}
                <div className="small muted">Recorded for the trail. Duplicates never post money twice because journals are unique per provider reference.</div>
              </div>
            ) : (
              <div className="small muted">None.</div>
            )}
          </div>
          <div className="card">
            <SubHead aside={<Pill tone={un.entriesWithoutReference.length ? 'warning' : 'success'}>{un.entriesWithoutReference.length}</Pill>}>Ledger entries missing a provider reference</SubHead>
            {un.entriesWithoutReference.length ? (
              <div className="stack tight">
                {un.entriesWithoutReference.map((e) => (
                  <div key={e.id} className="row small wrap">
                    <span>{KIND_LABEL[e.kind]} · {ACCOUNT_LABEL[e.account.kind]}</span>
                    <span className="muted">{e.reference ? `Reference ${e.reference} has no provider record` : 'No reference'}</span>
                    <span style={{ marginLeft: 'auto' }}><Amount value={e.amount} cue /></span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="small muted">None. Funding, package, trip transfer and payout entries all carry a provider reference.</div>
            )}
          </div>
        </div>
      </Section>

      {open ? <ReconDrawer row={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function ReconDrawer({ row, onClose }: { row: ReconRow; onClose: () => void }) {
  const d = useData();
  const { can } = useSession();
  const { now } = usePlatform();
  const act = useAction();
  const [mode, setMode] = useState<'none' | 'investigate' | 'adjust'>('none');
  const s = row.settlement;
  const target = { type: 'ledger_entry' as const, id: reconTargetId(s), label: `Settlement ${periodLabel(row)}` };
  const waiting = pendingAdjustments(d.approvals, target.id);
  const hasDiff = row.state === 'difference';

  return (
    <Drawer
      title={periodLabel(row)}
      sub={s.provider}
      onClose={onClose}
      footer={
        hasDiff ? (
          <>
            {can('reconciliation.work') ? <Button icon="fileCheck" onClick={() => setMode('investigate')}>{row.investigated ? 'Update investigation note' : 'Mark as investigated'}</Button> : null}
            {can('ledger.adjust') ? (
              <Button variant="primary" icon="edit" disabledReason={row.providerVsLedger === 0 ? 'Only ledger differences can be corrected here' : waiting.length ? 'A correction is already waiting for approval' : undefined} onClick={() => setMode('adjust')}>
                Post correcting adjustment
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="row wrap">
        {hasDiff ? <Pill tone="danger">Difference</Pill> : row.state === 'pending' ? <Pill tone="warning">Pending settlement</Pill> : <Pill tone="success">Matched</Pill>}
        {row.investigated ? <Pill tone="info" icon="fileCheck">Investigated</Pill> : null}
      </div>
      <KV
        items={[
          ['Provider collected', money(s.collected)],
          ['Provider fees', money(s.fees)],
          ['Expected settlement', money(row.expectedSettled)],
          ['Bank settled', s.settledAt ? `${money(s.settled)}, ${date(s.settledAt)}` : 'Pending'],
          ['Bank reference', s.bankReference ?? 'Not yet'],
          ['Our ledger', money(s.ledgerTotal)],
          ['Provider vs ledger', <Diff value={row.providerVsLedger} />],
          ['Bank vs expected', <Diff value={row.providerVsBank} pending={!s.settledAt} />],
        ]}
      />
      {row.explanations.length ? (
        <div className="stack">
          {row.explanations.map((x) => (
            <Notice key={x} tone={hasDiff ? 'warning' : 'info'}>{x}</Notice>
          ))}
        </div>
      ) : (
        <Notice tone="success">Provider, bank and ledger agree for this period.</Notice>
      )}
      {row.investigated ? (
        <div className="card muted-card">
          <div className="small"><span className="strong">Investigated</span> by {row.investigated.by}, {when(row.investigated.at, now())}</div>
          <div style={{ marginTop: 4 }}>{row.investigated.note}</div>
        </div>
      ) : null}
      {waiting.map((a) => (
        <Notice key={a.id} tone="warning" icon="time">{a.title} waiting for owner approval. Reason: {a.note}</Notice>
      ))}
      {mode === 'investigate' ? (
        <ConfirmDialog
          title="Mark as investigated"
          body="Add what you found. The note is kept on the audit trail; no money moves."
          confirmLabel="Save note"
          requireReason
          onCancel={() => setMode('none')}
          onConfirm={async (note) => {
            const r = await act(
              {
                label: 'Mark investigated',
                apply: () => ({ ok: true }),
                audit: () => ({ action: 'reconciliation.investigated', target, summary: `Investigated difference for ${periodLabel(row)}`, reason: note }),
              },
              'Investigation note saved',
            );
            if (r.ok) setMode('none');
          }}
        />
      ) : null}
      {mode === 'adjust' ? (
        <CorrectionDialog
          title="Correcting adjustment"
          intro={`Asks the owner to approve an adjustment journal for this period. Suggested from the difference of ${money(Math.abs(row.providerVsLedger))}.`}
          target={target}
          initial={{ direction: row.providerVsLedger > 0 ? 'credit' : 'debit', amount: Math.abs(row.providerVsLedger) }}
          describe={(dir, amt) => `${dir === 'credit' ? 'Credit' : 'Debit'} ${amt} to the ledger for settlement ${periodLabel(row)}`}
          build={(dir, k) => reconciliationCorrectionLines(row.settlement.provider, dir, k)}
          onCancel={() => setMode('none')}
          onDone={() => setMode('none')}
        />
      ) : null}
    </Drawer>
  );
}
