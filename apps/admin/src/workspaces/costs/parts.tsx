import { useState, type ReactNode } from 'react';
import { COST_CATEGORY_LABEL, EXPENSE_OWNER_THRESHOLD, monthKey, type Expense } from '@gobye/core';
import { money, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, ConfirmDialog, Drawer, Field, KV, Notice, PageHead, Pill, Select, Timeline } from '@/ui/kit';
import './costs.css';
import { EXPENSE_STATUS, VENDOR_STATUS, applyExpenseAction, captureExpense, expenseActionBlock, expenseAmount, monthLabel, needsOwner, recentMonths, type ExpenseAction, type ExpenseInput } from './logic';

export function CostsHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <PageHead
      eyebrow="Infrastructure & costs"
      title={title}
      sub={sub}
      actions={actions}
      meta={
        <>
          <Pill tone="neutral" icon="edit">Manual entry</Pill>
          <Pill tone="neutral" icon="plugin">No billing integration connected</Pill>
        </>
      }
    />
  );
}

export function VendorStatusPill({ status }: { status: keyof typeof VENDOR_STATUS }) {
  const s = VENDOR_STATUS[status];
  return <Pill tone={s.tone} icon={null}>{s.text}</Pill>;
}

export function ExpenseStatusPill({ status }: { status: Expense['status'] }) {
  const s = EXPENSE_STATUS[status];
  return <Pill tone={s.tone}>{s.text}</Pill>;
}

/** "Record an expense" button + form drawer. Permission gated (costs.manage or costs.approve). */
export function RecordExpense({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const allowed = can('costs.manage') || can('costs.approve');
  return (
    <>
      <Button variant={variant} icon="add" onClick={() => setOpen(true)} disabledReason={allowed ? undefined : 'Needs cost access (finance or developer)'}>
        Record an expense
      </Button>
      {open ? <ExpenseForm onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ExpenseForm({ onClose }: { onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const act = useAction();
  const months = recentMonths(now(), 6).reverse();
  const [f, setF] = useState<ExpenseInput>({ vendorId: d.vendors[0]?.id ?? '', description: '', currency: 'NGN', amountMinor: 0, fxRate: undefined, month: monthKey(now()), recurring: false });
  const [amountText, setAmountText] = useState('');
  const [fxText, setFxText] = useState('');
  const [tried, setTried] = useState(false);
  const vendor = d.vendors.find((v) => v.id === f.vendorId);
  const amount = expenseAmount(f);
  const set = (p: Partial<ExpenseInput>) => setF((x) => ({ ...x, ...p }));
  const amountErr = tried && !(amount > 0) ? (f.currency === 'USD' && !(f.fxRate! > 0) ? 'Enter the dollar amount and the exchange rate used.' : 'Enter an amount above ₦0.') : undefined;
  const descErr = tried && !f.description.trim() ? 'Say what the cost is for.' : undefined;

  const submit = async () => {
    setTried(true);
    if (!(amount > 0) || !f.description.trim()) return;
    const r = await act(
      {
        label: 'Record expense',
        apply: (draft, ctx) => captureExpense(draft, f, ctx),
        audit: (draft) => {
          const e = draft.expenses[0]!;
          return { action: 'expense.recorded', target: { type: 'expense', id: e.id, label: `Expense ${e.id}` }, summary: `Recorded ${money(e.amount)} for ${vendor?.name ?? 'vendor'} (${monthLabel(e.month)})`, reason: e.description };
        },
      },
      needsOwner(amount) ? 'Expense recorded and sent to the owner' : 'Expense recorded, waiting for finance approval',
    );
    if (r.ok) onClose();
  };

  return (
    <Drawer
      title="Record an expense"
      sub="Manual entry. It counts towards operating cost once approved."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>Send for approval</Button>
        </>
      }
    >
      <div className="cost-form">
        <Select label="Vendor" value={f.vendorId} onChange={(v) => set({ vendorId: v })} options={d.vendors.map((v) => ({ value: v.id, label: v.name }))} />
        <div className="small muted">Category: {vendor ? COST_CATEGORY_LABEL[vendor.category] : 'None'}{vendor ? ` · ${vendor.plan}` : ''}</div>
        <Field label="What it is for" error={descErr}>
          {(id) => <input id={id} className="input" value={f.description} aria-invalid={!!descErr} onChange={(e) => set({ description: e.target.value })} placeholder="For example: Pro plan, October" />}
        </Field>
        <div className="cost-form-row">
          <Select label="Currency" value={f.currency} onChange={(v) => {
            const n = Number(amountText.replace(/,/g, ''));
            const cur = v as 'NGN' | 'USD';
            set({ currency: cur, amountMinor: Number.isFinite(n) ? (cur === 'NGN' ? n : Math.round(n * 100)) : 0 });
          }} options={[{ value: 'NGN', label: 'Naira (₦)' }, { value: 'USD', label: 'US dollars ($)' }]} />
          <Field label={f.currency === 'NGN' ? 'Amount (₦)' : 'Amount ($)'} error={amountErr}>
            {(id) => (
              <input
                id={id}
                className="input num"
                inputMode="decimal"
                value={amountText}
                aria-invalid={!!amountErr}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  const n = Number(e.target.value.replace(/,/g, ''));
                  set({ amountMinor: Number.isFinite(n) ? (f.currency === 'NGN' ? n : Math.round(n * 100)) : 0 });
                }}
              />
            )}
          </Field>
          {f.currency === 'USD' ? (
            <Field label="Rate used (₦ per $)" hint="From the bank statement">
              {(id) => (
                <input
                  id={id}
                  className="input num"
                  inputMode="decimal"
                  value={fxText}
                  onChange={(e) => {
                    setFxText(e.target.value);
                    const n = Number(e.target.value.replace(/,/g, ''));
                    set({ fxRate: Number.isFinite(n) && n > 0 ? n : undefined });
                  }}
                />
              )}
            </Field>
          ) : null}
        </div>
        <Select label="Month it belongs to" value={f.month} onChange={(v) => set({ month: v })} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
        <label className="row small">
          <input type="checkbox" checked={f.recurring} onChange={(e) => set({ recurring: e.target.checked })} /> Repeats every month
        </label>
        <Field label="Invoice" hint="Only the file name is kept for now. Uploading needs the backend and private storage, which aren’t connected yet.">
          {(id) => (
            <input
              id={id}
              type="file"
              className="input"
              accept=".pdf,image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                set({ invoice: file ? { fileName: file.name, sizeBytes: file.size } : undefined });
              }}
            />
          )}
        </Field>
        <div className="cost-total">
          <span className="muted">Counts as</span>
          <span className="num strong">{amount > 0 ? money(amount) : 'Not set'}</span>
        </div>
        <Notice tone="info">
          {needsOwner(amount)
            ? `${money(amount)} is at or above ${money(EXPENSE_OWNER_THRESHOLD)}: the owner approves it in Approvals.`
            : `Below ${money(EXPENSE_OWNER_THRESHOLD)}: a finance colleague approves it here. Nobody approves their own expense.`}
        </Notice>
      </div>
    </Drawer>
  );
}

const ACTION_LABEL: Record<ExpenseAction, string> = { approve: 'Approve', reject: 'Reject', mark_paid: 'Mark paid', reconcile: 'Mark reconciled', unreconcile: 'Undo reconciled' };

/** Expense detail side sheet with decisions and its audit trail. */
export function ExpenseDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can, staff } = useSession();
  const act = useAction();
  const [rejecting, setRejecting] = useState(false);
  const e = d.expenses.find((x) => x.id === id);
  if (!e) return null;
  const vendor = d.vendors.find((v) => v.id === e.vendorId);
  const block = (a: ExpenseAction) => expenseActionBlock(e, a, { can, staffId: staff?.id });
  const run = (a: ExpenseAction, reason?: string) =>
    act(
      {
        label: ACTION_LABEL[a],
        apply: (draft, ctx) => applyExpenseAction(draft, id, a, { ...ctx, can, reason }),
        audit: () => ({ action: `expense.${a}`, target: { type: 'expense', id, label: `Expense ${id}` }, summary: `${ACTION_LABEL[a]}: ${money(e.amount)} ${vendor?.name ?? ''}`.trim(), reason }),
      },
      `${ACTION_LABEL[a]}: done`,
    );
  const trail = d.audit.filter((x) => x.target.type === 'expense' && x.target.id === id).sort((a, b) => b.at - a.at);
  const ownerReq = d.approvals.find((a) => a.kind === 'expense' && a.target.id === id);
  const actions: ExpenseAction[] = e.reconciled ? ['approve', 'reject', 'mark_paid', 'unreconcile'] : ['approve', 'reject', 'mark_paid', 'reconcile'];

  return (
    <>
      <Drawer
        title={e.description}
        sub={`${vendor?.name ?? 'Vendor'} · ${monthLabel(e.month)}`}
        onClose={onClose}
        footer={actions.map((a) => (
          <Button key={a} size="sm" variant={a === 'approve' ? 'primary' : a === 'reject' ? 'danger-soft' : 'secondary'} disabledReason={block(a) ?? undefined} onClick={() => (a === 'reject' ? setRejecting(true) : run(a))}>
            {ACTION_LABEL[a]}
          </Button>
        ))}
      >
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <ExpenseStatusPill status={e.status} />
          {e.reconciled ? <Pill tone="success" icon="balance">Reconciled</Pill> : <Pill tone="neutral" icon="balance">Not reconciled</Pill>}
          {e.recurring ? <Pill tone="neutral" icon="refresh">Monthly</Pill> : null}
        </div>
        <div className="cost-amount num">{money(e.amount)}</div>
        <KV
          items={[
            ['Category', COST_CATEGORY_LABEL[e.category]],
            ['Original', e.original ? `$${(e.original.cents / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })} at ₦${e.original.fxRate.toLocaleString('en-NG')} per $` : 'Billed in naira'],
            ['Invoice', e.invoice ? `${e.invoice.fileName} · not uploaded yet (needs the backend)` : 'None attached'],
            ['Recorded by', `${e.createdBy.name} · ${when(e.createdAt, now())}`],
            ['Approved by', e.approvedBy ? `${e.approvedBy.name} · ${when(e.approvedAt, now())}` : 'Not yet'],
            ['Owner approval', needsOwner(e.amount) ? (ownerReq ? `Request ${ownerReq.status}` : 'Needed') : 'Not needed'],
            ['Note', e.note ?? 'None'],
          ]}
        />
        <div>
          <h3 className="strong" style={{ fontSize: 14, marginBottom: 10 }}>Audit trail</h3>
          {trail.length ? <Timeline items={trail.map((t) => ({ at: t.at, title: t.summary, sub: `${t.actor.name}${t.reason ? ` · ${t.reason}` : ''}` }))} /> : <div className="muted small">No changes recorded yet.</div>}
        </div>
      </Drawer>
      {rejecting ? (
        <ConfirmDialog
          title="Reject this expense"
          body="It won’t count towards operating cost. The person who recorded it sees your reason."
          confirmLabel="Reject"
          danger
          requireReason
          onCancel={() => setRejecting(false)}
          onConfirm={async (reason) => {
            setRejecting(false);
            await run('reject', reason);
          }}
        />
      ) : null}
    </>
  );
}

export function SpendBar({ value, max, label }: { value: number; max: number; label: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="spend-bar" role="img" aria-label={label}>
      <span style={{ width: `${w}%` }} />
    </div>
  );
}

export function FreePlanNote() {
  return (
    <div className="row small muted" style={{ gap: 6 }}>
      <Icon name="info" size={14} /> Services in use today are on free plans, so their cost is ₦0 until an invoice is recorded.
    </div>
  );
}
