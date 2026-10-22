import { useState, useSyncExternalStore } from 'react';
import {
  ALWAYS_ALLOWED,
  POLICY_LABEL,
  ROUTE_CLASSES,
  ROUTE_CLASS_LABEL,
  isRouteAllowed,
  type BackendOrigin,
  type PolicyKind,
  type RouteClass,
  type TrafficChange,
  type TrafficEnvironment,
} from '@gobye/core';
import { useSession } from '@/data/session';
import { useToast } from '@/data/store';
import { Button, Card, ConfirmDialog, Empty, Field, KV, Notice, PageHead, Pill, Segmented, Select, Table, type Column, type Tone } from '@/ui/kit';
import { canManageInfra, canViewInfra, createInfraStore, expectedShare, toTrafficActor } from './logic';

/** One simulated store for the whole tab (survives switching staff, like the test data). */
const store = createInfraStore(() => Date.now());

const HEALTH_TONE: Record<BackendOrigin['health'], Tone> = { healthy: 'success', degraded: 'warning', unhealthy: 'danger', unknown: 'neutral' };
const ago = (t: number | null) => (t ? new Date(t).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '—');

type ChangeKind = 'policy' | 'weights' | 'drain';

export default function Traffic() {
  const { staff } = useSession();
  const toast = useToast();
  useSyncExternalStore(store.subscribe, store.version);
  const [env, setEnv] = useState<TrafficEnvironment>('staging');
  const [mfaAt, setMfaAt] = useState<number | null>(null);
  const [kind, setKind] = useState<ChangeKind>('policy');
  const [policy, setPolicy] = useState<PolicyKind>('primary_only');
  const [disabled, setDisabled] = useState<RouteClass[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [drain, setDrain] = useState<string>('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [rollback, setRollback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canViewInfra(staff)) return <Empty title="You don’t have access to infrastructure controls" />;
  const manage = canManageInfra(staff);
  const plane = store.plane(env);
  const state = plane.current();
  const { audit } = plane.history();
  const pending = store.requests(env).filter((r) => r.status === 'pending_approval');
  const actor = staff ? toTrafficActor(staff, mfaAt) : null;
  const mfaFresh = !!mfaAt && Date.now() - mfaAt < 10 * 60_000;

  const change = (): TrafficChange | null => {
    if (kind === 'policy') return { type: 'set_policy', kind: policy, disabled: policy === 'emergency' ? disabled : undefined };
    if (kind === 'weights') return { type: 'set_weights', weights: Object.fromEntries(state.origins.map((o) => [o.id, weights[o.id] ?? o.weight])) };
    const o = state.origins.find((x) => x.id === drain);
    return o ? { type: 'set_maintenance', originId: o.id, maintenance: !o.maintenance } : null;
  };

  const submit = () => {
    const c = change();
    if (!actor || !c) return;
    const r = store.propose(env, actor, c, reason);
    setConfirm(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setReason('');
    toast(r.value.applied ? 'Applied in the simulation (no real traffic changed)' : 'Sent for a second person to approve');
  };

  const originCols: Column<BackendOrigin>[] = [
    { key: 'id', label: 'Origin', render: (o) => <div><strong>{o.id}</strong><div className="muted small">{o.provider} · {o.region}</div></div> },
    { key: 'health', label: 'Health', render: (o) => <Pill tone={HEALTH_TONE[o.health]}>{o.health}</Pill> },
    { key: 'weight', label: 'Weight', render: (o) => `${o.weight}%`, align: 'right' },
    { key: 'priority', label: 'Priority', render: (o) => o.priority, align: 'right' },
    { key: 'state', label: 'State', render: (o) => (o.maintenance ? <Pill tone="warning">Drained</Pill> : <Pill tone="neutral" icon={null}>In rotation</Pill>) },
    { key: 'version', label: 'Version', render: (o) => o.version },
    { key: 'last', label: 'Last healthy', render: (o) => ago(o.lastHealthyAt) },
  ];

  const share = (rc: RouteClass) => {
    const s = expectedShare(state, rc);
    return 'blocked' in s ? <span className="muted">{s.blocked}</span> : s.map((x) => `${x.id} ${x.share}%`).join(' · ');
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead title="Traffic and origins" sub="Where new API requests go, and the controls to switch them. Infrastructure staff only." />
      <Notice tone="warning" icon="alert">
        <strong>Simulation — no production traffic is changed.</strong> There is no backend origin and no connection to a live control plane yet
        (backend provider pending). Changes here run in this browser tab only, to rehearse the approval and rollback flow.
      </Notice>

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented label="Environment" value={env} onChange={(v) => setEnv(v)} options={[{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }]} />
        {state.origins.length === 0 ? (
          <Button icon="add" onClick={() => store.loadExamples(env)}>Load example origins (simulation)</Button>
        ) : (
          <Button variant="ghost" icon="close" onClick={() => store.clear(env)}>Clear simulation</Button>
        )}
      </div>

      <Card title="Origins">
        <Table
          rows={state.origins}
          columns={originCols}
          rowKey={(o) => o.id}
          empty={
            <Empty title="No backend origins yet" icon="server">
              The backend provider hasn’t been chosen, so the API gateway answers every request with “service not available yet”. When origins exist they
              appear here with their health from <code>/health/ready</code>.
            </Empty>
          }
        />
      </Card>

      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card title="Current policy">
          <KV
            items={[
              ['Policy', <strong key="p">{POLICY_LABEL[state.policy.kind]}</strong>],
              ['Version', `v${state.version}`],
              ['Last changed by', state.policy.updatedBy],
              ['New bookings go to', share('rides_create')],
              ['Trips in progress go to', share('rides_active')],
            ]}
          />
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {ROUTE_CLASSES.map((rc) => (
              <Pill key={rc} tone={isRouteAllowed(state.policy, rc) ? 'success' : 'danger'} icon={isRouteAllowed(state.policy, rc) ? 'checkCircle' : 'close'}>
                {ROUTE_CLASS_LABEL[rc]}
              </Pill>
            ))}
          </div>
        </Card>

        <Card title="Change routing">
          {!manage ? (
            <Notice>You can view routing. Changing it needs an owner, admin or developer role (and two-step verification).</Notice>
          ) : state.origins.length === 0 ? (
            <Notice>Load example origins to rehearse a change. With no origins, there is nothing to route.</Notice>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <Segmented label="Change" value={kind} onChange={setKind} options={[{ value: 'policy', label: 'Policy' }, { value: 'weights', label: 'Weights' }, { value: 'drain', label: 'Drain origin' }]} />
              {kind === 'policy' ? (
                <>
                  <Select label="Policy" value={policy} onChange={setPolicy} options={(Object.keys(POLICY_LABEL) as PolicyKind[]).map((k) => ({ value: k, label: POLICY_LABEL[k] }))} />
                  {policy === 'emergency' ? (
                    <fieldset className="stack" style={{ gap: 4, border: 0, padding: 0 }}>
                      <legend className="small muted">Switch off (trips in progress, safety and support always stay on)</legend>
                      {ROUTE_CLASSES.filter((c) => !ALWAYS_ALLOWED.includes(c)).map((c) => (
                        <label key={c} className="row" style={{ gap: 8 }}>
                          <input type="checkbox" checked={disabled.includes(c)} onChange={(e) => setDisabled((d) => (e.target.checked ? [...d, c] : d.filter((x) => x !== c)))} />
                          {ROUTE_CLASS_LABEL[c]}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </>
              ) : kind === 'weights' ? (
                state.origins.map((o) => (
                  <Field key={o.id} label={`${o.id} weight (%)`}>
                    {(id) => <input id={id} className="input" type="number" min={0} max={100} value={weights[o.id] ?? o.weight} onChange={(e) => setWeights((w) => ({ ...w, [o.id]: Number(e.target.value) }))} />}
                  </Field>
                ))
              ) : (
                <Select label="Origin" value={drain} onChange={setDrain} options={[{ value: '', label: 'Choose an origin' }, ...state.origins.map((o) => ({ value: o.id, label: `${o.id} — ${o.maintenance ? 'put back in rotation' : 'drain (no new traffic)'}` }))]} />
              )}
              <Field label="Reason" hint="Required. Saved to the audit trail.">
                {(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />}
              </Field>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {mfaFresh ? (
                  <Pill tone="success">Two-step verification confirmed (simulated)</Pill>
                ) : (
                  <Button icon="key" onClick={() => setMfaAt(Date.now())}>Confirm it’s you (simulated two-step)</Button>
                )}
                <Button variant="primary" disabledReason={!mfaFresh ? 'Confirm it’s you first' : reason.trim().length < 10 ? 'Add a reason (10+ characters)' : undefined} onClick={() => setConfirm(true)}>
                  {env === 'production' ? 'Request change' : 'Apply change'}
                </Button>
              </div>
              {env === 'production' ? <p className="small muted">Production changes need a second person (signed in separately, with their own two-step check) to approve.</p> : null}
              {error ? <Notice tone="danger">{error}</Notice> : null}
            </div>
          )}
        </Card>
      </div>

      {pending.length ? (
        <Card title="Waiting for a second approver">
          {pending.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '8px 0', flexWrap: 'wrap' }}>
              <div>
                <strong>{r.change.type === 'set_policy' ? `Policy → ${POLICY_LABEL[r.change.kind]}` : r.change.type === 'set_weights' ? 'New weights' : `Drain ${r.change.originId}`}</strong>
                <div className="muted small">Proposed by {r.proposedBy} · “{r.reason}”</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Button variant="ghost" onClick={() => store.reject(env, r.id)}>Reject</Button>
                <Button
                  variant="primary"
                  disabledReason={!manage ? 'Needs an infrastructure role' : !mfaFresh ? 'Confirm it’s you first' : undefined}
                  onClick={() => {
                    if (!actor) return;
                    const res = store.approveAndApply(env, r.id, actor);
                    if (!res.ok) return setError(res.error);
                    setError(null);
                    toast('Approved and applied in the simulation (no real traffic changed)');
                  }}
                >
                  Approve and apply
                </Button>
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      <Card title="History (simulation)">
        {audit.length ? (
          <div className="stack" style={{ gap: 8 }}>
            {[...audit].reverse().map((a) => (
              <div key={a.id} className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong>{a.summary}</strong>
                  <div className="muted small">
                    {a.actor} · {new Date(a.at).toLocaleString('en-NG')} · “{a.reason}” · v{a.before.version} → v{a.after?.version}
                  </div>
                </div>
                <Pill tone="warning" icon="info">Simulated</Pill>
              </div>
            ))}
            {manage ? (
              <div>
                <Button variant="danger-soft" icon="refresh" disabledReason={!mfaFresh ? 'Confirm it’s you first' : undefined} onClick={() => setRollback(true)}>
                  Roll back to previous version
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">No changes yet.</p>
        )}
      </Card>

      {confirm ? (
        <ConfirmDialog
          title={env === 'production' ? 'Request this production change?' : 'Apply this change?'}
          body={<>This is a simulation: no real traffic changes. Reason: “{reason.trim()}”.</>}
          confirmLabel={env === 'production' ? 'Request approval' : 'Apply (simulated)'}
          onConfirm={submit}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
      {rollback ? (
        <ConfirmDialog
          title="Roll back routing?"
          body="Restores the previous version. Simulation only."
          confirmLabel="Roll back (simulated)"
          danger
          requireReason
          onConfirm={(why) => {
            setRollback(false);
            if (!actor) return;
            const r = store.rollback(env, actor, why);
            if (!r.ok) return setError(r.error);
            setError(null);
            toast('Rolled back in the simulation');
          }}
          onCancel={() => setRollback(false)}
        />
      ) : null}
    </div>
  );
}
