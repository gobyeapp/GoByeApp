import { Fragment, useMemo, useState } from 'react';
import type { LedgerAccount, LedgerEntryKind } from '@gobye/core';
import { money, when } from '@/data/format';
import { RANGE_MS, useFilters, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, ConfirmDialog, Drawer, Empty, FilterBar, KV, Notice, Pill, SearchInput, Select, Stat } from '@/ui/kit';
import { ACCOUNT_LABEL, KIND_LABEL, accountBalances, canReverseJournal, journalMatches, journals, pendingAdjustments, requestLedgerAdjustment, type Journal } from './logic';
import { Amount, FinanceHead, SubHead } from './parts';

const PAGE = 40;
const ownerName = (a: LedgerAccount, names: Map<string, string>) => ('ownerId' in a ? names.get(a.ownerId) ?? a.ownerId : 'provider' in a ? a.provider : 'Company');

export default function Ledger() {
  const d = useData();
  const { now } = usePlatform();
  const { range, city } = useFilters();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<LedgerEntryKind | 'all'>('all');
  const [account, setAccount] = useState<LedgerAccount['kind'] | 'all'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  const all = useMemo(() => journals(d.ledger), [d.ledger]);
  const names = useMemo(() => new Map([...d.passengers.map((p) => [p.id, p.name] as const), ...d.drivers.map((x) => [x.id, x.name] as const)]), [d.passengers, d.drivers]);
  const rows = useMemo(() => all.filter((j) => now() - j.at <= RANGE_MS[range] && journalMatches(j, { text: q, kind, account })), [all, range, q, kind, account, now]);
  const bal = accountBalances(d.ledger);
  const open = openId ? all.find((j) => j.id === openId) : undefined;

  return (
    <>
      <FinanceHead title="Ledger" sub="Every money movement as a balanced journal. Entries are never edited: corrections are new adjustment or reversal journals with a reason." />
      <div className="grid cols-4">
        <Stat icon="chart" label="Company revenue" value={money(bal.companyRevenue)} sub="Driver access packages" />
        <Stat icon="gift" label="Promotions and goodwill" value={money(bal.promotionsSpend)} sub="Rewards and goodwill refunds (expense)" />
        <Stat icon="bill" label="Processing costs" value={money(bal.processingCosts)} sub="Provider fees (expense)" />
        <Stat icon="wallet" label="Passenger wallets" value={money(bal.passengerWallets)} sub="Held for passengers (liability)" />
        <Stat icon="steering" label="Driver earnings" value={money(bal.driverEarnings)} sub="Withdrawable, owed to drivers" />
        <Stat icon="time" label="Withdrawal reserves" value={money(bal.withdrawalReserves)} sub="Requested, not yet paid" />
        <Stat icon="exchange" label="Provider clearing" value={<Amount value={bal.providerClearing} />} sub="Paystack (test): negative means money in, not yet settled out" />
        <Stat icon="list" label="Journals" value={String(all.length)} sub={all.every((j) => j.total === 0) ? 'All balance to zero' : 'Some do not balance'} tone={all.every((j) => j.total === 0) ? undefined : 'danger'} />
      </div>

      <div className="section">
        <FilterBar count={`${rows.length} journals${city !== 'all' ? ' · City filter does not apply to the ledger' : ''}`}>
          <SearchInput value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="Search description, reference or account" />
          <Select<LedgerEntryKind | 'all'> label="Kind" value={kind} onChange={(v) => { setKind(v); setLimit(PAGE); }} options={[{ value: 'all', label: 'All kinds' }, ...(Object.keys(KIND_LABEL) as LedgerEntryKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]} />
          <Select<LedgerAccount['kind'] | 'all'> label="Account" value={account} onChange={(v) => { setAccount(v); setLimit(PAGE); }} options={[{ value: 'all', label: 'All accounts' }, ...(Object.keys(ACCOUNT_LABEL) as LedgerAccount['kind'][]).map((k) => ({ value: k, label: ACCOUNT_LABEL[k] }))]} />
        </FilterBar>
        {rows.length ? (
          <div className="card flush">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Journal</th>
                    <th>Account</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((j) => (
                    <Fragment key={j.id}>
                      <tr className="clickable" tabIndex={0} onClick={() => setOpenId(j.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenId(j.id))} style={{ background: 'var(--muted)' }}>
                        <td colSpan={2}>
                          <div className="row wrap" style={{ gap: 8 }}>
                            <span className="cell-title">{j.description}</span>
                            <Pill tone={j.kind === 'reversal' || j.kind === 'adjustment' ? 'warning' : 'neutral'} icon={null}>{KIND_LABEL[j.kind]}</Pill>
                            {j.reversedBy ? <Pill tone="neutral" icon="refresh">Reversed</Pill> : null}
                          </div>
                          <div className="cell-sub">
                            {when(j.at, now())} · {j.createdBy.name}
                            {j.reference ? <> · <span className="num">{j.reference}</span></> : null}
                            {j.reason ? ` · Reason: ${j.reason}` : ''}
                          </div>
                        </td>
                        <td className="right small">
                          {j.total === 0 ? <span className="row" style={{ gap: 4, justifyContent: 'flex-end', color: 'var(--success)' }}><Icon name="check" size={14} />Sums to zero</span> : <span style={{ color: 'var(--danger)' }}>Off by {money(j.total)}</span>}
                        </td>
                      </tr>
                      {j.lines.map((l) => (
                        <tr key={l.id}>
                          <td style={{ paddingLeft: 28 }} className="small muted">{ownerName(l.account, names)}</td>
                          <td className="small">{ACCOUNT_LABEL[l.account.kind]}</td>
                          <td className="right"><Amount value={l.amount} cue /></td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > limit ? (
              <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
                <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="card">
            <Empty title="No journals match" icon="list" action={q || kind !== 'all' || account !== 'all' ? <Button size="sm" onClick={() => { setQ(''); setKind('all'); setAccount('all'); }}>Clear filters</Button> : undefined}>
              Try another search or widen the date range at the top.
            </Empty>
          </div>
        )}
      </div>
      {open ? <JournalDrawer j={open} all={all} names={names} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function JournalDrawer({ j, all, names, onClose }: { j: Journal; all: Journal[]; names: Map<string, string>; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const [confirm, setConfirm] = useState(false);
  const blocked = canReverseJournal(j, d.approvals);
  const waiting = pendingAdjustments(d.approvals, j.id);
  const reversal = j.reversedBy ? all.find((x) => x.id === j.reversedBy) : undefined;
  const original = j.reverses ? all.find((x) => x.lines.some((l) => l.id === j.reverses)) : undefined;
  const size = j.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const title = `Reverse journal: ${j.description} (${money(size)})`;

  return (
    <Drawer
      title={j.description}
      sub={`${KIND_LABEL[j.kind]} · ${j.id}`}
      onClose={onClose}
      footer={
        can('ledger.adjust') ? (
          <Button variant="danger-soft" icon="refresh" disabledReason={blocked ?? undefined} onClick={() => setConfirm(true)}>Request reversal</Button>
        ) : can('ledger.view') ? (
          <Button icon="refresh" disabledReason="Needs ledger adjustment permission">Request reversal</Button>
        ) : undefined
      }
    >
      <KV
        items={[
          ['When', when(j.at, now())],
          ['Posted by', `${j.createdBy.name} (${j.createdBy.kind})`],
          ['Reference', j.reference ?? 'None'],
          ['Provider', j.provider ?? 'None'],
          ['Reason', j.reason ?? 'None'],
          ['Balance check', j.total === 0 ? 'Lines sum to zero' : `Off by ${money(j.total)}`],
        ]}
      />
      {reversal ? <Notice tone="info" icon="refresh">Reversed by {reversal.description}, {when(reversal.at, now())}. Reason: {reversal.reason}</Notice> : null}
      {original ? <Notice tone="info" icon="refresh">This reverses: {original.description}, {when(original.at, now())}</Notice> : null}
      {waiting.map((a) => (
        <Notice key={a.id} tone="warning" icon="time">Reversal waiting for owner approval. Requested by {a.requestedBy.name}. Reason: {a.note}</Notice>
      ))}
      <div>
        <SubHead>Lines</SubHead>
        <div className="card flush table-wrap">
          <table className="table">
            <tbody>
              {j.lines.map((l) => (
                <tr key={l.id}>
                  <td><div>{ACCOUNT_LABEL[l.account.kind]}</div><div className="cell-sub">{ownerName(l.account, names)}</div></td>
                  <td className="right"><Amount value={l.amount} cue /></td>
                </tr>
              ))}
              <tr>
                <td className="strong">Total</td>
                <td className="right num strong">{money(j.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="small muted">Entries are never edited. A reversal posts opposite lines as a new journal, after the owner approves it.</div>
      {confirm ? (
        <ConfirmDialog
          title="Request reversal"
          body="Creates an approval request for the owner. Nothing changes until it is approved; then a reversal journal with opposite lines is posted."
          confirmLabel="Request approval"
          danger
          requireReason
          onCancel={() => setConfirm(false)}
          onConfirm={async (reason) => {
            const r = await act(
              {
                label: 'Request reversal',
                apply: (draft, ctx) => requestLedgerAdjustment(draft, { now: ctx.now, actor: ctx.actor, title, target: { type: 'ledger_entry', id: j.id, label: j.description }, amount: size, reason, adjustment: { description: `Reversal: ${j.description}`, reverseJournalId: j.id } }),
                audit: () => ({ action: 'ledger.reversal_requested', target: { type: 'ledger_entry', id: j.id, label: j.description }, summary: `Requested: ${title}`, reason }),
              },
              'Reversal sent for owner approval',
            );
            if (r.ok) setConfirm(false);
          }}
        />
      ) : null}
    </Drawer>
  );
}
