import { DRIVER_ACCESS_PACKAGES } from '../payments';
import type { Kobo } from '../types';

/**
 * Infrastructure and operating costs (D-057). Manual capture first: no billing integration is connected,
 * so every figure comes from expenses staff enter (with an invoice) and owner-approved budgets.
 * Marketing is tracked but EXCLUDED from the agreed operating break-even.
 *
 * Seeds are honest: the services GoBye uses today are on free plans (₦0), everything else is "not chosen".
 * No expense, bill or budget is invented.
 */

export type CostCategory =
  | 'frontend_hosting'
  | 'edge_network'
  | 'backend_hosting'
  | 'database'
  | 'maps'
  | 'sms_otp'
  | 'email'
  | 'monitoring'
  | 'storage'
  | 'security'
  | 'staff_operations'
  | 'maintenance'
  | 'compliance'
  | 'payment_provider'
  | 'marketing';

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  frontend_hosting: 'Frontend hosting',
  edge_network: 'Edge and network',
  backend_hosting: 'Backend hosting',
  database: 'Database',
  maps: 'Maps APIs',
  sms_otp: 'SMS and OTP',
  email: 'Email',
  monitoring: 'Monitoring',
  storage: 'Storage',
  security: 'Security',
  staff_operations: 'Staff and operations',
  maintenance: 'Maintenance',
  compliance: 'Compliance',
  payment_provider: 'Payment provider',
  marketing: 'Marketing',
};

/** Categories counted in the operating break-even (everything except marketing). */
export const OPERATING_CATEGORIES: readonly CostCategory[] = (Object.keys(COST_CATEGORY_LABEL) as CostCategory[]).filter((c) => c !== 'marketing');

export type VendorStatus = 'active_paid' | 'free_plan' | 'trial' | 'proposed' | 'not_chosen';
export interface Vendor {
  id: string;
  name: string;
  category: CostCategory;
  plan: string;
  status: VendorStatus;
  /** How cost data arrives. No billing API is connected yet. */
  billing: 'manual' | 'not_connected';
  currency: 'NGN' | 'USD';
  note: string;
  owner: string;
}

export type ExpenseStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'paid';
export interface Expense {
  id: string;
  vendorId: string;
  category: CostCategory;
  description: string;
  /** Naira amount in kobo (converted at `fxRate` when billed in dollars). */
  amount: Kobo;
  original?: { currency: 'USD'; cents: number; fxRate: number };
  /** The month it belongs to, "2026-10". */
  month: string;
  incurredAt: number;
  status: ExpenseStatus;
  /** Invoice file: stored only after upload through the backend to private R2 storage (not connected yet). */
  invoice?: { fileName: string; sizeBytes: number; storage: 'not_uploaded' | 'pending_backend' | 'stored' };
  recurring: boolean;
  createdBy: { id: string; name: string };
  createdAt: number;
  approvedBy?: { id: string; name: string };
  approvedAt?: number;
  reconciled: boolean;
  note?: string;
}

export interface Budget {
  id: string;
  month: string;
  /** A category, or 'operating' for the operating total. */
  scope: CostCategory | 'operating';
  amount: Kobo;
  setBy: { id: string; name: string };
  setAt: number;
}

/** Month key in Lagos time (WAT, UTC+1). */
export const monthKey = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 7);

const counts = (e: Expense) => e.status === 'approved' || e.status === 'paid';

/** Approved and paid spend for a month, optionally limited to categories. */
export function monthSpend(expenses: readonly Expense[], month: string, categories?: readonly CostCategory[]): Kobo {
  return expenses.filter((e) => e.month === month && counts(e) && (!categories || categories.includes(e.category))).reduce((s, e) => s + e.amount, 0) as Kobo;
}

export function spendByCategory(expenses: readonly Expense[], month: string): { category: CostCategory; amount: Kobo }[] {
  const m = new Map<CostCategory, number>();
  for (const e of expenses) if (e.month === month && counts(e)) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  return [...m.entries()].map(([category, amount]) => ({ category, amount: amount as Kobo })).sort((a, b) => b.amount - a.amount);
}

/**
 * Straight-line month-end projection from spend so far. An estimate, labelled as one. Null before any
 * spend is recorded or in the first two days (too little to project from).
 */
export function projectedMonthEnd(spentSoFar: Kobo, now: number): Kobo | null {
  const d = new Date(now + 3_600_000);
  const day = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (spentSoFar <= 0 || day < 3) return null;
  return Math.round((spentSoFar / day) * daysInMonth) as Kobo;
}

export function budgetFor(budgets: readonly Budget[], month: string, scope: Budget['scope']): Budget | undefined {
  return budgets.filter((b) => b.month === month && b.scope === scope).sort((a, b) => b.setAt - a.setAt)[0];
}

/** Share of budget used; null when no budget is set (never assume one). */
export function budgetUtilisation(spent: Kobo, budget: Budget | undefined): number | null {
  if (!budget || budget.amount <= 0) return null;
  return spent / budget.amount;
}

/** Cost per unit; null when there are no units (no division by zero, no invented figure). */
export const perUnit = (cost: Kobo, units: number): Kobo | null => (units > 0 ? (Math.round(cost / units) as Kobo) : null);

/**
 * Operating break-even against driver subscription revenue (the only GoBye revenue: 0% commission).
 * Uses the confirmed prices. Returns how many monthly passes, or daily passes, cover the operating cost.
 */
export function breakEven(p: { operatingCost: Kobo; subscriptionRevenue: Kobo }) {
  const daily = DRIVER_ACCESS_PACKAGES.find((x) => x.id === 'daily')!.price;
  const monthly = DRIVER_ACCESS_PACKAGES.find((x) => x.id === 'monthly')!.price;
  const covered = p.operatingCost > 0 ? p.subscriptionRevenue / p.operatingCost : null;
  return {
    operatingCost: p.operatingCost,
    subscriptionRevenue: p.subscriptionRevenue,
    /** Revenue ÷ cost. ≥ 1 means operating costs are covered. Null when no cost is recorded. */
    coverage: covered,
    gap: Math.max(0, p.operatingCost - p.subscriptionRevenue) as Kobo,
    monthlyPassesNeeded: Math.ceil(p.operatingCost / monthly),
    dailyPassesNeeded: Math.ceil(p.operatingCost / daily),
  };
}

export interface ExpenseProblem {
  field: keyof Expense | 'original';
  message: string;
}

export function validateExpense(e: Pick<Expense, 'vendorId' | 'description' | 'amount' | 'month' | 'original'>, vendors: readonly Vendor[]): ExpenseProblem[] {
  const out: ExpenseProblem[] = [];
  if (!vendors.some((v) => v.id === e.vendorId)) out.push({ field: 'vendorId', message: 'Choose the vendor.' });
  if (!e.description.trim()) out.push({ field: 'description', message: 'Say what the cost is for.' });
  if (!Number.isInteger(e.amount) || e.amount <= 0) out.push({ field: 'amount', message: 'Enter an amount above ₦0.' });
  if (!/^\d{4}-\d{2}$/.test(e.month)) out.push({ field: 'month', message: 'Choose the month it belongs to.' });
  if (e.original && (!(e.original.fxRate > 0) || !(e.original.cents > 0))) out.push({ field: 'original', message: 'Enter the dollar amount and the exchange rate used.' });
  return out;
}

/** Expenses at or above this need the owner's approval; below it, finance approval is enough. Placeholder. */
export const EXPENSE_OWNER_THRESHOLD = 50_000_00 as Kobo;

/** The services GoBye uses today, as they actually are. Plans and statuses, no invented bills. */
export function seedVendors(): Vendor[] {
  const v = (id: string, name: string, category: CostCategory, plan: string, status: VendorStatus, note: string, owner: string, currency: 'NGN' | 'USD' = 'USD'): Vendor => ({ id, name, category, plan, status, billing: status === 'not_chosen' || status === 'proposed' ? 'not_connected' : 'manual', currency, note, owner });
  return [
    v('ven-vercel', 'Vercel', 'frontend_hosting', 'Hobby (free)', 'free_plan', 'Hosts the website and the admin. Free plan today.', 'Sani Developer'),
    v('ven-cloudflare', 'Cloudflare', 'edge_network', 'Free (Workers, R2 free tier)', 'free_plan', 'API gateway and media Workers on workers.dev; 8 R2 buckets. Free tier usage only so far.', 'Sani Developer'),
    v('ven-r2', 'Cloudflare R2', 'storage', 'Free tier', 'free_plan', 'Documents, images and media. Charges start above the free tier.', 'Sani Developer'),
    v('ven-supabase', 'Supabase', 'database', 'Free', 'free_plan', 'Demo relay and waitlist only. Not the production database.', 'Sani Developer'),
    v('ven-backend', 'Backend hosting', 'backend_hosting', 'Not chosen', 'not_chosen', 'Production backend not selected yet (Q-064).', 'Owner'),
    v('ven-maps', 'Google Maps Platform', 'maps', 'Proposed', 'proposed', 'Proposed map provider (D-025), not enabled. Cost projection pending (Q-044).', 'Owner'),
    v('ven-sms', 'SMS and OTP provider', 'sms_otp', 'Not chosen', 'not_chosen', 'Needed for sign in and alerts.', 'Sani Developer'),
    v('ven-email', 'Email provider', 'email', 'Not chosen', 'not_chosen', 'Receipts and staff alerts.', 'Sani Developer'),
    v('ven-monitoring', 'Monitoring', 'monitoring', 'Not chosen', 'not_chosen', 'Errors, uptime and alerts (MONITORING_OBSERVABILITY.md).', 'Sani Developer'),
    v('ven-payments', 'Paystack', 'payment_provider', 'Test mode', 'trial', 'Planned provider (Q-042). Test mode charges nothing; live fees depend on the contract.', 'Grace Finance', 'NGN'),
  ];
}
