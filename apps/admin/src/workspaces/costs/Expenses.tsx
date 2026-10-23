import { useMemo, useState } from 'react';
import { COST_CATEGORY_LABEL, EXPENSE_OWNER_THRESHOLD, type CostCategory, type Expense } from '@gobye/core';
import { money, when } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Card, Empty, FilterBar, Notice, SearchInput, Select, Stat, Table, Tabs, type Column } from '@/ui/kit';
import { CostsHead, ExpenseDrawer, ExpenseStatusPill, RecordExpense } from './parts';
import { monthLabel, needsOwner } from './logic';

type Tab = 'all' | 'pending_approval' | 'approved' | 'paid' | 'rejected';

export default function Expenses() {
  const d = useData();
  const { now } = usePlatform();
  const [tab, setTab] = useState<Tab>('all');
  const [cat, setCat] = useState<CostCategory | 'all'>('all');
  const [month, setMonth] = useState<string>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const vendorName = (id: string) => d.vendors.find((v) => v.id === id)?.name ?? id;

  const count = (s: Tab) => (s === 'all' ? d.expenses.length : d.expenses.filter((e) => e.status === s).length);
  const months = [...new Set(d.expenses.map((e) => e.month))].sort().reverse();
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return d.expenses
      .filter((e) => (tab === 'all' || e.status === tab) && (cat === 'all' || e.category === cat) && (month === 'all' || e.month === month))
      .filter((e) => !t || e.description.toLowerCase().includes(t) || vendorName(e.vendorId).toLowerCase().includes(t) || e.id.includes(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.expenses, tab, cat, month, q]);
  const pending = d.expenses.filter((e) => e.status === 'pending_approval');
  const approvedTotal = d.expenses.filter((e) => e.status === 'approved' || e.status === 'paid').reduce((s, e) => s + e.amount, 0);
  const unreconciled = d.expenses.filter((e) => (e.status === 'approved' || e.status === 'paid') && !e.reconciled).length;

  const columns: Column<Expense>[] = [
    { key: 'desc', label: 'Expense', sortValue: (e) => e.description, render: (e) => <div><div className="cell-title">{e.description}</div><div className="cell-sub">{vendorName(e.vendorId)} · {COST_CATEGORY_LABEL[e.category]}</div></div> },
    { key: 'month', label: 'Month', sortValue: (e) => e.month, render: (e) => monthLabel(e.month) },
    { key: 'status', label: 'Status', render: (e) => <div className="row" style={{ gap: 6 }}><ExpenseStatusPill status={e.status} />{needsOwner(e.amount) && e.status === 'pending_approval' ? <span className="small muted">Owner</span> : null}</div> },
    { key: 'recon', label: 'Reconciled', render: (e) => (e.reconciled ? 'Yes' : <span className="muted">No</span>) },
    { key: 'by', label: 'Recorded', sortValue: (e) => e.createdAt, render: (e) => <div className="small"><div>{e.createdBy.name}</div><div className="muted">{when(e.createdAt, now())}</div></div> },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (e) => e.amount, render: (e) => <span className="num strong">{money(e.amount)}</span> },
  ];

  return (
    <>
      <CostsHead title="Expenses" sub="Every operating cost, entered with its invoice and approved by a second person before it counts." actions={<RecordExpense />} />
      <div className="grid cols-4">
        <Stat icon="time" label="Waiting approval" value={pending.length.toLocaleString('en-NG')} tone={pending.length ? 'warning' : undefined} sub={pending.length ? money(pending.reduce((s, e) => s + e.amount, 0)) : 'Nothing waiting'} />
        <Stat icon="checkCircle" label="Approved or paid" value={money(approvedTotal)} sub="All months" />
        <Stat icon="balance" label="Not reconciled" value={unreconciled.toLocaleString('en-NG')} sub="Approved but not matched to a bank payment" />
        <Stat icon="shield" label="Owner approves from" value={money(EXPENSE_OWNER_THRESHOLD)} sub="Placeholder threshold; finance below it" />
      </div>
      <div className="section">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: 'All', count: count('all') },
            { value: 'pending_approval', label: 'Waiting approval', count: count('pending_approval') },
            { value: 'approved', label: 'Approved', count: count('approved') },
            { value: 'paid', label: 'Paid', count: count('paid') },
            { value: 'rejected', label: 'Rejected', count: count('rejected') },
          ]}
        />
        {d.expenses.length ? (
          <>
            <FilterBar count={`${rows.length.toLocaleString('en-NG')} of ${d.expenses.length.toLocaleString('en-NG')}`}>
              <SearchInput value={q} onChange={setQ} placeholder="Search expense or vendor" />
              <Select<CostCategory | 'all'> label="Category" value={cat} onChange={setCat} options={[{ value: 'all', label: 'Every category' }, ...(Object.keys(COST_CATEGORY_LABEL) as CostCategory[]).map((c) => ({ value: c, label: COST_CATEGORY_LABEL[c] }))]} />
              <Select label="Month" value={month} onChange={setMonth} options={[{ value: 'all', label: 'Every month' }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]} />
            </FilterBar>
            <Card flush>
              <Table rows={rows} columns={columns} rowKey={(e) => e.id} onRowClick={(e) => setOpenId(e.id)} pageSize={25} caption="Expenses" empty={<Empty title="No expenses match" icon="filter">Try another tab or clear the filters.</Empty>} />
            </Card>
          </>
        ) : (
          <Card>
            <Empty title="No expenses recorded" art="server" action={<RecordExpense variant="secondary" />}>
              Record a bill with its invoice. Below the threshold a finance colleague approves it; above it, the owner does.
            </Empty>
          </Card>
        )}
      </div>
      <div className="section">
        <Notice tone="info">Invoices are noted by file name only. Storing them needs the backend and private R2 storage, which aren’t connected yet. Automatic syncing of provider bills is a planned automation (not connected).</Notice>
      </div>
      {openId ? <ExpenseDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
