import { useMemo, useState } from 'react';
import type { CollectionRecord, CollectionStatus } from '@gobye/core';
import { RecordLink } from '@/data/records';
import { label, money, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useData, usePlatform, useToast } from '@/data/store';
import { Button, Card, Drawer, Empty, FilterBar, KV, Notice, Pill, SearchInput, Select, Stat, Table, Timeline, type Column } from '@/ui/kit';
import { cityIndex, collectionEntries, collectionTotals, payerCity, verifyCollection } from './logic';
import { Amount, COLLECTION_TONE, FinanceHead, LedgerLines, SimTag, StatusPill, SubHead, useInclude } from './parts';

type Purpose = CollectionRecord['purpose'];
const PURPOSE_LABEL: Record<Purpose, string> = { wallet_funding: 'Wallet funding', package_purchase: 'Package purchase', trip_payment: 'Trip payment' };
const PURPOSE_NOTE: Record<Purpose, string> = {
  wallet_funding: 'Held for the passenger (liability), not revenue',
  package_purchase: 'Company revenue',
  trip_payment: 'Trip value, credited to driver earnings',
};

export default function Collections() {
  const d = useData();
  const { now } = usePlatform();
  const include = useInclude();
  const [purpose, setPurpose] = useState<Purpose | 'all'>('all');
  const [status, setStatus] = useState<CollectionStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const ix = useMemo(() => cityIndex(d), [d]);
  const names = useMemo(() => new Map([...d.passengers.map((p) => [p.id, p.name] as const), ...d.drivers.map((x) => [x.id, x.name] as const)]), [d.passengers, d.drivers]);

  // Global city/date first (drives the totals strip), then the local purpose/status/search filters.
  const scoped = useMemo(() => d.collections.filter((c) => include(payerCity(ix, c), c.createdAt)), [d.collections, include, ix]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return scoped
      .filter((c) => (purpose === 'all' || c.purpose === purpose) && (status === 'all' || c.status === status))
      .filter((c) => !t || c.reference.toLowerCase().includes(t) || (names.get(c.payerId) ?? '').toLowerCase().includes(t))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [scoped, purpose, status, q, names]);
  const totals = collectionTotals(purpose === 'all' ? scoped : scoped.filter((c) => c.purpose === purpose));
  const open = openId ? d.collections.find((c) => c.id === openId) : undefined;

  const columns: Column<CollectionRecord>[] = [
    { key: 'purpose', label: 'Purpose', render: (c) => <div><div className="cell-title">{PURPOSE_LABEL[c.purpose]}</div><div className="cell-sub">{PURPOSE_NOTE[c.purpose]}</div></div> },
    { key: 'payer', label: 'Payer', render: (c) => <RecordLink type={c.payerType} id={c.payerId}>{names.get(c.payerId) ?? c.payerId}</RecordLink> },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (c) => c.amount, render: (c) => <Amount value={c.amount} plain strong /> },
    { key: 'fee', label: 'Fee', align: 'right', sortValue: (c) => c.fee, render: (c) => <span className="num muted">{c.fee ? money(c.fee) : 'None'}</span> },
    { key: 'ref', label: 'Provider and reference', render: (c) => <div><div className="small">{c.provider}</div><div className="cell-sub num">{c.reference}</div></div> },
    { key: 'status', label: 'Status', render: (c) => <div className="row" style={{ gap: 6 }}><StatusPill tone={COLLECTION_TONE[c.status]} status={c.status} />{c.events.some((e) => e.duplicate) ? <Pill tone="neutral" icon="copy">Duplicate event</Pill> : null}</div> },
    { key: 'time', label: 'Created / verified', sortValue: (c) => c.createdAt, render: (c) => <div className="small"><div>{when(c.createdAt, now())}</div><div className="muted">{c.verifiedAt ? `Verified ${when(c.verifiedAt, now())}` : 'Not verified'}</div></div> },
  ];

  return (
    <>
      <FinanceHead title="Collections" sub="Money received through the payment provider: wallet funding, driver packages and trip payments by transfer." />
      <Notice tone="info">
        Payment success is verified server side in the real system. Here every collection is test data from Paystack (test), and checks with the provider are simulated.
      </Notice>

      <div className="grid cols-4" style={{ marginTop: 16 }}>
        <Stat icon="checkCircle" label="Successful" value={money(totals.successful.amount)} sub={`${totals.successful.count} payments · fees ${money(totals.successful.fees)} shown separately`} onClick={() => setStatus('successful')} />
        <Stat icon="time" label="Pending" value={money(totals.pending.amount)} sub={`${totals.pending.count} waiting for the provider, not credited`} tone={totals.pending.count ? 'warning' : undefined} onClick={() => setStatus('pending')} />
        <Stat icon="alert" label="Failed or abandoned" value={money(totals.failed.amount)} sub={`${totals.failed.count} payments, nothing credited`} tone={totals.failed.count ? 'danger' : undefined} onClick={() => setStatus('failed')} />
        <Stat icon="wallet" label="Wallet funding received" value={money(scoped.filter((c) => c.purpose === 'wallet_funding' && c.status === 'successful').reduce((s, c) => s + c.amount, 0))} sub="Held for passengers, not revenue" />
      </div>

      <div className="section">
        <FilterBar count={`${rows.length} of ${scoped.length} in the selected city and dates`}>
          <SearchInput value={q} onChange={setQ} placeholder="Search reference or payer" />
          <Select<Purpose | 'all'> label="Purpose" value={purpose} onChange={setPurpose} options={[{ value: 'all', label: 'All purposes' }, ...(Object.keys(PURPOSE_LABEL) as Purpose[]).map((p) => ({ value: p, label: PURPOSE_LABEL[p] }))]} />
          <Select<CollectionStatus | 'all'> label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, ...(['initiated', 'pending', 'successful', 'failed', 'abandoned', 'reversed'] as CollectionStatus[]).map((s) => ({ value: s, label: label(s) }))]} />
        </FilterBar>
        <div className="card flush">
          <Table
           
            rows={rows}
            columns={columns}
            rowKey={(c) => c.id}
            onRowClick={(c) => setOpenId(c.id)}
            empty={
              <Empty title="No collections match" icon="exchange" action={purpose !== 'all' || status !== 'all' || q ? <Button size="sm" onClick={() => { setPurpose('all'); setStatus('all'); setQ(''); }}>Clear filters</Button> : undefined}>
                Try another status or purpose, or widen the date range at the top.
              </Empty>
            }
          />
        </div>
      </div>

      {open ? <CollectionDrawer c={open} name={names.get(open.payerId) ?? open.payerId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function CollectionDrawer({ c, name, onClose }: { c: CollectionRecord; name: string; onClose: () => void }) {
  const d = useData();
  const { now, mutate } = usePlatform();
  const { can } = useSession();
  const toast = useToast();
  const entries = collectionEntries(d.ledger, c);
  const pending = c.status === 'pending' || c.status === 'initiated';
  const canWork = can('reconciliation.work');

  const check = async (result: 'successful' | 'failed') => {
    let note = '';
    const r = await mutate({
      label: result === 'successful' ? 'Verify with provider' : 'Record provider failure',
      apply: (draft, ctx) => {
        const res = verifyCollection(draft, c.id, { now: ctx.now, result });
        if (res.ok) note = res.note ?? '';
        return res;
      },
      audit: () => ({
        action: result === 'successful' ? 'collection.verified' : 'collection.failed',
        target: { type: 'collection', id: c.id, label: c.reference },
        summary: `Checked ${c.reference} with ${c.provider} (simulated): ${note || result}`,
      }),
    });
    // The toast says whether money was credited, or the answer was a duplicate and nothing was applied.
    toast(r.ok ? note || 'Checked with provider' : r.error);
    return r;
  };

  return (
    <Drawer
      title={PURPOSE_LABEL[c.purpose]}
      sub={`${c.reference} · ${c.provider}`}
      onClose={onClose}
      footer={
        canWork ? (
          pending ? (
            <>
              <Button variant="danger-soft" icon="code" onClick={() => check('failed')}>Simulate failed result</Button>
              <Button variant="primary" icon="refresh" onClick={() => check('successful')}>Verify with provider</Button>
            </>
          ) : c.status === 'successful' ? (
            <Button icon="refresh" onClick={() => check('successful')}>Check again with provider</Button>
          ) : null
        ) : undefined
      }
    >
      <div className="row wrap">
        <StatusPill tone={COLLECTION_TONE[c.status]} status={c.status} />
        <SimTag />
      </div>
      {pending ? <Notice tone="warning" icon="time">Not credited until the provider confirms. Nothing is in the ledger for this payment yet.</Notice> : null}
      {c.status === 'failed' || c.status === 'abandoned' ? <Notice tone="danger">The provider did not confirm this payment. Nothing was credited.</Notice> : null}
      {canWork && (pending || c.status === 'successful') ? (
        <div className="small muted">
          Checks here are simulated: the test provider answers instantly. In the real system the backend asks the provider and credits once per reference, so checking again never credits twice.
        </div>
      ) : null}
      <KV
        items={[
          ['Payer', <RecordLink type={c.payerType} id={c.payerId}>{name}</RecordLink>],
          ['Payer type', label(c.payerType)],
          ['Amount', <Amount value={c.amount} plain strong />],
          ['Provider fee', c.fee ? money(c.fee) : 'None'],
          ['Treated as', PURPOSE_NOTE[c.purpose]],
          ['Created', when(c.createdAt, now())],
          ['Verified', c.verifiedAt ? when(c.verifiedAt, now()) : 'Not yet'],
        ]}
      />
      <div>
        <SubHead>Provider events</SubHead>
        {c.events.length ? (
          <Timeline
            items={c.events.map((e) => ({
              at: e.at,
              title: (
                <span className="row wrap" style={{ gap: 6 }}>
                  <span className="num">{e.event}</span>
                  {e.duplicate ? <Pill tone="neutral" icon="copy">Duplicate, not applied</Pill> : <Pill tone={e.event.startsWith('charge.success') ? 'success' : 'danger'}>Applied</Pill>}
                </span>
              ),
              sub: c.provider,
            }))}
          />
        ) : (
          <div className="muted small">No provider events yet. Waiting for the provider.</div>
        )}
      </div>
      <div>
        <SubHead>Linked ledger journal</SubHead>
        <LedgerLines entries={entries} now={now()} empty={pending ? 'No journal: not credited until confirmed.' : 'No journal found. See Reconciliation for unmatched items.'} />
      </div>
      {!canWork ? <Card muted><div className="small">Your role can view collections. Checking with the provider needs finance access.</div></Card> : null}
    </Drawer>
  );
}
