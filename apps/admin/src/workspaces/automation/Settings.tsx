import { useState } from 'react';
import { AUTOMATIONS, automationById, paramValue, validateParamChange, type AutomationDefinition, type AutomationSettingChange, type ConfigurableParam } from '@gobye/core';
import { when } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, Drawer, Empty, Field, Notice, PageHead, Pill, Section, Stat, Table, type Column, type Tone } from '@/ui/kit';
import { NotConnected, roleLabel } from './parts';
import { canProposeChange, proposeSettingChange, valueText } from './logic';

const CHANGE_STATUS: Record<AutomationSettingChange['status'], { tone: Tone; text: string }> = {
  pending_approval: { tone: 'warning', text: 'Waiting for approval' },
  approved: { tone: 'success', text: 'Approved' },
  rejected: { tone: 'neutral', text: 'Rejected' },
};

export default function Settings() {
  const d = useData();
  const { now } = usePlatform();
  const { staff, can } = useSession();
  const t = now();
  const [edit, setEdit] = useState<{ def: AutomationDefinition; param: ConfigurableParam } | null>(null);
  const withParams = AUTOMATIONS.filter((a) => a.params.length);
  const allParams = withParams.flatMap((a) => a.params);
  const pending = d.automationChanges.filter((c) => c.status === 'pending_approval');
  const roles = staff?.roles ?? [];
  const canAny = withParams.some((a) => canProposeChange(a, roles, can));

  const history: Column<AutomationSettingChange>[] = [
    { key: 'at', label: 'Requested', sortValue: (c) => c.requestedAt, render: (c) => <span className="num">{when(c.requestedAt, t)}</span> },
    {
      key: 'what',
      label: 'Setting',
      render: (c) => {
        const def = automationById(c.automationId);
        const p = def?.params.find((x) => x.key === c.key);
        return (
          <>
            <div className="cell-title">{p?.label ?? c.key}</div>
            <div className="cell-sub">{def?.name ?? c.automationId}</div>
          </>
        );
      },
    },
    {
      key: 'change',
      label: 'Change',
      render: (c) => {
        const p = automationById(c.automationId)?.params.find((x) => x.key === c.key);
        return `${valueText(p?.kind ?? 'count', c.from)} → ${valueText(p?.kind ?? 'count', c.to)}`;
      },
    },
    { key: 'why', label: 'Reason', render: (c) => <span className="small">{c.reason}</span> },
    { key: 'who', label: 'Requested by', render: (c) => c.requestedBy.name },
    {
      key: 'st',
      label: 'Status',
      sortValue: (c) => c.status,
      render: (c) => (
        <>
          <Pill tone={CHANGE_STATUS[c.status].tone}>{CHANGE_STATUS[c.status].text}</Pill>
          {c.decidedBy ? <div className="cell-sub">{c.decidedBy.name}, {when(c.decidedAt, t)}</div> : null}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHead eyebrow="Automation" title="Automation settings" sub="Timings, reminders and thresholds staff may change. Every change needs a reason and a second person’s approval, and applies to runs that start after approval." />
      <div className="auto-top">
        <NotConnected />
        <div className="grid cols-4">
          <Stat icon="settings" label="Settings" value={allParams.length} sub={`In ${withParams.length} workflows`} />
          <Stat icon="info" tone="warning" label="Placeholders" value={allParams.filter((p) => !p.confirmed).length} sub="Not yet confirmed by the owner" />
          <Stat icon="time" tone={pending.length ? 'warning' : undefined} label="Waiting for approval" value={pending.length} />
          <Stat icon="checkCircle" label="Approved changes" value={d.automationChanges.filter((c) => c.status === 'approved').length} />
        </div>
        {!canAny ? <Notice icon="lock">Read only for your role. Proposing a change needs automation configure access or the workflow’s owner role.</Notice> : null}
      </div>
      {withParams.map((def) => (
        <Section key={def.id} title={def.name} desc={`Owner: ${roleLabel(def.ownerRole)}`}>
          <Card flush>
            {def.params.map((p) => {
              const v = paramValue(def, p.key, d.automationChanges);
              const waiting = pending.find((c) => c.automationId === def.id && c.key === p.key);
              const allowed = canProposeChange(def, roles, can);
              return (
                <div key={p.key} className="auto-param">
                  <div className="stack tight" style={{ minWidth: 0 }}>
                    <span className="strong">{p.label}</span>
                    <span className="small muted">
                      Allowed {p.min ?? 0} to {p.max ?? 'any'}
                      {p.hint ? ` · ${p.hint}` : ''}
                    </span>
                    <span className="row wrap" style={{ gap: 6 }}>
                      {p.confirmed ? <Pill tone="success">Confirmed</Pill> : <Pill tone="warning">Placeholder</Pill>}
                      {waiting ? <Pill tone="warning" icon="time">Change to {valueText(p.kind, waiting.to)} waiting</Pill> : null}
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <span className="auto-value">{v === undefined ? 'Not set' : valueText(p.kind, v)}</span>
                    <Button size="sm" icon="edit" disabledReason={!allowed ? 'Your role can’t change this workflow' : waiting ? 'A change is already waiting for approval' : undefined} onClick={() => setEdit({ def, param: p })}>
                      Propose change
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        </Section>
      ))}
      <Section title="Change history">
        <Card flush>
          <Table rows={[...d.automationChanges].sort((a, b) => b.requestedAt - a.requestedAt)} columns={history} rowKey={(c) => c.id} pageSize={25} empty={<Empty title="No changes yet" icon="history" />} />
        </Card>
      </Section>
      {edit ? <ProposeDrawer def={edit.def} param={edit.param} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function ProposeDrawer({ def, param, onClose }: { def: AutomationDefinition; param: ConfigurableParam; onClose: () => void }) {
  const d = useData();
  const { staff, can } = useSession();
  const act = useAction();
  const current = paramValue(def, param.key, d.automationChanges);
  const [value, setValue] = useState(String(current ?? ''));
  const [reason, setReason] = useState('');
  const parsed: number | boolean = param.kind === 'boolean' ? value === 'true' : Number(value);
  const err = value.trim() === '' ? 'Enter a value' : validateParamChange(def, param.key, parsed) ?? (parsed === current ? 'That is already the value in force' : null);
  const block = err ?? (!reason.trim() ? 'Add a reason first' : undefined);
  return (
    <Drawer
      title="Propose a change"
      sub={`${def.name}: ${param.label}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="checkCircle"
            disabledReason={block ?? undefined}
            onClick={async () => {
              const r = await act(
                {
                  label: 'Propose automation setting change',
                  apply: (draft, ctx) => {
                    const res = proposeSettingChange(draft, { automationId: def.id, key: param.key, to: parsed, reason }, { ...ctx, roles: staff?.roles ?? [], can, current });
                    return res.ok ? { ok: true } : res;
                  },
                  audit: () => ({ action: 'automation.setting_proposed', target: { type: 'automation', id: def.id, label: def.name }, summary: `Proposed ${param.label}: ${valueText(param.kind, current ?? param.value)} → ${valueText(param.kind, parsed)}`, diff: [{ field: param.label, from: valueText(param.kind, current ?? param.value), to: valueText(param.kind, parsed) }], reason }),
                },
                'Sent for approval',
              );
              if (r.ok) onClose();
            }}
          >
            Send for approval
          </Button>
        </>
      }
    >
      <Notice icon="info">Approved by the owner or a platform administrator, never by you. Runs already in progress keep the old value.</Notice>
      <Field label={`New value (${param.kind})`} hint={`Now ${current === undefined ? 'not set' : valueText(param.kind, current)}. Allowed ${param.min ?? 0} to ${param.max ?? 'any'}.`} error={value.trim() ? err ?? undefined : undefined}>
        {(id) => <input id={id} className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!(value.trim() && err)} />}
      </Field>
      <Field label="Reason" hint="Saved to the audit trail and shown to the approver.">
        {(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Drawer>
  );
}
