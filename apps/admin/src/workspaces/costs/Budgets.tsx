import { useState } from 'react';
import { COST_CATEGORY_LABEL, OPERATING_CATEGORIES, budgetFor, budgetUtilisation, monthKey, monthSpend, type Budget, type CostCategory } from '@gobye/core';
import { money, pct, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, Drawer, Empty, Field, Pill, Select, Table, type Column } from '@/ui/kit';
import { CostsHead, SpendBar } from './parts';
import { monthLabel, recentMonths, setBudget } from './logic';

type Scope = Budget['scope'];
const scopeLabel = (s: Scope) => (s === 'operating' ? 'Operating total' : COST_CATEGORY_LABEL[s]);

export default function Budgets() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const [month, setMonth] = useState(monthKey(now()));
  const [editing, setEditing] = useState<Scope | null>(null);
  const months = recentMonths(now(), 6).reverse();
  const nextMonth = recentMonths(now() + 32 * 86_400_000, 1)[0]!;
  const allMonths = [nextMonth, ...months.filter((m) => m !== nextMonth)];
  const scopes: Scope[] = ['operating', ...OPERATING_CATEGORIES];
  const rows = scopes.map((scope) => {
    const b = budgetFor(d.budgets, month, scope);
    const spent = scope === 'operating' ? monthSpend(d.expenses, month, OPERATING_CATEGORIES) : monthSpend(d.expenses, month, [scope]);
    return { scope, b, spent, util: budgetUtilisation(spent, b) };
  });
  const canSet = can('costs.approve');

  const columns: Column<(typeof rows)[number]>[] = [
    { key: 's', label: 'Budget', render: (r) => <span className={r.scope === 'operating' ? 'strong' : undefined}>{scopeLabel(r.scope)}</span> },
    { key: 'b', label: 'Budget', align: 'right', sortValue: (r) => r.b?.amount ?? 0, render: (r) => (r.b ? <span className="num">{money(r.b.amount)}</span> : <span className="muted">Not set</span>) },
    { key: 'sp', label: 'Spent', align: 'right', sortValue: (r) => r.spent, render: (r) => <span className="num">{money(r.spent)}</span> },
    {
      key: 'u',
      label: 'Used',
      sortValue: (r) => r.util ?? -1,
      render: (r) =>
        r.util === null ? (
          <span className="muted small">No budget</span>
        ) : (
          <div className="row" style={{ minWidth: 160 }}>
            <div style={{ flex: 1 }}><SpendBar value={Math.min(r.util, 1)} max={1} label={`${pct(r.util)} used`} /></div>
            <span className="num small">{pct(r.util)}</span>
            {r.util > 1 ? <Pill tone="danger">Over</Pill> : null}
          </div>
        ),
    },
    { key: 'a', label: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(r.scope)} disabledReason={canSet ? undefined : 'Only finance or the owner set budgets'}>Set</Button> },
  ];
  const any = d.budgets.some((b) => b.month === month);

  return (
    <>
      <CostsHead title="Budgets" sub="Monthly limits for operating cost, overall and by category. Marketing budgets sit outside the operating total." />
      <div className="row" style={{ marginBottom: 16 }}>
        <Select label="Month" value={month} onChange={setMonth} options={allMonths.map((m) => ({ value: m, label: monthLabel(m) }))} />
      </div>
      {!any ? (
        <Card className="section" muted>
          <Empty title={`No budget set for ${monthLabel(month)}`} art="analytics" action={<Button variant="primary" icon="add" onClick={() => setEditing('operating')} disabledReason={canSet ? undefined : 'Only finance or the owner set budgets'}>Set operating budget</Button>}>
            Without a budget the dashboard can’t show how much is used. Start with the operating total; add categories when bills arrive.
          </Empty>
        </Card>
      ) : null}
      <Card flush className="section">
        <Table rows={rows} columns={columns} rowKey={(r) => r.scope} caption={`Budgets for ${monthLabel(month)}`} />
      </Card>
      <div className="section small muted">Changes are kept as history: {d.budgets.length ? `${d.budgets.length} budget entries, latest ${when(Math.max(...d.budgets.map((b) => b.setAt)), now())}.` : 'none yet.'}</div>
      {editing ? <BudgetForm month={month} scope={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function BudgetForm({ month, scope, onClose }: { month: string; scope: Scope; onClose: () => void }) {
  const d = useData();
  const act = useAction();
  const current = budgetFor(d.budgets, month, scope);
  const [text, setText] = useState(current ? String(current.amount / 100) : '');
  const [sc, setSc] = useState<Scope>(scope);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const naira = Number(text.replace(/,/g, ''));
    if (!(naira > 0)) return setErr('Enter a budget above ₦0.');
    const before = budgetFor(d.budgets, month, sc)?.amount;
    const r = await act({
      label: 'Set budget',
      apply: (draft, ctx) => setBudget(draft, { month, scope: sc, naira }, ctx),
      audit: () => ({ action: 'budget.set', target: { type: 'config', id: `budget:${month}:${sc}`, label: `${scopeLabel(sc)} budget, ${monthLabel(month)}` }, summary: `Set ${scopeLabel(sc)} budget for ${monthLabel(month)}`, diff: [{ field: 'Budget', from: before ? money(before) : 'Not set', to: money(Math.round(naira * 100)) }] }),
    });
    if (r.ok) onClose();
  };
  return (
    <Drawer title="Set budget" sub={monthLabel(month)} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save budget</Button></>}>
      <div className="cost-form">
        <Select<Scope> label="Applies to" value={sc} onChange={setSc} options={(['operating', ...OPERATING_CATEGORIES, 'marketing'] as Scope[]).map((s) => ({ value: s, label: scopeLabel(s) }))} />
        <Field label="Budget (₦)" error={err ?? undefined} hint="Recorded with your name; earlier values stay in the history.">
          {(id) => <input id={id} className="input num" inputMode="decimal" value={text} aria-invalid={!!err} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </div>
    </Drawer>
  );
}

export type { CostCategory };
