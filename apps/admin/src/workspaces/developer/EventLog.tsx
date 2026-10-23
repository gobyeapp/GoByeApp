import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RecordLink } from '@/data/records';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { when } from '@/data/format';
import { Button, Card, Empty, FilterBar, PageHead, SearchInput, Section, Segmented, Select, Stat, Table, type Column } from '@/ui/kit';
import { RETRY_ACTION, SOURCE_LABEL, buildEventStream, filterEvents, outcomeCounts, type EventOutcome, type EventSource, type StreamEvent } from './logic';
import { OutcomePill, StatePill } from './ui';

const PAGE = 50;

export default function EventLog() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const [source, setSource] = useState<EventSource | 'all'>('all');
  const [outcome, setOutcome] = useState<EventOutcome | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const t = now();

  const all = useMemo(() => buildEventStream(d), [d]);
  const counts = useMemo(() => outcomeCounts(all), [all]);
  const rows = useMemo(() => filterEvents(all, { source, outcome, query }), [all, source, outcome, query]);
  const monitoring = d.integrations.find((i) => i.area === 'monitoring');
  const canRetry = can('integrations.configure');

  const retry = (e: StreamEvent) =>
    act(
      {
        label: 'Retry event',
        apply: (draft) => {
          const x = buildEventStream(draft).find((y) => y.id === e.id);
          if (!x) return { ok: false, error: 'Event not found' };
          if (x.outcome !== 'failed') return { ok: false, error: 'Already processed' };
          return { ok: true };
        },
        audit: () => ({ action: RETRY_ACTION, target: { type: 'event', id: e.id, label: `${e.type} ${e.reference}` }, summary: `Retried ${e.type} for ${e.reference} (simulated)` }),
      },
      'Retried and marked processed (simulated)',
    );

  const columns: Column<StreamEvent>[] = [
    { key: 'at', label: 'Time', width: 140, render: (e) => <span className="small num">{when(e.at, t)}</span> },
    {
      key: 'type',
      label: 'Event',
      render: (e) => (
        <div>
          <div className="cell-title">
            <code>{e.type}</code>
          </div>
          <div className="cell-sub">
            {SOURCE_LABEL[e.source]} · {e.provider}
          </div>
        </div>
      ),
    },
    {
      key: 'ref',
      label: 'Reference',
      render: (e) =>
        e.integrationId ? (
          <Link to={`/developer?open=${e.integrationId}`} className="small strong">
            {e.reference}
          </Link>
        ) : (
          <code className="small">{e.reference}</code>
        ),
    },
    { key: 'rec', label: 'Record', render: (e) => (e.record ? <RecordLink type={e.record.type} id={e.record.id}>{e.record.type === 'driver' ? 'Driver' : 'Passenger'}</RecordLink> : <span className="muted small">None</span>) },
    { key: 'outcome', label: 'Processing', render: (e) => <OutcomePill outcome={e.outcome} /> },
    {
      key: 'detail',
      label: 'Detail',
      render: (e) => (
        <div className="small">
          {e.detail}
          {e.retried ? <div className="cell-sub">Retried by {e.retried.by}, {when(e.retried.at, t)}</div> : null}
        </div>
      ),
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (e) =>
        e.outcome === 'failed' ? (
          <Button size="sm" icon="refresh" disabledReason={canRetry ? undefined : 'Needs developer access'} onClick={() => retry(e)}>
            Retry
          </Button>
        ) : null,
    },
  ];

  const filtered = source !== 'all' || outcome !== 'all' || query.trim() !== '';

  return (
    <>
      <PageHead title="Events and failures" sub="Webhook and job history built from the shared records. Test data; no provider sends events to this prototype." />

      <div className="grid cols-4">
        <Stat icon="webhook" label="Events" value={all.length} sub="Webhooks, jobs and checks" />
        <Stat icon="checkCircle" label="Processed" value={counts.processed} onClick={() => setOutcome('processed')} />
        <Stat icon="copy" label="Duplicates ignored" value={counts.duplicate} onClick={() => setOutcome('duplicate')} sub="Recorded, never applied twice" />
        <Stat icon="alert" label="Failed" value={counts.failed} tone={counts.failed ? 'danger' : undefined} onClick={() => setOutcome('failed')} sub={counts.failed ? 'Retry or resolve' : 'Nothing waiting'} />
      </div>

      <div className="section">
        <Card title="How events are processed" muted>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <span className="strong">Signature first.</span> The server checks each webhook’s signature with the provider secret before reading it; a bad signature is rejected and logged.
            </li>
            <li>
              <span className="strong">Idempotent.</span> Each event is keyed by reference and type. A repeat delivery is stored as “Duplicate, ignored” and changes no balance.
            </li>
            <li>
              <span className="strong">Processed is not paid.</span> A charge.failed that was recorded is processed; the payment itself still failed.
            </li>
          </ul>
        </Card>
      </div>

      <Section title="Event history">
        <FilterBar count={`${Math.min(limit, rows.length)} of ${rows.length} shown`}>
          <SearchInput value={query} onChange={(v) => (setQuery(v), setLimit(PAGE))} placeholder="Search by reference or event" />
          <Select<EventSource | 'all'>
            label="Source"
            value={source}
            onChange={(v) => (setSource(v), setLimit(PAGE))}
            options={[{ value: 'all', label: 'All sources' }, ...(Object.keys(SOURCE_LABEL) as EventSource[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))]}
          />
          <Segmented<EventOutcome | 'all'>
            label="Processing outcome"
            value={outcome}
            onChange={(v) => (setOutcome(v), setLimit(PAGE))}
            options={[
              { value: 'all', label: 'All' },
              { value: 'processed', label: 'Processed' },
              { value: 'duplicate', label: 'Duplicate' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </FilterBar>
        <Card flush>
        <Table
          rows={rows.slice(0, limit)}
          columns={columns}
          caption="Event history"
          rowKey={(e) => e.id}
          empty={
            filtered ? (
              <Empty title="No events match" icon="webhook" action={<Button onClick={() => (setSource('all'), setOutcome('all'), setQuery(''))}>Clear filters</Button>}>
                Check the reference, or widen the source and outcome.
              </Empty>
            ) : (
              <Empty title="No events yet" icon="webhook">
                Webhooks and job results appear here once providers are connected.
              </Empty>
            )
          }
        />
        </Card>
        {rows.length > limit ? (
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setLimit((n) => n + PAGE)}>
              Show more ({rows.length - limit} left)
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title="App and backend errors">
        <Card>
          <Empty
            title="Monitoring is not connected yet"
            icon="radar"
            action={
              monitoring ? (
                <Link to={`/developer?open=${monitoring.id}`} className="btn secondary sm">
                  Open the monitoring integration
                </Link>
              ) : undefined
            }
          >
            Crash reports, backend errors, performance and alerts appear here once a monitoring provider is chosen and tested.
            {monitoring ? (
              <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                <StatePill state={monitoring.state} />
              </div>
            ) : null}
          </Empty>
        </Card>
      </Section>
    </>
  );
}
