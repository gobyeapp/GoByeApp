import {
  APPROVAL_RULES,
  EXPENSE_OWNER_THRESHOLD,
  OPERATING_CATEGORIES,
  breakEven,
  budgetFor,
  monthKey,
  monthSpend,
  validateExpense,
  type Actor,
  type Budget,
  type CostCategory,
  type Expense,
  type Kobo,
  type Permission,
  type PlatformDataset,
  type Vendor,
  type VendorStatus,
} from '@gobye/core';
import type { Tone } from '@/ui/kit';

/**
 * Pure helpers for the Infrastructure and costs pages (D-057). Every figure comes from expenses staff
 * entered and approved; nothing is estimated except the clearly labelled month-end projection.
 */

export type Result = { ok: true; note?: string } | { ok: false; error: string };

/** Categories counted as infrastructure (technology services), a subset of operating costs. */
export const INFRA_CATEGORIES: readonly CostCategory[] = ['frontend_hosting', 'edge_network', 'backend_hosting', 'database', 'maps', 'sms_otp', 'email', 'monitoring', 'storage', 'security'];

export const VENDOR_STATUS: Record<VendorStatus, { tone: Tone; text: string }> = {
  active_paid: { tone: 'success', text: 'Paid plan' },
  free_plan: { tone: 'brand', text: 'Free plan' },
  trial: { tone: 'info', text: 'Test mode' },
  proposed: { tone: 'warning', text: 'Proposed' },
  not_chosen: { tone: 'neutral', text: 'Not chosen' },
};

export const EXPENSE_STATUS: Record<Expense['status'], { tone: Tone; text: string }> = {
  draft: { tone: 'neutral', text: 'Draft' },
  pending_approval: { tone: 'warning', text: 'Waiting approval' },
  approved: { tone: 'success', text: 'Approved' },
  rejected: { tone: 'danger', text: 'Rejected' },
  paid: { tone: 'success', text: 'Paid' },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-10" → "October 2026" (no ISO dates in visible text). */
export function monthLabel(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTHS[(mm ?? 1) - 1]} ${y}`;
}
export function shortMonth(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTHS[(mm ?? 1) - 1]!.slice(0, 3)} ${String(y).slice(2)}`;
}

/** The current month and the previous `n - 1` months, oldest first (Lagos time). */
export function recentMonths(now: number, n: number): string[] {
  const d = new Date(now + 3_600_000);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

/** Driver subscription revenue verified in a month: GoBye's only revenue (0% trip commission). */
export function subscriptionRevenue(d: Pick<PlatformDataset, 'collections'>, month: string): Kobo {
  return d.collections
    .filter((c) => c.purpose === 'package_purchase' && c.status === 'successful' && monthKey(c.verifiedAt ?? c.createdAt) === month)
    .reduce((s, c) => s + c.amount, 0) as Kobo;
}

export function activeDriverCount(d: Pick<PlatformDataset, 'drivers'>, now: number): number {
  return d.drivers.filter((x) => x.verification === 'approved' && !!x.access && x.access.expiresAt > now).length;
}

export function completedRidesIn(d: Pick<PlatformDataset, 'trips'>, month: string): number {
  return d.trips.filter((t) => t.status === 'completed' && t.completedAt && monthKey(t.completedAt) === month).length;
}

export function operatingSummary(d: PlatformDataset, month: string) {
  const operating = monthSpend(d.expenses, month, OPERATING_CATEGORIES);
  const infra = monthSpend(d.expenses, month, INFRA_CATEGORIES);
  const marketing = monthSpend(d.expenses, month, ['marketing']);
  const revenue = subscriptionRevenue(d, month);
  return { operating, infra, marketing, revenue, breakEven: breakEven({ operatingCost: operating, subscriptionRevenue: revenue }), budget: budgetFor(d.budgets, month, 'operating') };
}

/** Months (newest first) that have any approved or paid expense. */
export function monthsWithSpend(expenses: readonly Expense[]): string[] {
  return [...new Set(expenses.filter((e) => e.status === 'approved' || e.status === 'paid').map((e) => e.month))].sort().reverse();
}

/* ---------- Expense capture and decisions (prototype mutations, all audited by the caller) ---------- */

export interface ExpenseInput {
  vendorId: string;
  description: string;
  currency: 'NGN' | 'USD';
  /** Whole naira (NGN) or whole cents (USD). */
  amountMinor: number;
  fxRate?: number;
  month: string;
  recurring: boolean;
  invoice?: { fileName: string; sizeBytes: number };
  note?: string;
}

/** Naira amount in kobo from the form: naira × 100, or dollars at the stated rate. */
export function expenseAmount(i: Pick<ExpenseInput, 'currency' | 'amountMinor' | 'fxRate'>): Kobo {
  if (i.currency === 'NGN') return Math.round(i.amountMinor * 100) as Kobo;
  return Math.round((i.amountMinor / 100) * (i.fxRate ?? 0) * 100) as Kobo;
}

export const needsOwner = (amount: Kobo) => amount >= EXPENSE_OWNER_THRESHOLD;

const nextId = (p: string, xs: { id: string }[]) => `${p}-${String(xs.length + 1).padStart(4, '0')}`;
const person = (a: Actor) => ({ id: 'id' in a ? a.id : a.name, name: a.name });

/**
 * Record an expense and send it for approval. Below the threshold finance decides on the Expenses page;
 * at or above it an owner approval request is created. Invoices are only noted: uploads need the
 * backend and private R2 storage (not connected).
 */
export function captureExpense(draft: PlatformDataset, input: ExpenseInput, ctx: { now: number; actor: Actor }): Result & { id?: string } {
  const vendor = draft.vendors.find((v) => v.id === input.vendorId);
  const amount = expenseAmount(input);
  const original = input.currency === 'USD' ? { currency: 'USD' as const, cents: input.amountMinor, fxRate: input.fxRate ?? 0 } : undefined;
  const problems = validateExpense({ vendorId: input.vendorId, description: input.description, amount, month: input.month, original }, draft.vendors);
  if (problems.length) return { ok: false, error: problems[0]!.message };
  const id = nextId('exp', draft.expenses);
  const e: Expense = {
    id,
    vendorId: input.vendorId,
    category: vendor!.category,
    description: input.description.trim(),
    amount,
    original,
    month: input.month,
    incurredAt: ctx.now,
    status: 'pending_approval',
    invoice: input.invoice ? { ...input.invoice, storage: 'pending_backend' } : undefined,
    recurring: input.recurring,
    createdBy: person(ctx.actor),
    createdAt: ctx.now,
    reconciled: false,
    note: input.note?.trim() || undefined,
  };
  draft.expenses.unshift(e);
  if (needsOwner(amount)) {
    draft.approvals.unshift({
      id: `apr-${String(draft.approvals.length + 1).padStart(4, '0')}`,
      kind: 'expense',
      title: `Approve expense: ${vendor!.name}, ${e.description}`,
      requestedBy: ctx.actor,
      requestedAt: ctx.now,
      target: { type: 'expense', id, label: `Expense ${id}` },
      amount,
      status: 'pending',
      approverRoles: APPROVAL_RULES.expense.approverRoles,
    });
  }
  return { ok: true, id, note: needsOwner(amount) ? 'Sent to the owner for approval' : 'Waiting for finance approval' };
}

export type ExpenseAction = 'approve' | 'reject' | 'mark_paid' | 'reconcile' | 'unreconcile';

/** Why an action isn't available, or null when it is. */
export function expenseActionBlock(e: Expense, action: ExpenseAction, p: { can: (perm: Permission) => boolean; staffId?: string }): string | null {
  if (action === 'approve' || action === 'reject') {
    if (e.status !== 'pending_approval') return 'Only expenses waiting for approval';
    if (!p.can('costs.approve')) return 'Needs cost approval access';
    if (e.createdBy.id === p.staffId) return 'Nobody approves their own expense';
    if (action === 'approve' && needsOwner(e.amount)) return 'At or above the threshold: the owner decides in Approvals';
    return null;
  }
  if (!p.can('costs.manage') && !p.can('costs.approve')) return 'Needs cost access';
  if (action === 'mark_paid') return e.status === 'approved' ? null : 'Only approved expenses can be marked paid';
  if (action === 'reconcile') return e.status === 'approved' || e.status === 'paid' ? (e.reconciled ? 'Already reconciled' : null) : 'Approve it first';
  return e.reconciled ? null : 'Not reconciled';
}

export function applyExpenseAction(draft: PlatformDataset, id: string, action: ExpenseAction, ctx: { now: number; actor: Actor; can: (perm: Permission) => boolean; reason?: string }): Result {
  const e = draft.expenses.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Expense not found' };
  const block = expenseActionBlock(e, action, { can: ctx.can, staffId: 'id' in ctx.actor ? ctx.actor.id : undefined });
  if (block) return { ok: false, error: block };
  if (action === 'approve') {
    e.status = 'approved';
    e.approvedBy = person(ctx.actor);
    e.approvedAt = ctx.now;
  } else if (action === 'reject') {
    if (!ctx.reason?.trim()) return { ok: false, error: 'Add a reason' };
    e.status = 'rejected';
    e.note = `Rejected: ${ctx.reason.trim()}`;
    // Close an open owner request for the same expense, so it can't be approved later.
    for (const a of draft.approvals) if (a.kind === 'expense' && a.target.id === id && a.status === 'pending') Object.assign(a, { status: 'rejected', decidedBy: ctx.actor, decidedAt: ctx.now, note: ctx.reason.trim() });
  } else if (action === 'mark_paid') e.status = 'paid';
  else if (action === 'reconcile') e.reconciled = true;
  else e.reconciled = false;
  return { ok: true };
}

/* ---------- Vendors and budgets ---------- */

export interface VendorInput {
  name: string;
  category: CostCategory;
  plan: string;
  status: VendorStatus;
  currency: 'NGN' | 'USD';
  owner: string;
  note: string;
}

export function validateVendor(v: VendorInput): string | null {
  if (!v.name.trim()) return 'Enter the vendor name.';
  if (!v.plan.trim()) return 'Enter the plan (for example "Free" or "Pro").';
  if (!v.owner.trim()) return 'Name who looks after this vendor.';
  return null;
}

export function saveVendor(draft: PlatformDataset, input: VendorInput, id?: string): Result & { id?: string; before?: Vendor } {
  const err = validateVendor(input);
  if (err) return { ok: false, error: err };
  if (id) {
    const v = draft.vendors.find((x) => x.id === id);
    if (!v) return { ok: false, error: 'Vendor not found' };
    const before = { ...v };
    Object.assign(v, { ...input, name: input.name.trim(), plan: input.plan.trim(), owner: input.owner.trim(), note: input.note.trim() });
    return { ok: true, id, before };
  }
  const nid = `ven-${String(draft.vendors.length + 1).padStart(3, '0')}`;
  draft.vendors.push({ id: nid, ...input, name: input.name.trim(), plan: input.plan.trim(), owner: input.owner.trim(), note: input.note.trim(), billing: 'manual' });
  return { ok: true, id: nid };
}

export function setBudget(draft: PlatformDataset, input: { month: string; scope: Budget['scope']; naira: number }, ctx: { now: number; actor: Actor }): Result & { before?: Kobo } {
  if (!Number.isFinite(input.naira) || input.naira <= 0) return { ok: false, error: 'Enter a budget above ₦0.' };
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { ok: false, error: 'Choose a month.' };
  const before = budgetFor(draft.budgets, input.month, input.scope)?.amount;
  draft.budgets.push({ id: `bud-${String(draft.budgets.length + 1).padStart(4, '0')}`, month: input.month, scope: input.scope, amount: Math.round(input.naira * 100) as Kobo, setBy: person(ctx.actor), setAt: ctx.now });
  return { ok: true, before };
}
