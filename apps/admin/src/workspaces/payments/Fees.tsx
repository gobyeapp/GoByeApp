import { useMemo, useState } from 'react';
import {
  APPROVAL_RULES,
  DRIVER_ACCESS_PACKAGES,
  FEE_OPERATION_LABEL,
  diffRules,
  exemptionText,
  quoteFee,
  ruleFor,
  scheduleInForce,
  unsetFeeRules,
  validateSchedule,
  type FeeFormula,
  type FeeOperation,
  type FeeRule,
  type FeeSchedule,
  type FeeScheduleStatus,
  type Kobo,
} from '@gobye/core';
import { date, money } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, Drawer, Empty, Field, KV, Notice, PageHead, Pill, Section, Segmented, Select, Stat, Table, type Column, type Tone } from '@/ui/kit';
import { nextApprovalId } from '../developer/logic';
import { formToRule, lagosDateToMs, msToDateInput, nairaToKobo, nextScheduleId, nextScheduleVersion, ruleToForm, type FormErrors, type FormulaForm, type RuleForm } from './model';
import './payments.css';

const STATUS: Record<FeeScheduleStatus, { tone: Tone; text: string }> = {
  draft: { tone: 'neutral', text: 'Draft' },
  pending_approval: { tone: 'warning', text: 'Waiting for approval' },
  scheduled: { tone: 'info', text: 'Scheduled' },
  active: { tone: 'success', text: 'In force' },
  superseded: { tone: 'neutral', text: 'Replaced' },
  rejected: { tone: 'danger', text: 'Rejected' },
};
const OPS: FeeOperation[] = ['wallet_funding', 'withdrawal'];
const CURRENT_PROVIDER = 'paystack';

export function formulaText(f: FeeFormula | null): string {
  if (f === null) return 'Not set';
  const parts = [f.fixed ? money(f.fixed) : '', f.percentBps ? `${f.percentBps / 100}%` : ''].filter(Boolean);
  const base = parts.length ? parts.join(' + ') : '₦0';
  const bounds = [f.min !== undefined ? `at least ${money(f.min)}` : '', f.cap !== undefined ? `at most ${money(f.cap)}` : ''].filter(Boolean);
  return bounds.length ? `${base} (${bounds.join(', ')})` : base;
}
const bearerText = (r: FeeRule) => (r.providerChargeBearer === 'customer' ? (r.operation === 'withdrawal' ? 'Driver' : 'Passenger') : 'GoBye');
const collectionText = (r: FeeRule) => (r.collection === 'add' ? 'Added on top' : 'Taken from the amount');

export default function Fees() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const canEdit = can('fees.edit');
  const schedules = d.feeSchedules;
  const inForce = scheduleInForce(schedules, t);
  const drafts = schedules.filter((s) => s.status === 'draft');
  const waiting = schedules.filter((s) => s.status === 'pending_approval');
  const next = schedules.filter((s) => s.status === 'scheduled' && s.effectiveFrom > t).sort((a, b) => a.effectiveFrom - b.effectiveFrom)[0];
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<FeeSchedule | 'new' | null>(null);
  const opened = schedules.find((s) => s.id === open);

  const columns: Column<FeeSchedule>[] = [
    { key: 'v', label: 'Version', render: (s) => <span className="strong">Version {s.version}</span>, sortValue: (s) => s.version },
    { key: 'status', label: 'Status', render: (s) => <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].text}</Pill>, sortValue: (s) => s.status },
    { key: 'from', label: 'Starts', render: (s) => date(s.effectiveFrom), sortValue: (s) => s.effectiveFrom },
    { key: 'by', label: 'Prepared by', render: (s) => s.createdBy.name },
    { key: 'ok', label: 'Approved by', render: (s) => s.approvedBy?.name ?? <span className="muted">Not approved</span> },
    { key: 'note', label: 'Note', render: (s) => <span className="cell-sub">{s.note}</span> },
  ];

  return (
    <>
      <PageHead
        eyebrow="Payments"
        title="Fee configuration"
        sub="Wallet funding and withdrawal fees: versioned, dated and approved by the owner before they apply. Customers see every fee before they confirm."
        meta={<Pill tone="warning" icon="info">Test data · no fee is charged</Pill>}
        actions={
          <Button variant="primary" icon="add" onClick={() => setEditing('new')} disabledReason={canEdit ? (drafts.length ? 'Finish or send the open draft first' : undefined) : 'Only finance can prepare fee schedules'}>
            New draft
          </Button>
        }
      />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="ticket" label="Schedule in force" value={inForce ? `Version ${inForce.version}` : 'None'} sub={inForce ? `Since ${date(inForce.effectiveFrom)}` : 'No fee can be charged'} tone={inForce ? undefined : 'warning'} />
        <Stat icon="edit" label="Drafts" value={String(drafts.length)} sub="Prepared by finance" />
        <Stat icon="time" label="Waiting for approval" value={String(waiting.length)} sub="Owner decides, never the preparer" tone={waiting.length ? 'warning' : undefined} />
        <Stat icon="calendar" label="Next change" value={next ? date(next.effectiveFrom) : 'None'} sub={next ? `Version ${next.version} is scheduled` : 'Nothing scheduled'} />
      </div>

      {!inForce ? (
        <Notice tone="warning" icon="info">
          No fee schedule approved: wallet funding and withdrawals can’t be charged a fee yet. Fees stay Not set until the payment provider is chosen and its real charges are known (Q-042).
        </Notice>
      ) : null}

      <Section title="Confirmed pricing" desc="These are GoBye prices, not transaction fees. They are not part of a fee schedule and don’t change here.">
        <div className="grid cols-3">
          {DRIVER_ACCESS_PACKAGES.map((p) => (
            <Card key={p.id}>
              <div className="stat">
                <span className="label">{p.name}</span>
                <span className="value">{money(p.price)}</span>
                <span className="sub">{p.durationDays === 1 ? '24 hours from successful activation' : `${p.durationDays} consecutive days`}</span>
              </div>
            </Card>
          ))}
          <Card>
            <div className="stat">
              <span className="label">Trip commission</span>
              <span className="value">0%</span>
              <span className="sub">Drivers keep the full fare</span>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="In force now">
        {inForce ? <RulesTable schedule={inForce} /> : <Card><Empty title="No fee schedule in force" icon="ticket">Customers can’t be charged a GoBye fee or a provider charge until the owner approves a schedule.</Empty></Card>}
      </Section>

      <DisclosurePreview schedules={schedules} now={t} />

      <Section title="Versions">
        <Card flush>
          <Table rows={schedules} columns={columns} rowKey={(s) => s.id} onRowClick={(s) => setOpen(s.id)} empty={<Empty title="No fee schedules yet" icon="ticket" />} />
        </Card>
      </Section>

      {opened ? <ScheduleDrawer schedule={opened} inForce={inForce} onClose={() => setOpen(null)} onEdit={() => (setOpen(null), setEditing(opened))} /> : null}
      {editing ? <Editor base={editing === 'new' ? null : editing} inForce={inForce} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RulesTable({ schedule }: { schedule: FeeSchedule }) {
  const rows = OPS.map((op) => ({ op, rule: ruleFor(schedule, op, CURRENT_PROVIDER) }));
  return (
    <Card flush>
      <Table
        rows={rows}
        rowKey={(r) => r.op}
        columns={[
          { key: 'op', label: 'Operation', render: (r) => <span className="strong">{FEE_OPERATION_LABEL[r.op]}</span> },
          { key: 'g', label: 'GoBye fee', render: (r) => (r.rule ? <FeeValue f={r.rule.gobyeFee} /> : 'No rule') },
          { key: 'p', label: 'Provider charge estimate', render: (r) => (r.rule ? <FeeValue f={r.rule.providerChargeEstimate} /> : 'No rule') },
          { key: 'b', label: 'Provider charge paid by', render: (r) => (r.rule ? bearerText(r.rule) : '') },
          { key: 'c', label: 'Fee taken', render: (r) => (r.rule ? collectionText(r.rule) : '') },
          { key: 'l', label: 'Limits', render: (r) => (r.rule ? `${money(r.rule.limits.min)} to ${money(r.rule.limits.max)}${r.rule.limits.dailyMax !== undefined ? `, ${money(r.rule.limits.dailyMax)} a day` : ''}` : '') },
          { key: 'e', label: 'Exemptions', render: (r) => (r.rule ? exemptionText(r.rule.exemptions) : '') },
        ]}
      />
    </Card>
  );
}

function FeeValue({ f }: { f: FeeFormula | null }) {
  return f === null ? <Pill tone="neutral" icon="lock">Not set</Pill> : <span className="num">{formulaText(f)}</span>;
}

/** Exactly what a passenger or driver would see before confirming, from the schedule in force (or a draft, as a preview). */
function DisclosurePreview({ schedules, now }: { schedules: FeeSchedule[]; now: number }) {
  const [op, setOp] = useState<FeeOperation>('wallet_funding');
  const [amount, setAmount] = useState('5000');
  const [source, setSource] = useState<string>('in_force');
  const candidates = schedules.filter((s) => s.status === 'draft' || s.status === 'pending_approval' || s.status === 'scheduled');
  const k = nairaToKobo(amount);
  const list = useMemo(() => {
    if (source === 'in_force') return schedules;
    const s = schedules.find((x) => x.id === source);
    return s ? [{ ...s, status: 'active' as const, effectiveFrom: now - 1, approvedBy: s.approvedBy ?? { id: 'preview', name: 'Preview' } }] : [];
  }, [schedules, source, now]);
  const q = k === null || Number.isNaN(k) ? null : quoteFee(list, op, k as Kobo, now, { provider: CURRENT_PROVIDER });
  return (
    <Section title="What customers see" desc="The fee lines shown before a passenger funds their wallet or a driver withdraws. Built from the same rules the server will use.">
      <div className="fee-preview">
        <Card>
          <div className="stack">
            <Segmented label="Operation" value={op} onChange={setOp} options={OPS.map((o) => ({ value: o, label: FEE_OPERATION_LABEL[o] }))} />
            <Field label="Amount (₦)" hint="What the customer asks to add or withdraw">
              {(id) => <input id={id} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
            </Field>
            <Select
              label="Schedule"
              value={source}
              onChange={setSource}
              options={[{ value: 'in_force', label: 'Schedule in force' }, ...candidates.map((s) => ({ value: s.id, label: `Preview version ${s.version} (${STATUS[s.status].text.toLowerCase()})` }))]}
            />
          </div>
        </Card>
        <Card title={op === 'wallet_funding' ? 'Add money to wallet' : 'Withdraw earnings'} className="fee-phone">
          {q === null ? (
            <p className="muted">Enter an amount in naira.</p>
          ) : q.ok ? (
            <div className="stack">
              {q.quote.disclosure.map((line) => {
                const [label, value] = line.split(': ');
                return (
                  <div key={line} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="muted">{label}</span>
                    <span className="strong num">{value}</span>
                  </div>
                );
              })}
              <Button variant="primary" disabledReason="Preview only">Confirm</Button>
            </div>
          ) : (
            <div className="stack">
              <Notice tone="warning" icon="lock">{q.message}</Notice>
              <p className="small muted">This is what the customer would be told. Nothing can be charged.</p>
            </div>
          )}
        </Card>
      </div>
    </Section>
  );
}

function ScheduleDrawer({ schedule, inForce, onClose, onEdit }: { schedule: FeeSchedule; inForce?: FeeSchedule; onClose: () => void; onEdit: () => void }) {
  const { can } = useSession();
  const { now } = usePlatform();
  const send = useSendForApproval();
  const editable = schedule.status === 'draft';
  const problems = editable ? validateSchedule(schedule, now()) : [];
  const diffs = OPS.flatMap((op) => {
    const to = ruleFor(schedule, op, '*');
    if (!to) return [];
    return diffRules(inForce && inForce.id !== schedule.id ? ruleFor(inForce, op, '*') : undefined, to).map((x) => ({ ...x, op }));
  });
  const reason = !can('fees.edit') ? 'Only finance can change fee schedules' : problems.length ? 'Fix the problems listed first' : undefined;
  return (
    <Drawer
      title={`Fee schedule version ${schedule.version}`}
      sub={STATUS[schedule.status].text}
      onClose={onClose}
      footer={
        editable ? (
          <>
            <Button icon="edit" onClick={onEdit} disabledReason={can('fees.edit') ? undefined : 'Only finance can change fee schedules'}>
              Edit draft
            </Button>
            <Button variant="primary" icon="checkCircle" disabledReason={reason} onClick={async () => (await send(schedule)).ok && onClose()}>
              Send for approval
            </Button>
          </>
        ) : null
      }
    >
      <KV
        items={[
          ['Status', <Pill key="s" tone={STATUS[schedule.status].tone}>{STATUS[schedule.status].text}</Pill>],
          ['Starts', date(schedule.effectiveFrom)],
          ['Prepared by', schedule.createdBy.name],
          ['Approved by', schedule.approvedBy?.name ?? 'Not approved'],
          ['Note', schedule.note],
        ]}
      />
      <RulesTable schedule={schedule} />
      {problems.length ? (
        <Notice tone="warning" icon="warning">
          <div className="stack tight">
            {problems.map((p) => (
              <span key={p.field + p.message}>{p.message}</span>
            ))}
          </div>
        </Notice>
      ) : null}
      <Card title={inForce && inForce.id !== schedule.id ? `Compared with version ${inForce.version} in force` : 'Compared with no schedule in force'}>
        {diffs.length ? (
          <Table
            rows={diffs}
            rowKey={(r) => r.op + r.field}
            columns={[
              { key: 'op', label: 'Operation', render: (r) => FEE_OPERATION_LABEL[r.op] },
              { key: 'f', label: 'Setting', render: (r) => r.field },
              { key: 'from', label: 'Before', render: (r) => <span className="muted">{r.from}</span> },
              { key: 'to', label: 'After', render: (r) => <span className="strong">{r.to}</span> },
            ]}
          />
        ) : (
          <p className="muted small">No differences.</p>
        )}
      </Card>
    </Drawer>
  );
}

function useSendForApproval() {
  const act = useAction();
  return (s: FeeSchedule) =>
    act(
      {
        label: 'Send fee schedule for approval',
        apply: (draft, ctx) => {
          const x = draft.feeSchedules.find((y) => y.id === s.id);
          if (!x) return { ok: false, error: 'Fee schedule not found' };
          if (x.status !== 'draft') return { ok: false, error: 'Only a draft can be sent for approval' };
          const problems = validateSchedule(x, ctx.now);
          if (problems.length) return { ok: false, error: problems[0]!.message };
          x.status = 'pending_approval';
          draft.approvals.unshift({
            id: nextApprovalId(draft.approvals),
            kind: 'fee_schedule',
            title: `Approve fee schedule version ${x.version} (starts ${date(x.effectiveFrom)})`,
            requestedBy: ctx.actor,
            requestedAt: ctx.now,
            target: { type: 'fee_schedule', id: x.id, label: `Fee schedule version ${x.version}` },
            status: 'pending',
            approverRoles: APPROVAL_RULES.fee_schedule.approverRoles,
            note: x.note,
          });
          return { ok: true };
        },
        audit: (draft) => ({ action: 'fee_schedule.submitted', target: { type: 'fee_schedule', id: s.id, label: `Fee schedule version ${s.version}` }, summary: `Sent fee schedule version ${s.version} for owner approval (${draft.approvals[0]!.id})` }),
      },
      'Sent. It waits for owner approval',
    );
}

function Editor({ base, inForce, onClose }: { base: FeeSchedule | null; inForce?: FeeSchedule; onClose: () => void }) {
  const d = useData();
  const { now } = usePlatform();
  const act = useAction();
  const t = now();
  const startRules = base?.rules ?? inForce?.rules ?? unsetFeeRules();
  const [forms, setForms] = useState<RuleForm[]>(() => OPS.map((op) => ruleToForm(startRules.find((r) => r.operation === op && r.provider === '*') ?? unsetFeeRules().find((r) => r.operation === op)!)));
  const [start, setStart] = useState(msToDateInput(base?.effectiveFrom && base.effectiveFrom > t ? base.effectiveFrom : t + 14 * 86_400_000));
  const [note, setNote] = useState(base?.note ?? '');
  const [touched, setTouched] = useState(false);

  const parsed = forms.map(formToRule);
  const errors: FormErrors = Object.assign({}, ...parsed.map((p) => p.errors));
  const effectiveFrom = lagosDateToMs(start);
  const problems = effectiveFrom === null ? [{ field: 'effectiveFrom', message: 'Choose a start date' }] : validateSchedule({ rules: parsed.map((p) => p.rule), effectiveFrom }, t);
  if (!note.trim()) errors.note = 'Say why this schedule is changing';
  const invalid = Object.keys(errors).length > 0 || problems.length > 0;

  const set = (i: number, patch: Partial<RuleForm>) => setForms((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const save = () => {
    setTouched(true);
    if (invalid) return;
    const rules = parsed.map((p) => p.rule);
    return act(
      {
        label: base ? 'Save fee schedule draft' : 'Create fee schedule draft',
        apply: (draft, ctx) => {
          if (base) {
            const x = draft.feeSchedules.find((y) => y.id === base.id);
            if (!x || x.status !== 'draft') return { ok: false, error: 'Only a draft can be changed' };
            Object.assign(x, { rules, effectiveFrom: effectiveFrom!, note: note.trim() });
          } else {
            if (draft.feeSchedules.some((y) => y.status === 'draft')) return { ok: false, error: 'There is already an open draft' };
            const by = { id: 'id' in ctx.actor ? ctx.actor.id : ctx.actor.name, name: ctx.actor.name };
            draft.feeSchedules.unshift({ id: nextScheduleId(draft.feeSchedules), version: nextScheduleVersion(draft.feeSchedules), status: 'draft', effectiveFrom: effectiveFrom!, rules, note: note.trim(), createdBy: by, createdAt: ctx.now });
          }
          return { ok: true };
        },
        audit: (draft) => {
          const x = base ? draft.feeSchedules.find((y) => y.id === base.id)! : draft.feeSchedules[0]!;
          return {
            action: base ? 'fee_schedule.edited' : 'fee_schedule.created',
            target: { type: 'fee_schedule', id: x.id, label: `Fee schedule version ${x.version}` },
            summary: `${base ? 'Edited' : 'Created'} fee schedule draft version ${x.version}`,
            diff: OPS.flatMap((op) => diffRules(base ? ruleFor(base, op, '*') : undefined, rules.find((r) => r.operation === op)!).map((r) => ({ field: `${FEE_OPERATION_LABEL[op]}: ${r.field}`, from: r.from, to: r.to }))),
            reason: note.trim(),
          };
        },
      },
      'Draft saved',
    ).then((r) => (r.ok ? onClose() : undefined));
  };

  return (
    <Drawer
      title={base ? `Edit draft version ${base.version}` : `New draft version ${nextScheduleVersion(d.feeSchedules)}`}
      sub="Fees start as Not set. Enter only amounts finance has confirmed."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={save} disabledReason={touched && invalid ? 'Fix the highlighted fields' : undefined}>
            Save draft
          </Button>
        </>
      }
    >
      <Notice tone="info" icon="lock">
        Saving keeps this as a draft. It applies only after you send it and the owner approves it, from its start date. Customers always see the fee before they confirm.
      </Notice>
      {forms.map((f, i) => (
        <RuleEditor key={f.operation} form={f} errors={touched ? errors : {}} onChange={(p) => set(i, p)} />
      ))}
      <Card title="When and why">
        <div className="stack">
          <Field label="Starts on (Lagos time)" hint="Must be a future date" error={touched ? problems.find((p) => p.field === 'effectiveFrom')?.message : undefined}>
            {(id) => <input id={id} className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
          </Field>
          <Field label="Reason" hint="Saved with the version and the audit trail" error={touched ? errors.note : undefined}>
            {(id) => <textarea id={id} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </Card>
      {touched && problems.filter((p) => p.field !== 'effectiveFrom').length ? (
        <Notice tone="warning" icon="warning">
          <div className="stack tight">
            {problems
              .filter((p) => p.field !== 'effectiveFrom')
              .map((p) => (
                <span key={p.field + p.message}>{p.message}</span>
              ))}
          </div>
        </Notice>
      ) : null}
    </Drawer>
  );
}

function RuleEditor({ form, errors, onChange }: { form: RuleForm; errors: FormErrors; onChange: (p: Partial<RuleForm>) => void }) {
  const p = form.operation;
  const customer = form.operation === 'withdrawal' ? 'Driver' : 'Passenger';
  return (
    <Card title={FEE_OPERATION_LABEL[form.operation]}>
      <div className="stack">
        <FormulaEditor label="GoBye fee" value={form.gobye} prefix={`${p}.gobye`} errors={errors} onChange={(gobye) => onChange({ gobye })} />
        <FormulaEditor label="Provider charge estimate" hint="The provider’s real charge is recorded from the provider; this estimate is only for disclosure." value={form.estimate} prefix={`${p}.estimate`} errors={errors} onChange={(estimate) => onChange({ estimate })} />
        <div className="fee-grid">
          <Select label="Provider charge paid by" value={form.bearer} onChange={(bearer) => onChange({ bearer })} options={[{ value: 'gobye', label: 'GoBye absorbs it' }, { value: 'customer', label: `${customer} pays it` }]} />
          <Select label="How the fee is taken" value={form.collection} onChange={(collection) => onChange({ collection })} options={[{ value: 'add', label: 'Added on top of the amount' }, { value: 'deduct', label: 'Taken from the amount' }]} />
        </div>
        <div className="fee-grid">
          <NairaField label="Minimum amount (₦)" value={form.min} error={errors[`${p}.min`]} onChange={(min) => onChange({ min })} />
          <NairaField label="Maximum amount (₦)" value={form.max} error={errors[`${p}.max`]} onChange={(max) => onChange({ max })} />
          <NairaField label="Daily limit (₦)" hint="Optional" value={form.dailyMax} error={errors[`${p}.dailyMax`]} onChange={(dailyMax) => onChange({ dailyMax })} />
        </div>
        <div className="fee-grid">
          <Field label="Free operations each month" hint="Optional. No GoBye fee on the first N" error={errors[`${p}.freePerMonth`]}>
            {(id) => <input id={id} className="input" inputMode="numeric" value={form.freePerMonth} onChange={(e) => onChange({ freePerMonth: e.target.value })} />}
          </Field>
          <NairaField label="Free at or below (₦)" hint="Optional" value={form.freeAtOrBelow} error={errors[`${p}.freeAtOrBelow`]} onChange={(freeAtOrBelow) => onChange({ freeAtOrBelow })} />
        </div>
      </div>
    </Card>
  );
}

function NairaField({ label, hint, value, error, onChange }: { label: string; hint?: string; value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => <input id={id} className="input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || undefined} />}
    </Field>
  );
}

function FormulaEditor({ label, hint, value, prefix, errors, onChange }: { label: string; hint?: string; value: FormulaForm; prefix: string; errors: FormErrors; onChange: (v: FormulaForm) => void }) {
  return (
    <div className="stack tight">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <span className="strong">{label}</span>
        <Segmented label={label} value={value.set ? 'set' : 'unset'} onChange={(v) => onChange({ ...value, set: v === 'set' })} options={[{ value: 'unset', label: 'Not set' }, { value: 'set', label: 'Set an amount' }]} />
      </div>
      {hint ? <span className="small muted">{hint}</span> : null}
      {value.set ? (
        <div className="fee-grid four">
          <NairaField label="Fixed (₦)" value={value.fixed} error={errors[`${prefix}.fixed`]} onChange={(fixed) => onChange({ ...value, fixed })} />
          <Field label="Percent (%)" error={errors[`${prefix}.percent`]}>
            {(id) => <input id={id} className="input" inputMode="decimal" value={value.percent} onChange={(e) => onChange({ ...value, percent: e.target.value })} />}
          </Field>
          <NairaField label="At least (₦)" hint="Optional" value={value.min} error={errors[`${prefix}.min`]} onChange={(min) => onChange({ ...value, min })} />
          <NairaField label="At most (₦)" hint="Optional" value={value.cap} error={errors[`${prefix}.cap`]} onChange={(cap) => onChange({ ...value, cap })} />
        </div>
      ) : (
        <span className="small muted">Not set: this operation can’t be quoted or charged while the fee is Not set.</span>
      )}
    </div>
  );
}
