import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { APPROVAL_RULES, canGoLive, type ConnectionState, type IntegrationRecord } from '@gobye/core';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform, useToast } from '@/data/store';
import { Icon } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, KV, Notice, PageHead, Pill, SearchInput, Segmented, Select, Stat, Table, type Column } from '@/ui/kit';
import {
  AREA_META,
  AREA_ORDER,
  STATE_META,
  applyTestResults,
  canApplyTransition,
  cleanText,
  counterpart,
  credentialHintFor,
  externalCheck,
  hasCallbacks,
  hintTail,
  nextApprovalId,
  openFailures,
  pendingLiveRequest,
  providerChosen,
  providerName,
  requiredChecks,
  resolveDependency,
  simulateConnectionTest,
  transitionOptions,
  validateSecret,
  webhookUrl,
  type Check,
  type TransitionOption,
} from './logic';
import { CheckPill, StatePill, ago, sleep } from './ui';

type StateFilter = ConnectionState | 'all';
type EnvFilter = 'all' | 'test' | 'live';

const listText = (xs: string[], none: string) => (xs.length ? (xs.length > 2 ? `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more` : xs.join(', ')) : none);

export default function Integrations() {
  const d = useData();
  const { now } = usePlatform();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<StateFilter>('all');
  const [env, setEnv] = useState<EnvFilter>('all');
  const openId = params.get('open');
  const setOpen = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true });
  const t = now();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...d.integrations]
      .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) || a.environment.localeCompare(b.environment))
      .filter((i) => (state === 'all' || i.state === state) && (env === 'all' || i.environment === env))
      .filter((i) => !q || [i.provider, AREA_META[i.area].label, i.owner, ...i.usedBy].some((s) => s.toLowerCase().includes(q)));
  }, [d.integrations, query, state, env]);

  const failuresOpen = d.integrations.reduce((n, i) => n + openFailures(i), 0);
  const tested = d.integrations.filter((i) => i.state === 'tested').length;
  const notDocumented = d.integrations.filter((i) => !i.dependsOn.length).length;
  const live = d.integrations.filter((i) => i.state === 'live').length;

  const columns: Column<IntegrationRecord>[] = [
    {
      key: 'area',
      label: 'Integration',
      render: (i) => (
        <div className="row" style={{ gap: 8 }}>
          <Icon name={AREA_META[i.area].icon} size={18} />
          <div>
            <div className="cell-title">{AREA_META[i.area].label}</div>
            <div className="cell-sub">{providerName(i)}</div>
          </div>
        </div>
      ),
    },
    { key: 'env', label: 'Environment', render: (i) => (i.environment === 'live' ? 'Live' : 'Test') },
    { key: 'state', label: 'State', render: (i) => <StatePill state={i.state} /> },
    { key: 'owner', label: 'Owner', render: (i) => i.owner },
    { key: 'tested', label: 'Last successful test', render: (i) => <span className={i.lastSuccessfulTestAt ? undefined : 'muted'}>{ago(i.lastSuccessfulTestAt, t)}</span> },
    {
      key: 'fail',
      label: 'Open failures',
      align: 'right',
      render: (i) => {
        const n = openFailures(i);
        return n ? <Pill tone="danger">{n} open</Pill> : <span className="muted num">None</span>;
      },
    },
    { key: 'used', label: 'Used by', render: (i) => <span className="small">{listText(i.usedBy, 'Nothing yet')}</span> },
    { key: 'deps', label: 'Depends on', render: (i) => (i.dependsOn.length ? <span className="small">{listText(i.dependsOn, '')}</span> : <span className="small muted">None documented</span>) },
  ];

  return (
    <>
      <PageHead title="Integrations" sub="Every outside service GoBye depends on, with its owner, state, tests, failures and dependencies." />
      <Notice tone="warning" icon="info">
        Prototype on test data. Nothing here is connected to a real provider, and nothing is live. States show how far each connection has got: Prototype, Configured, Tested, Live or Degraded.
      </Notice>

      <div className="grid cols-4" style={{ marginTop: 16 }}>
        <Stat label="Integrations" value={d.integrations.length} sub={`${AREA_ORDER.length} areas`} />
        <Stat label="Tested" value={tested} sub="Every check passed in test" />
        <Stat label="Open failures" value={failuresOpen} tone={failuresOpen ? 'danger' : undefined} sub={failuresOpen ? 'Open a row to resolve' : 'Nothing to resolve'} />
        <Stat label="Live" value={live} sub={notDocumented ? `${notDocumented} with no documented dependencies` : 'Dependencies documented'} />
      </div>

      <div className="section">
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search provider, area, owner or feature" />
          <Select<StateFilter> label="State" value={state} onChange={setState} options={[{ value: 'all', label: 'All states' }, ...(Object.keys(STATE_META) as ConnectionState[]).map((s) => ({ value: s, label: STATE_META[s].text }))]} />
          <Segmented<EnvFilter> label="Environment" value={env} onChange={setEnv} options={[{ value: 'all', label: 'All' }, { value: 'test', label: 'Test' }, { value: 'live', label: 'Live' }]} />
        </div>
        <Table
          rows={rows}
          columns={columns}
          rowKey={(i) => i.id}
          onRowClick={(i) => setOpen(i.id)}
          empty={
            <Empty title="No integrations match" icon="plugin" action={<Button onClick={() => (setQuery(''), setState('all'), setEnv('all'))}>Clear filters</Button>}>
              Try another search or state.
            </Empty>
          }
        />
      </div>

      {openId ? <IntegrationDrawer key={openId} id={openId} onClose={() => setOpen(null)} onOpen={setOpen} /> : null}
    </>
  );
}

/* ---------------- Detail drawer ---------------- */

function IntegrationDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const d = useData();
  const base = d.integrations.find((i) => i.id === id);
  const [env, setEnv] = useState<'test' | 'live'>(base?.environment ?? 'test');
  if (!base) {
    return (
      <Drawer title="Integration" onClose={onClose}>
        <Empty title="Integration not found" icon="plugin">
          It may have been removed. Close this panel and pick another row.
        </Empty>
      </Drawer>
    );
  }
  const rec = counterpart(d.integrations, base, env);
  return (
    <Drawer title={`${AREA_META[base.area].label}: ${providerName(base)}`} sub={`${rec?.id ?? base.id} · Test data`} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <Segmented<'test' | 'live'>
          label="Configuration"
          value={env}
          onChange={setEnv}
          options={[
            { value: 'test', label: 'Test configuration' },
            { value: 'live', label: 'Live configuration' },
          ]}
        />
        {rec ? (
          <Detail key={rec.id} rec={rec} onOpen={onOpen} />
        ) : (
          <Empty title={`No ${env} configuration`} icon="settings">
            {env === 'live'
              ? 'Live uses its own credentials, callback address and checks, kept apart from test. It is set up during a controlled deployment, then tested here.'
              : 'There is no test configuration for this provider yet.'}
          </Empty>
        )}
      </div>
    </Drawer>
  );
}

function Detail({ rec, onOpen }: { rec: IntegrationRecord; onOpen: (id: string) => void }) {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const canConfigure = can('integrations.configure');
  const isDb = rec.area === 'database';
  const pendingLive = pendingLiveRequest(d.approvals, rec.id);
  const target = { type: 'integration' as const, id: rec.id, label: `${providerName(rec)} (${rec.environment})` };
  const open = openFailures(rec);

  return (
    <>
      <KV
        items={[
          ['State', <StatePill key="s" state={rec.state} />],
          ['Owner', rec.owner],
          ['Environment', rec.environment === 'live' ? 'Live' : /paystack/i.test(rec.provider) ? 'Test (Paystack test mode)' : 'Test'],
          ['Health', open ? `${open} open ${open === 1 ? 'failure' : 'failures'}` : canGoLive(rec.checks) ? 'All checks passed' : rec.checks.length ? 'Some checks not passed' : 'No checks run'],
          ['Last successful test', ago(rec.lastSuccessfulTestAt, t)],
          ['Failure history', rec.failures.length ? `${rec.failures.length} recorded, ${open} open` : 'No failures recorded'],
          ['Dependencies', rec.dependsOn.length ? rec.dependsOn.join(', ') : 'None documented'],
        ]}
      />

      {isDb ? (
        <Notice tone="info" icon="lock">
          Database administration and migrations follow controlled deployment. There is no form here to switch or edit the database; this panel shows health only.
        </Notice>
      ) : null}

      <Transitions rec={rec} pendingLive={pendingLive} target={target} canConfigure={canConfigure} />

      <Checks rec={rec} target={target} canConfigure={canConfigure} />

      <Card title="Capabilities">
        {rec.capabilities.length ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {rec.capabilities.map((c) => (
              <Pill key={c} tone="neutral" icon={null}>
                {c}
              </Pill>
            ))}
          </div>
        ) : (
          <p className="muted small">{providerChosen(rec) ? 'No capabilities recorded yet.' : 'Choose a provider to list what it can do.'}</p>
        )}
      </Card>

      {isDb ? (
        <Card title="Health (read only)">
          <KV
            items={[
              ['Connection', 'Not connected (prototype)'],
              ['Migrations', 'Run by the deployment pipeline only'],
              ['Backups', 'Not configured yet'],
              ['Job health', 'See Background jobs'],
            ]}
          />
        </Card>
      ) : (
        <Credential rec={rec} target={target} />
      )}

      {hasCallbacks(rec.area) ? <Callbacks rec={rec} /> : null}

      <Failures rec={rec} target={target} canConfigure={canConfigure} />

      <Card title="Dependencies">
        <div className="stack">
          <div>
            <div className="small strong">Depends on</div>
            {rec.dependsOn.length ? (
              <ul className="stack tight" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
                {rec.dependsOn.map((name) => {
                  const dep = resolveDependency(d.integrations, name, rec.environment);
                  return (
                    <li key={name} className="row" style={{ justifyContent: 'space-between' }}>
                      {dep ? (
                        <button className="btn ghost sm" onClick={() => onOpen(dep.id)}>
                          {name}
                        </button>
                      ) : (
                        <span>{name}</span>
                      )}
                      {dep ? <StatePill state={dep.state} /> : <span className="muted small">Not in inventory</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted small" style={{ marginTop: 6 }}>
                None documented. Record what this needs before it is marked configured.
              </p>
            )}
          </div>
          <div>
            <div className="small strong">Used by</div>
            <p className="small" style={{ marginTop: 6 }}>
              {rec.usedBy.length ? rec.usedBy.join(', ') : 'Nothing yet'}
            </p>
            {rec.state !== 'live' && rec.usedBy.length ? <p className="muted small">These features show an honest pending or unavailable state until this is live.</p> : null}
          </div>
        </div>
      </Card>
    </>
  );
}

/* ---------------- State transitions ---------------- */

const DOWNGRADE: ConnectionState[] = ['prototype', 'configured', 'degraded'];

function Transitions({ rec, pendingLive, target, canConfigure }: { rec: IntegrationRecord; pendingLive?: ReturnType<typeof pendingLiveRequest>; target: { type: 'integration'; id: string; label: string }; canConfigure: boolean }) {
  const act = useAction();
  const [confirm, setConfirm] = useState<TransitionOption | null>(null);
  const options = transitionOptions(rec, { pendingLive });
  const isDowngrade = (o: TransitionOption) => DOWNGRADE.includes(o.to) && !(rec.state === 'prototype' && o.to === 'configured');

  const change = (o: TransitionOption, reason?: string) =>
    act(
      {
        label: o.label,
        apply: (draft) => {
          const x = draft.integrations.find((i) => i.id === rec.id);
          if (!x) return { ok: false, error: 'Integration not found' };
          const ok = canApplyTransition(x, o.to);
          if (!ok.ok) return ok;
          x.state = o.to;
          return { ok: true };
        },
        audit: () => ({ action: 'integration.state_changed', target, summary: `${o.label}: ${STATE_META[rec.state].text} to ${STATE_META[o.to].text}`, diff: [{ field: 'State', from: STATE_META[rec.state].text, to: STATE_META[o.to].text }], reason }),
      },
      `${target.label} is now ${STATE_META[o.to].text.toLowerCase()}`,
    );

  const requestLive = () =>
    act(
      {
        label: 'Request live',
        apply: (draft, { now, actor }) => {
          const x = draft.integrations.find((i) => i.id === rec.id);
          if (!x) return { ok: false, error: 'Integration not found' };
          if (pendingLiveRequest(draft.approvals, x.id)) return { ok: false, error: 'A live request is already waiting for approval' };
          const opt = transitionOptions(x).find((o) => o.to === 'live');
          if (!opt?.viaApproval || opt.blocked) return { ok: false, error: opt?.blocked ?? 'Live isn’t available from this state' };
          draft.approvals.unshift({ id: nextApprovalId(draft.approvals), kind: 'payments_activation', title: `Switch ${providerName(x)} to live`, requestedBy: actor, requestedAt: now, target, status: 'pending', approverRoles: APPROVAL_RULES.payments_activation.approverRoles });
          return { ok: true };
        },
        audit: (draft) => ({ action: 'approval.requested', target: { type: 'approval', id: draft.approvals[0]!.id, label: `Switch ${providerName(rec)} to live` }, summary: `Requested owner approval to switch ${target.label} to live` }),
      },
      'Live request sent to the owner for approval',
    );

  if (rec.area === 'database') return null;
  return (
    <Card title="Connection state">
      <div className="stack">
        <div className="row wrap" style={{ gap: 6 }}>
          {(['prototype', 'configured', 'tested', 'live'] as ConnectionState[]).map((s, k) => (
            <span key={s} className="row" style={{ gap: 6 }}>
              {k > 0 ? <Icon name="right" size={14} /> : null}
              <span className={s === rec.state ? 'strong' : 'muted small'}>{STATE_META[s].text}</span>
            </span>
          ))}
        </div>
        {options.length ? (
          <div className="row wrap">
            {options.map((o) => (
              <Button
                key={o.to}
                size="sm"
                variant={o.to === 'tested' || o.to === 'live' || (rec.state === 'prototype' && o.to === 'configured') ? 'primary' : 'secondary'}
                disabledReason={!canConfigure ? 'Needs developer access to change integrations' : o.blocked}
                onClick={() => (o.viaApproval ? requestLive() : isDowngrade(o) ? setConfirm(o) : change(o))}
              >
                {o.label}
              </Button>
            ))}
          </div>
        ) : null}
        {options.some((o) => o.blocked) ? (
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {options
              .filter((o) => o.blocked)
              .map((o) => (
                <li key={o.to}>
                  {o.label}: {o.blocked}
                </li>
              ))}
          </ul>
        ) : null}
        {rec.area === 'payments' ? <p className="small muted">Payments go live only after an owner approves on Payments setup, and only once every live check has passed.</p> : null}
        {pendingLive ? (
          <Notice tone="info" icon="time">
            {pendingLive.id}: “{pendingLive.title}” is waiting for the owner.
          </Notice>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          title={`${confirm.label}?`}
          body={`${target.label} moves from ${STATE_META[rec.state].text} to ${STATE_META[confirm.to].text}. Features that use it will show as unavailable or pending.`}
          confirmLabel={confirm.label}
          danger
          requireReason
          onCancel={() => setConfirm(null)}
          onConfirm={async (reason) => {
            const r = await change(confirm, reason);
            if (r.ok) setConfirm(null);
          }}
        />
      ) : null}
    </Card>
  );
}

/* ---------------- Connection test ---------------- */

function Checks({ rec, target, canConfigure }: { rec: IntegrationRecord; target: { type: 'integration'; id: string; label: string }; canConfigure: boolean }) {
  const act = useAction();
  const { now } = usePlatform();
  const [run, setRun] = useState<{ step: number; results: Check[] } | null>(null);
  const checks = requiredChecks(rec);

  const runTest = async () => {
    const results = simulateConnectionTest(rec, now());
    for (let k = 0; k < results.length; k++) {
      setRun({ step: k, results });
      await sleep(450);
    }
    setRun({ step: results.length, results });
    const passed = results.filter((c) => c.passed).length;
    await act(
      {
        label: 'Run connection test',
        latency: 300,
        apply: (draft, ctx) => {
          const x = draft.integrations.find((i) => i.id === rec.id);
          if (!x) return { ok: false, error: 'Integration not found' };
          applyTestResults(x, simulateConnectionTest(x, ctx.now), ctx.now);
          return { ok: true };
        },
        audit: () => ({ action: 'integration.tested', target, summary: `Connection test (simulated): ${passed} of ${results.length} checks passed` }),
      },
      passed === results.length ? 'Connection test passed (simulated)' : `Connection test: ${results.length - passed} of ${results.length} checks not passed`,
    );
    setRun(null);
  };

  const rows = run ? run.results : checks;
  return (
    <Card title="Required checks">
      <div className="stack">
        <ul className="stack tight" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-live="polite">
          {rows.map((c, k) => {
            const running = run ? (k === run.step ? 'checking' : k > run.step ? 'waiting' : undefined) : undefined;
            const shown = run && k < run.step ? run.results[k] : run ? undefined : c;
            const ext = externalCheck(c.name);
            return (
              <li key={c.name} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div className="small strong">{c.name}</div>
                  {shown && !shown.passed && shown.detail ? <div className="cell-sub">{cleanText(shown.detail)}</div> : null}
                  {ext && !running ? <div className="cell-sub">{ext.waitingOn === 'owner' ? 'Completed by the owner, not by a test' : 'Completed by the provider, not by a test'}</div> : null}
                </div>
                <CheckPill check={shown} running={running} />
              </li>
            );
          })}
        </ul>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">Last successful test: {ago(rec.lastSuccessfulTestAt, now())}</span>
          <Button size="sm" icon="refresh" disabledReason={!canConfigure ? 'Needs developer access to run tests' : run ? 'Test running' : undefined} onClick={runTest}>
            Run connection test
          </Button>
        </div>
        <p className="small muted">Simulated. A real test calls the provider from the server; this prototype only shows the steps and records the result.</p>
      </div>
    </Card>
  );
}

/* ---------------- Credential (masked) and rotation ---------------- */

function Credential({ rec, target }: { rec: IntegrationRecord; target: { type: 'integration'; id: string; label: string } }) {
  const { can } = useSession();
  const { now } = usePlatform();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const has = !!rec.credentialHint;
  const reason = !can('integrations.secrets') ? 'Needs secrets access (developer)' : !providerChosen(rec) ? 'Choose a provider first' : undefined;

  const save = async () => {
    const e = validateSecret(value, rec);
    if (e) return setError(e);
    const hint = credentialHintFor(value);
    // Discard the value straight away: only the masked hint and rotation time are kept.
    setValue('');
    setError(null);
    const r = await act(
      {
        label: has ? 'Rotate credential' : 'Add credential',
        apply: (draft, ctx) => {
          const x = draft.integrations.find((i) => i.id === rec.id);
          if (!x) return { ok: false, error: 'Integration not found' };
          x.credentialHint = hint;
          x.credentialRotatedAt = ctx.now;
          // A new secret invalidates earlier technical results; owner and provider steps keep their state.
          x.checks = requiredChecks(x).map((c) => (externalCheck(c.name) ? c : { name: c.name, passed: false, detail: 'Not run since the credential changed' }));
          if (x.state === 'tested') x.state = 'configured';
          return { ok: true };
        },
        audit: () => ({
          action: has ? 'integration.credential_rotated' : 'integration.credential_added',
          target,
          summary: `${has ? 'Rotated' : 'Added'} ${rec.environment} secret key`,
          diff: [{ field: 'Secret key', from: hintTail(rec.credentialHint), to: hintTail(hint) }, ...(rec.state === 'tested' ? [{ field: 'State', from: 'Tested', to: 'Configured' }] : [])],
        }),
      },
      has ? 'Credential rotated. Run the connection test again' : 'Credential added. Run the connection test',
    );
    if (r.ok) setEditing(false);
  };

  return (
    <Card title="Credential">
      <div className="stack">
        <KV
          items={[
            ['Secret key', has ? <code key="c">{rec.credentialHint}</code> : <span key="n" className="muted">No credentials configured</span>],
            ['Last rotated', ago(rec.credentialRotatedAt, now(), 'Not yet')],
          ]}
        />
        {editing ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label={`${rec.environment === 'live' ? 'Live' : 'Test'} secret key`} error={error ?? undefined} hint="Shown once as you type, then discarded. Only the last 4 characters are kept.">
              {(fid) => <input id={fid} className="input" type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => (setValue(e.target.value), setError(null))} autoFocus />}
            </Field>
            <Notice tone="info" icon="lock">
              In the real system this goes to protected server storage; it is never stored in the browser. This prototype keeps only a masked hint and the rotation time, and records the change in the audit trail.
            </Notice>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => (setEditing(false), setValue(''), setError(null))}>
                Cancel
              </Button>
              <Button variant="primary" icon="key" onClick={save}>
                {has ? 'Save new key' : 'Save key'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" icon="key" disabledReason={reason} onClick={() => setEditing(true)}>
              {has ? 'Rotate' : 'Add credential'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------------- Callbacks and webhooks ---------------- */

function Callbacks({ rec }: { rec: IntegrationRecord }) {
  const toast = useToast();
  const url = webhookUrl(rec);
  if (!providerChosen(rec)) {
    return (
      <Card title="Callbacks and webhooks">
        <p className="muted small">Choose a provider first. The callback address is set after that.</p>
      </Card>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Callback address copied');
    } catch {
      toast('Couldn’t copy. Select the address and copy it');
    }
  };
  return (
    <Card title="Callbacks and webhooks">
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between', background: 'var(--muted)', borderRadius: 10, padding: '8px 10px' }}>
          <code className="small" style={{ overflowWrap: 'anywhere' }}>
            {url}
          </code>
          <Button size="sm" variant="ghost" icon="copy" onClick={copy}>
            Copy
          </Button>
        </div>
        <p className="small muted">Example address on a test domain. Add it in the provider dashboard for the {rec.environment} configuration only.</p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <span className="strong">Signature:</span> every event is checked against the provider signature (for Paystack, an HMAC SHA512 of the body) before anything is recorded; unsigned events are rejected.
          </li>
          <li>
            <span className="strong">Duplicates:</span> events are keyed by reference and event type, so a repeat is logged as a duplicate and never applied twice.
          </li>
        </ul>
      </div>
    </Card>
  );
}

/* ---------------- Failure history ---------------- */

function Failures({ rec, target, canConfigure }: { rec: IntegrationRecord; target: { type: 'integration'; id: string; label: string }; canConfigure: boolean }) {
  const act = useAction();
  const { now } = usePlatform();
  const resolve = (at: number, message: string) =>
    act(
      {
        label: 'Resolve failure',
        apply: (draft) => {
          const f = draft.integrations.find((i) => i.id === rec.id)?.failures.find((x) => x.at === at);
          if (!f) return { ok: false, error: 'Failure not found' };
          if (f.resolved) return { ok: false, error: 'Already resolved' };
          f.resolved = true;
          return { ok: true };
        },
        audit: () => ({ action: 'integration.failure_resolved', target, summary: `Resolved failure: ${cleanText(message)}` }),
      },
      'Failure marked resolved',
    );

  return (
    <Card title="Failure history">
      {rec.failures.length ? (
        <ul className="stack tight" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {[...rec.failures]
            .sort((a, b) => b.at - a.at)
            .map((f) => (
              <li key={f.at} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="small">{cleanText(f.message)}</div>
                  <div className="cell-sub">{ago(f.at, now())}</div>
                </div>
                {f.resolved ? (
                  <Pill tone="success" icon="check">
                    Resolved
                  </Pill>
                ) : (
                  <Button size="sm" disabledReason={canConfigure ? undefined : 'Needs developer access'} onClick={() => resolve(f.at, f.message)}>
                    Resolve
                  </Button>
                )}
              </li>
            ))}
        </ul>
      ) : (
        <p className="muted small">No failures recorded. Failed connection tests and provider errors appear here.</p>
      )}
    </Card>
  );
}
