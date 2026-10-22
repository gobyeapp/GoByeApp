import { useState, type ReactNode } from 'react';
import type { ApprovalRequest, RecordType } from '@gobye/core';
import { money } from '@/data/format';
import { useAction } from '@/data/store';
import { Button, Field, Notice, Segmented } from '@/ui/kit';
import { requestLedgerAdjustment, validateCorrection } from './logic';

/**
 * Request a ledger correction. It never applies immediately: it creates an ApprovalRequest
 * (kind `ledger_adjustment`) that the owner decides in Approvals. Nobody approves their own request.
 */
export function CorrectionDialog({
  title,
  intro,
  target,
  describe,
  balance,
  initial,
  build,
  onDone,
  onCancel,
}: {
  title: string;
  intro: ReactNode;
  target: { type: RecordType; id: string; label: string };
  /** Approval title from the chosen direction and amount, e.g. "Credit ₦500 to Ada's wallet". */
  describe: (direction: 'credit' | 'debit', amountText: string) => string;
  /** Current balance, to stop a debit going below zero. */
  balance?: number;
  initial?: { direction: 'credit' | 'debit'; amount: number };
  /** Exactly what posts if the owner approves (balanced lines). */
  build: (direction: 'credit' | 'debit', amountKobo: number) => NonNullable<ApprovalRequest['adjustment']>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const act = useAction();
  const [direction, setDirection] = useState<'credit' | 'debit'>(initial?.direction ?? 'credit');
  const [amountText, setAmountText] = useState(initial ? String(initial.amount / 100) : '');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const kobo = Math.round(Number(amountText.replace(/[,₦\s]/g, '')) * 100);
  const error = validateCorrection({ amount: Number.isFinite(kobo) ? kobo : 0, direction, reason, balance });
  const approvalTitle = describe(direction, money(Number.isFinite(kobo) && kobo > 0 ? kobo : 0));

  const submit = async () => {
    setTouched(true);
    if (error) return;
    const r = await act(
      {
        label: 'Request correction',
        apply: (draft, ctx) => requestLedgerAdjustment(draft, { now: ctx.now, actor: ctx.actor, title: approvalTitle, target, amount: kobo, reason, adjustment: build(direction, kobo) }),
        audit: () => ({ action: 'ledger.adjustment_requested', target, summary: `Requested: ${approvalTitle}`, reason: reason.trim() }),
      },
      'Correction sent for owner approval. Nothing changes until it is approved.',
    );
    if (r.ok) onDone();
  };

  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="muted">{intro}</div>
        <Segmented<'credit' | 'debit'>
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'credit', label: '+ Credit' },
            { value: 'debit', label: '− Debit' },
          ]}
        />
        <Field label="Amount in naira" hint={balance !== undefined ? `Current balance ${money(balance)}` : undefined} error={touched && error?.includes('amount') ? error : touched && error?.includes('below zero') ? error : undefined}>
          {(id) => <input id={id} className="input" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0" autoFocus />}
        </Field>
        <Field label="Reason" hint="Saved with the request and the audit trail." error={touched && error === 'Add a reason' ? error : undefined}>
          {(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Notice tone="info" icon="lock">Owner approval needed. The balance changes only when an approved adjustment journal is posted.</Notice>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" icon="checkCircle" onClick={submit}>Request approval</Button>
        </div>
      </div>
    </>
  );
}
