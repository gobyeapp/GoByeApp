import { useMemo, useState } from 'react';
import {
  DATA_PLATFORM,
  DATA_PLATFORM_AS_OF,
  MIGRATION_PHASES,
  PORTABILITY_CHECKS,
  PROVIDER_OPTIONS,
  migrationPlan,
  portabilitySummary,
  type DataArea,
  type PortabilityCheck,
  type ProviderOption,
} from '@gobye/core';
import { Card, KV, Notice, PageHead, Pill, Section, Segmented, Stat, Table, type Column } from '@/ui/kit';

/**
 * Data platform (D-065): Supabase stays for the database and sign-in; this page keeps a later move to
 * another provider ready. Reference content reviewed on DATA_PLATFORM_AS_OF, not live monitoring.
 */

type AreaFilter = DataArea | 'all';
type Move = DataArea | 'both';

const AREA_LABEL: Record<DataArea, string> = { database: 'Database', auth: 'Sign in' };
const MOVE_LABEL: Record<Move, string> = { database: 'Database only', auth: 'Sign in only', both: 'Database and sign in' };
const dateText = new Date(`${DATA_PLATFORM_AS_OF}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

export default function DataPlatform() {
  const [area, setArea] = useState<AreaFilter>('all');
  const [move, setMove] = useState<Move>('database');
  const summary = portabilitySummary();
  const checks = useMemo(() => PORTABILITY_CHECKS.filter((c) => area === 'all' || c.area === area), [area]);
  const plan = useMemo(() => migrationPlan(move), [move]);

  const checkColumns: Column<PortabilityCheck>[] = [
    {
      key: 'label',
      label: 'Check',
      sortValue: (c) => c.label,
      render: (c) => (
        <div>
          <div className="cell-title">{c.label}</div>
          <div className="cell-sub">{c.detail}</div>
        </div>
      ),
    },
    { key: 'area', label: 'Area', sortValue: (c) => c.area, render: (c) => AREA_LABEL[c.area] },
    { key: 'status', label: 'Status', sortValue: (c) => c.status, render: (c) => (c.status === 'ready' ? <Pill tone="success">Ready</Pill> : <Pill tone="warning">Needs work before a move</Pill>) },
    { key: 'evidence', label: 'Shown by', render: (c) => <code className="small">{c.evidence}</code> },
  ];

  const optionColumns: Column<ProviderOption>[] = [
    { key: 'name', label: 'Provider', sortValue: (o) => o.name, render: (o) => <div className="cell-title">{o.name}</div> },
    { key: 'covers', label: 'Covers', render: (o) => o.covers.map((a) => AREA_LABEL[a]).join(' and ') },
    { key: 'free', label: 'Free tier', render: (o) => o.freeTier },
    { key: 'paid', label: 'Cheapest paid', render: (o) => o.cheapestPaid },
    {
      key: 'notes',
      label: 'Notes',
      render: (o) => (
        <span>
          {o.notes}{' '}
          <a href={o.source} target="_blank" rel="noreferrer">
            Source
          </a>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead
        eyebrow="Infrastructure"
        title="Data platform"
        sub="The database and sign in services the backend uses, and how ready we are to move them to another provider."
      />
      <Notice tone="info">
        Decision D-065: we keep Supabase for the database and sign in. This page is reference information reviewed on {dateText}. It is not live monitoring,
        and nothing here changes a setting. Prices are list prices to check again before any purchase.
      </Notice>

      <Section title="In use">
        <div className="grid cols-2">
          {DATA_PLATFORM.map((c) => (
            <Card key={c.area} title={c.label}>
              <KV
                items={[
                  ['Provider', c.provider],
                  ...c.environments.map((e): [string, string] => [e.name === 'staging' ? 'Staging' : 'Production', e.state]),
                  ['Set by', c.configuredBy.join(', ')],
                ]}
              />
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Ready to move?" desc="Each check names the file that shows it. Items marked “Needs work” must be solved before that part can move.">
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          <Stat label="Database checks ready" value={`${summary.database.ready} of ${summary.database.ready + summary.database.attention}`} tone={summary.database.attention ? 'warning' : 'success'} />
          <Stat label="Sign in checks ready" value={`${summary.auth.ready} of ${summary.auth.ready + summary.auth.attention}`} tone={summary.auth.attention ? 'warning' : 'success'} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <Segmented<AreaFilter>
            label="Show checks for"
            value={area}
            onChange={setArea}
            options={[
              { value: 'all', label: 'All' },
              { value: 'database', label: 'Database' },
              { value: 'auth', label: 'Sign in' },
            ]}
          />
        </div>
        <Table rows={checks} columns={checkColumns} rowKey={(c) => c.id} caption="Portability checks" />
      </Section>

      <Section title="If we move" desc="The order of work for a move. Steps marked Owner need the owner’s account, a decision or a payment.">
        <div style={{ marginBottom: 12 }}>
          <Segmented<Move>
            label="Plan for"
            value={move}
            onChange={setMove}
            options={(['database', 'auth', 'both'] as Move[]).map((m) => ({ value: m, label: MOVE_LABEL[m] }))}
          />
        </div>
        <div className="stack">
          {MIGRATION_PHASES.map((phase) => {
            const steps = plan.filter((s) => s.phase === phase);
            if (!steps.length) return null;
            return (
              <Card key={phase} title={phase.charAt(0).toUpperCase() + phase.slice(1)}>
                <ol className="stack tight" style={{ margin: 0, paddingLeft: 20 }}>
                  {steps.map((s) => (
                    <li key={s.id}>
                      <div className="row wrap">
                        <strong>{s.title}</strong>
                        {s.owner ? <Pill tone="info" icon={null}>Owner</Pill> : null}
                      </div>
                      <div className="muted small">{s.detail}</div>
                    </li>
                  ))}
                </ol>
              </Card>
            );
          })}
        </div>
      </Section>

      <Section title="Options if we move" desc="Only Supabase covers both the database and sign in. Any other database needs a separate sign in provider.">
        <Table rows={PROVIDER_OPTIONS} columns={optionColumns} rowKey={(o) => o.id} caption="Provider options" />
      </Section>
    </>
  );
}
