import { useCallback, useState, type ReactNode } from 'react';
import type { CityId, CollectionStatus, LedgerEntry, RefundStatus, WithdrawalStatus } from '@gobye/core';
import { label, money, signedMoney, when } from '@/data/format';
import { RANGE_MS, useFilters, useSession } from '@/data/session';
import { usePlatform } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, ConfirmDialog, PageHead, Pill, type Tone } from '@/ui/kit';
import { ACCOUNT_LABEL, KIND_LABEL, type ActionOption, type Include } from './logic';

/* Small building blocks shared by the finance screens (local to this workspace). */

/** Page heading with the test data marker every finance screen carries. */
export function FinanceHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <PageHead
      title={title}
      sub={sub}
      actions={
        <>
          <Pill tone="warning" icon="info">Test data · Paystack (test)</Pill>
          {actions}
        </>
      }
    />
  );
}

/**
 * Signed amount: credit "+" in green, debit "−" in red, plus a text cue (Credit/Debit) so colour is
 * never the only signal. `plain` shows an unsigned amount (totals, balances).
 */
export function Amount({ value, plain, cue, strong }: { value: number; plain?: boolean; cue?: boolean; strong?: boolean }) {
  if (plain) return <span className={`num${strong ? ' strong' : ''}`}>{money(value)}</span>;
  const credit = value > 0;
  const zero = value === 0;
  const word = zero ? 'No change' : credit ? 'Credit' : 'Debit';
  return (
    <span className="num" style={{ color: zero ? undefined : credit ? 'var(--success)' : 'var(--danger)', fontWeight: strong ? 600 : 500, whiteSpace: 'nowrap' }}>
      <span className="sr">{word} </span>
      {signedMoney(value)}
      {cue && !zero ? <span className="small" style={{ marginLeft: 6, fontWeight: 600, opacity: 0.85 }} aria-hidden>{credit ? 'Cr' : 'Dr'}</span> : null}
    </span>
  );
}

export const COLLECTION_TONE: Record<CollectionStatus, Tone> = { initiated: 'info', pending: 'warning', successful: 'success', failed: 'danger', abandoned: 'neutral', reversed: 'neutral' };
export const WITHDRAWAL_TONE: Record<WithdrawalStatus, Tone> = { requested: 'warning', under_review: 'warning', processing: 'info', successful: 'success', failed: 'danger', reversed: 'neutral', rejected: 'neutral' };
export const REFUND_TONE: Record<RefundStatus, Tone> = { requested: 'warning', approved: 'info', rejected: 'neutral', processing: 'info', completed: 'success', failed: 'danger' };

export function StatusPill({ tone, status }: { tone: Tone; status: string }) {
  const icon = tone === 'info' ? 'time' : tone === 'neutral' && (status === 'rejected' || status === 'reversed' || status === 'abandoned') ? 'close' : undefined;
  return <Pill tone={tone} icon={icon}>{label(status)}</Pill>;
}

/** Simulated provider marker for buttons and events. */
export function SimTag() {
  return (
    <span className="pill neutral" style={{ height: 20, fontSize: 11 }}>
      <Icon name="code" size={12} />
      Simulated
    </span>
  );
}

/**
 * Global city + date filter for finance rows. Rows without a city (company accounts) only show when
 * no single city is chosen. Staff city scope always applies.
 */
export function useInclude(): Include {
  const { city, range } = useFilters();
  const { inScope } = useSession();
  const { now } = usePlatform();
  return useCallback(
    (rowCity: CityId | undefined, at: number | undefined) => {
      if (rowCity ? !inScope(rowCity) || (city !== 'all' && rowCity !== city) : city !== 'all') return false;
      return at === undefined || now() - at <= RANGE_MS[range];
    },
    [city, range, inScope, now],
  );
}

/** Buttons for workflow actions, each behind a confirmation (with a mandatory reason where needed). */
export function ActionButtons<A extends string>({
  options,
  run,
  describe,
}: {
  options: ActionOption<A>[];
  run: (action: A, reason: string) => Promise<{ ok: boolean }>;
  describe: (action: A) => { title: string; body: ReactNode };
}) {
  const [pending, setPending] = useState<ActionOption<A> | null>(null);
  if (!options.length) return null;
  const desc = pending ? describe(pending.action) : null;
  return (
    <>
      {options.map((o) => (
        <Button
          key={o.action}
          variant={o.simulated ? 'secondary' : o.danger ? 'danger-soft' : 'primary'}
          icon={o.simulated ? 'code' : o.danger ? 'close' : 'check'}
          disabledReason={o.disabledReason}
          onClick={() => setPending(o)}
        >
          {o.label}
        </Button>
      ))}
      {pending && desc ? (
        <ConfirmDialog
          title={desc.title}
          body={desc.body}
          confirmLabel={pending.label}
          danger={pending.danger}
          requireReason={pending.needsReason}
          onCancel={() => setPending(null)}
          onConfirm={async (reason) => {
            const r = await run(pending.action, reason);
            if (r.ok) setPending(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Ledger lines for drawers: when, what, account and signed amount with a text cue. */
export function LedgerLines({ entries, now, showAccount = true, empty = 'No ledger entries' }: { entries: LedgerEntry[]; now: number; showAccount?: boolean; empty?: string }) {
  if (!entries.length) return <div className="muted small">{empty}</div>;
  return (
    <div className="table-wrap card flush">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Entry</th>
            <th className="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{when(e.at, now)}</td>
              <td>
                <div className="cell-title" style={{ fontWeight: 500 }}>{e.description}</div>
                <div className="cell-sub">
                  {KIND_LABEL[e.kind]}
                  {showAccount ? ` · ${ACCOUNT_LABEL[e.account.kind]}` : ''}
                  {e.reference ? ` · ${e.reference}` : ''}
                  {e.reason ? ` · Reason: ${e.reason}` : ''}
                </div>
              </td>
              <td className="right"><Amount value={e.amount} cue /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small heading used inside drawers. */
export function SubHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="row" style={{ marginBottom: 10 }}>
      <h3 className="strong" style={{ fontSize: 14 }}>{children}</h3>
      {aside ? <span style={{ marginLeft: 'auto' }}>{aside}</span> : null}
    </div>
  );
}
