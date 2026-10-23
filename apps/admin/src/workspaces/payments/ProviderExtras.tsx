import { useState } from 'react';
import { APPROVAL_RULES, REQUIRED_CAPABILITIES, switchReadiness } from '@gobye/core';
import { useSession } from '@/data/session';
import { useAction, useData } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, Notice, Pill, Section, Select } from '@/ui/kit';
import { nextApprovalId } from '../developer/logic';
import { PROVIDERS, paymentIntegrations, providerExposure } from './logic';
import { CAPABILITY_LABEL, capabilityCoverage, unreconciledDays } from './model';
import './payments.css';

/** Adapter contract: what every provider adapter must do before it can carry money (D-054). */
export function AdapterContract() {
  const rows = capabilityCoverage();
  return (
    <Section title="Adapter contract" desc="GoBye talks to every payment provider through the same adapter. A provider can be used only when its adapter covers everything below and passes its checks.">
      <div className="grid cols-3">
        <Card title="Required of every provider">
          <ul className="cap-list">
            {REQUIRED_CAPABILITIES.map((c) => (
              <li key={c}>
                <Icon name="checkCircle" size={16} />
                {CAPABILITY_LABEL[c]}
              </li>
            ))}
          </ul>
        </Card>
        {rows.map((p) => (
          <Card key={p.key} title={p.name} actions={p.implemented ? <Pill tone="info" icon="time">Adapter planned</Pill> : <Pill tone="neutral" icon={null}>No adapter</Pill>}>
            <p className="small muted">
              {p.implemented
                ? `${p.planned.length} of ${REQUIRED_CAPABILITIES.length} capabilities planned, 0 built. Only a simulated adapter exists today.`
                : 'No adapter. It needs its own build, tests and checks before it could be chosen.'}
            </p>
          </Card>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <Notice tone="info" icon="lock">
          Provider keys live only in the backend’s secret storage. They are never in the apps, this dashboard or its settings; screens only ever show a masked hint (last 4 characters).
        </Notice>
      </div>
    </Section>
  );
}

/** Switching the provider for NEW payments: blockers and what keeps draining on the old provider. */
export function SwitchProvider() {
  const d = useData();
  const { can } = useSession();
  const act = useAction();
  const current = 'paystack';
  const others = PROVIDERS.filter((p) => p.key !== current);
  const [target, setTarget] = useState(others[0]?.key ?? '');
  const t = PROVIDERS.find((p) => p.key === target);
  const { live } = paymentIntegrations(d.integrations);
  const exposure = providerExposure(d, current);
  const base = {
    target: t ? { key: t.key, name: t.name, state: (t.implemented && live ? live.state : 'prototype') as 'prototype' | 'configured' | 'tested' | 'live' | 'degraded', missingCapabilities: t.implemented ? [] : REQUIRED_CAPABILITIES.map((c) => CAPABILITY_LABEL[c].toLowerCase()) } : null,
    current: { key: current, name: PROVIDERS.find((p) => p.key === current)?.name, pendingCollections: exposure.pendingCollections, processingTransfers: exposure.processingWithdrawals, unreconciledDays: unreconciledDays(d.automationRuns) },
  };
  const pending = d.approvals.some((a) => a.kind === 'gateway_switch' && a.status === 'pending');
  // Everything except the approval itself must be ready before a switch can even be requested.
  const ready = switchReadiness({ ...base, approved: true });
  const shown = switchReadiness({ ...base, approved: false });
  const reason = !can('payments_setup.approve') && !can('integrations.configure') ? 'Only the owner or a developer can request a switch' : pending ? 'A switch request is already waiting' : !ready.canSwitch ? 'Clear the blockers first' : undefined;

  const request = () =>
    act(
      {
        label: 'Request provider switch',
        apply: (draft, ctx) => {
          if (!t) return { ok: false, error: 'Choose a provider' };
          draft.approvals.unshift({ id: nextApprovalId(draft.approvals), kind: 'gateway_switch', title: `Switch new payments to ${t.name}`, requestedBy: ctx.actor, requestedAt: ctx.now, target: { type: 'integration', id: `provider:${t.key}`, label: t.name }, status: 'pending', approverRoles: APPROVAL_RULES.gateway_switch.approverRoles, note: 'Payments already in flight finish on the current provider.' });
          return { ok: true };
        },
        audit: (draft) => ({ action: 'approval.requested', target: { type: 'approval', id: draft.approvals[0]!.id, label: draft.approvals[0]!.title }, summary: `Requested approval: ${draft.approvals[0]!.title}` }),
      },
      'Request created. It waits for owner approval',
    );

  return (
    <Section title="Switch provider for new payments" desc="A switch only changes where new payments go. Payments, payouts and refunds already started finish on the provider they began with, and its notifications keep being accepted.">
      <Card>
        <div className="stack">
          <div className="row wrap">
            <span className="muted">Now: Paystack (test mode)</span>
            <Icon name="arrowRight" size={16} />
            <Select label="Switch to" value={target} onChange={setTarget} options={others.map((p) => ({ value: p.key, label: p.name }))} />
          </div>
          <div className="grid cols-2">
            <div className="stack tight">
              <span className="strong">Blocking the switch</span>
              {shown.blockers.map((b) => (
                <span key={b} className="row small" style={{ alignItems: 'flex-start' }}>
                  <Icon name="lock" size={16} />
                  {b}
                </span>
              ))}
            </div>
            <div className="stack tight">
              <span className="strong">Finishes on Paystack after a switch</span>
              {shown.drain.length ? (
                shown.drain.map((x) => (
                  <span key={x} className="row small">
                    <Icon name="time" size={16} />
                    {x}
                  </span>
                ))
              ) : (
                <span className="small muted">Nothing in flight.</span>
              )}
            </div>
          </div>
          <div>
            <Button icon="exchange" onClick={request} disabledReason={reason}>
              Request switch
            </Button>
          </div>
        </div>
      </Card>
    </Section>
  );
}
