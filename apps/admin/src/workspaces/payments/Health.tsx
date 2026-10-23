import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type AutomationRun, type IntegrationRecord } from '@gobye/core';
import { count, date, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Card, Empty, Notice, PageHead, Pill, Section, Stat, Table, type Tone } from '@/ui/kit';
import { openFailures } from '../developer/logic';
import { StatePill, ago } from '../developer/ui';
import { paymentIntegrations, providerExposure } from './logic';
import { PAYMENT_AUTOMATIONS, lastReconciliation, pendingCollections, unreconciledDays, webhookStats } from './model';
import './payments.css';

const RUN_STATUS: Record<AutomationRun['status'], { tone: Tone; text: string }> = {
  queued: { tone: 'neutral', text: 'Queued' },
  running: { tone: 'info', text: 'Running' },
  succeeded: { tone: 'success', text: 'Succeeded' },
  retry_scheduled: { tone: 'warning', text: 'Retry scheduled' },
  failed: { tone: 'danger', text: 'Failed' },
  needs_lookup: { tone: 'danger', text: 'Needs lookup' },
  cancelled: { tone: 'neutral', text: 'Cancelled' },
};

const minutes = (ms: number | undefined) => (ms === undefined ? 'None' : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} days`);

export default function Health() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const { test, live } = paymentIntegrations(d.integrations);
  const hooks = webhookStats(d.collections, 'paystack');
  const pending = pendingCollections(d.collections, 'paystack', t);
  const exposure = providerExposure(d, 'paystack');
  const recon = lastReconciliation(d.automationRuns);
  const backlog = unreconciledDays(d.automationRuns);
  const liveReady = live?.state === 'live';

  return (
    <>
      <PageHead
        eyebrow="Payments"
        title="Gateway health"
        sub="Is the payment provider connected, are its notifications arriving, and is anything waiting too long? Built from the recorded test data."
        meta={<Pill tone="warning" icon="info">Test data · no live provider</Pill>}
      />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="plugin" label="Live provider" value={liveReady ? 'Connected' : 'None'} sub={liveReady ? 'Live checks passed' : 'No provider takes real money yet'} tone={liveReady ? undefined : 'warning'} />
        <Stat icon="webhook" label="Webhook deliveries" value={count(hooks.total)} sub={`${count(hooks.duplicates)} duplicates dropped`} />
        <Stat icon="time" label="Payments pending" value={count(pending.count)} sub={pending.count ? `Oldest waiting ${minutes(pending.oldestAgeMs)}` : 'Nothing waiting'} tone={pending.oldestAgeMs !== undefined && pending.oldestAgeMs > 30 * 60_000 ? 'warning' : undefined} />
        <Stat icon="balance" label="Days not reconciled" value={count(backlog)} sub={backlog ? 'Blocks switching provider' : 'All recent days matched'} tone={backlog ? 'danger' : undefined} />
      </div>

      {!liveReady ? (
        <Notice tone="warning" icon="plugin">
          No live payment provider is connected. Paystack is configured in test mode only; nothing here reflects real customer payments.
        </Notice>
      ) : null}

      <Section title="Connections">
        <div className="grid cols-2">
          <ConnectionCard title="Test mode" integ={test} now={t} />
          <ConnectionCard title="Live" integ={live} now={t} />
        </div>
      </Section>

      <Section title="Traffic and timing" desc="Response times and uptime need a monitoring service, which isn’t connected yet. No number is shown until it is measured.">
        <div className="grid cols-3">
          <Card title="Webhooks">
            <dl className="health-kv">
              <dt>Received</dt>
              <dd>{count(hooks.total)}</dd>
              <dt>Processed</dt>
              <dd>{count(hooks.processed)}</dd>
              <dt>Duplicates dropped</dt>
              <dd>{count(hooks.duplicates)}</dd>
              <dt>Last received</dt>
              <dd>{ago(hooks.lastAt, t)}</dd>
            </dl>
          </Card>
          <Card title="Money in flight">
            <dl className="health-kv">
              <dt>Payments pending</dt>
              <dd>{count(exposure.pendingCollections)}</dd>
              <dt>Oldest pending</dt>
              <dd>{minutes(pending.oldestAgeMs)}</dd>
              <dt>Payouts processing</dt>
              <dd>{count(exposure.processingWithdrawals)}</dd>
              <dt>Refunds open</dt>
              <dd>{count(exposure.openRefunds)}</dd>
            </dl>
          </Card>
          <Card title="Response time and uptime">
            <Empty title="Needs monitoring (not connected)" icon="radar">
              Shown once monitoring is chosen and measuring real requests.
            </Empty>
          </Card>
        </div>
      </Section>

      <Section title="Reconciliation">
        <Card>
          {recon ? (
            <div className="row wrap" style={{ justifyContent: 'space-between' }}>
              <div className="stack tight">
                <span className="strong">Last run: {recon.subject?.type === 'day' && recon.finishedAt ? `day ending ${date(recon.finishedAt)}` : (recon.subject?.label ?? 'Daily')}</span>
                <span className="small muted">
                  {ago(recon.finishedAt, t)} · {recon.attempts.length} {recon.attempts.length === 1 ? 'attempt' : 'attempts'} · simulated run
                </span>
              </div>
              <Pill tone={RUN_STATUS[recon.status].tone}>{RUN_STATUS[recon.status].text}</Pill>
            </div>
          ) : (
            <Empty title="No reconciliation has run" icon="balance" />
          )}
        </Card>
      </Section>

      <Section title="Payment automations" desc="Server side workflows that move or confirm money. Defined, but no job runner is connected yet.">
        <Card flush>
          <Table
            rows={PAYMENT_AUTOMATIONS.map((a) => ({ a, last: d.automationRuns.filter((r) => r.automationId === a.id && r.status !== 'queued').sort((x, y) => (y.finishedAt ?? y.queuedAt) - (x.finishedAt ?? x.queuedAt))[0] }))}
            rowKey={(r) => r.a.id}
            columns={[
              { key: 'n', label: 'Workflow', render: (r) => <span className="strong">{r.a.name}</span> },
              { key: 'rt', label: 'Runner', render: () => <Pill tone="neutral" icon="lock">Not connected</Pill> },
              { key: 'last', label: 'Last simulated run', render: (r) => (r.last ? <Pill tone={RUN_STATUS[r.last.status].tone}>{RUN_STATUS[r.last.status].text}</Pill> : <span className="muted">None</span>) },
              { key: 'at', label: 'When', render: (r) => (r.last ? when(r.last.finishedAt ?? r.last.queuedAt, t) : '') },
            ]}
          />
        </Card>
        {can('automation.view') ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            Details and failed runs are in the <Link to="/automation/failed">Automation Centre</Link>.
          </p>
        ) : null}
      </Section>
    </>
  );
}

function ConnectionCard({ title, integ, now }: { title: string; integ?: IntegrationRecord; now: number }) {
  if (!integ) {
    return (
      <Card title={title}>
        <Empty title="Not configured" icon="plugin">No provider is set up for this environment.</Empty>
      </Card>
    );
  }
  const failures = openFailures(integ);
  const rows: [string, ReactNode][] = [
    ['Provider', integ.provider],
    ['State', <StatePill key="s" state={integ.state} />],
    ['Last successful test', ago(integ.lastSuccessfulTestAt, now)],
    ['Checks passed', `${integ.checks.filter((c) => c.passed).length} of ${integ.checks.length}`],
    ['Open failures', failures ? <Pill key="f" tone="danger">{failures}</Pill> : 'None'],
    ['Credential', integ.credentialHint ? `Stored on the server, ends ${integ.credentialHint.slice(-4)}` : 'None stored'],
  ];
  return (
    <Card title={title} actions={<StatePill state={integ.state} />}>
      <dl className="health-kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {integ.failures.filter((f) => !f.resolved).slice(0, 3).map((f, i) => (
        <p key={i} className="small" style={{ marginTop: 8, color: 'var(--danger)' }}>
          {f.message} <span className="muted">({ago(f.at, now)})</span>
        </p>
      ))}
    </Card>
  );
}
