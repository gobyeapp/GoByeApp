import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTOMATIONS, ROLE_LABELS, type CityId } from '@gobye/core';
import { count, when } from '@/data/format';
import { useOpenRecord } from '@/data/records';
import { useFilters, useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { AttentionList, Button, Card, Empty, LAGOS, PageHead, Pill, Stat } from '@/ui/kit';
import { detectProblems, dismissedFromAudit, PROBLEM_LABELS } from '@/workspaces/operations/logic';
import { overResponseTarget, sortQueue, isOpen } from '@/workspaces/care/logic';
import { greeting, useOpener } from './useOpener';
import './home.css';
import { financeWork, operationsWork, safetyWork, supportWork, technicalWork, verificationWork, workspacePanels, type PanelKey } from './insights';

/**
 * My work (owner brief §23): a focused workspace per staff role, built from the same components as Home.
 * Panels follow the staff member's responsibility permissions; each links on to the full page.
 */
const TITLE: Record<PanelKey, string> = {
  operations: 'Operations',
  verification: 'Driver verification',
  support: 'Support',
  safety: 'Safety',
  finance: 'Finance',
  technical: 'Technical',
};

export default function Workspace() {
  const d = useData();
  const { now } = usePlatform();
  const { staff, can, inScope } = useSession();
  const { city } = useFilters();
  const open = useOpener();
  const openRecord = useOpenRecord();
  const t = now();
  const here = (c: CityId) => inScope(c) && (city === 'all' || city === c);
  const panels = workspacePanels(can);
  const navigate = useNavigate();
  /** Open a case page with its drawer, only when the role can open that page. */
  const deep = (path: string, id: string) => (open(path) ? () => navigate(`${path}?open=${encodeURIComponent(id)}`) : undefined);

  const Panel = ({ k, path, action, children }: { k: PanelKey; path: string; action: string; children: ReactNode }) => (
    <section aria-labelledby={`p-${k}`}>
      <div className="panel-head">
        <h2 id={`p-${k}`}>{TITLE[k]}</h2>
        <span className="actions">
          <Button size="sm" variant="secondary" iconEnd="right" onClick={open(path)} disabledReason={open(path) ? undefined : 'Your role can’t open this page'}>
            {action}
          </Button>
        </span>
      </div>
      <div className="stack" style={{ gap: 16 }}>{children}</div>
    </section>
  );

  const render: Record<PanelKey, () => ReactNode> = {
    operations: () => {
      const w = operationsWork(d, here);
      const live = detectProblems(d.trips, t, (c, at) => here(c) && at === undefined, dismissedFromAudit(d.audit)).filter((p) => p.kind !== 'cancelled' && p.kind !== 'no_driver').slice(0, 5);
      return (
        <Panel k="operations" path="/live" action="Open live operations">
          <div className="grid cols-3">
            <Stat label="Active rides" icon="route" value={count(w.active)} sub="Searching, on the way or on trip" onClick={open('/live')} />
            <Stat label="Unmatched requests" icon="radar" value={count(w.unmatched)} tone={w.unmatched ? 'warning' : undefined} sub="Still searching for a driver" onClick={open('/live')} />
            <Stat label="Delayed pickups" icon="time" value={count(w.delayed)} tone={w.delayed ? 'danger' : undefined} sub="More than 5 min behind estimate" onClick={open('/live')} />
          </div>
          <Card flush>
            <AttentionList
              items={live.map((p) => ({ key: p.key, title: `${PROBLEM_LABELS[p.kind]} · ${p.ref}`, count: 1, severity: p.severity === 'danger' ? 'high' : 'medium', context: p.detail, action: { label: 'Open ride', onClick: () => openRecord({ type: 'trip', id: p.tripId }) } }))}
              empty={<Empty title="No live problems" art="completedTrips">No delayed pickups, long searches or stuck payments.</Empty>}
            />
          </Card>
        </Panel>
      );
    },
    verification: () => {
      const w = verificationWork(d, t, here);
      return (
        <Panel k="verification" path="/drivers" action="Open drivers">
          <div className="grid cols-3">
            <Stat label="In review" icon="fileCheck" value={count(w.inReview)} sub="Applied or being reviewed" onClick={open('/drivers')} />
            <Stat label="Pending documents" icon="document" value={count(w.documentsPending)} sub="Waiting on the driver" onClick={open('/drivers')} />
            <Stat label="Expiring documents" icon="time" value={count(w.expiring)} tone={w.expiring ? 'warning' : undefined} sub="Approved drivers, next 14 days" onClick={open('/drivers')} />
          </div>
          <Card flush>
            {w.queue.length ? (
              <ul className="mini-list">
                {w.queue.slice(0, 5).map((x) => (
                  <li key={x.id}>
                    <span>
                      <span className="strong" style={{ display: 'block' }}>{x.name}</span>
                      <span className="cell-sub">{x.vehicle.make} {x.vehicle.model} · applied {when(x.appliedAt, t)}</span>
                    </span>
                    <Button size="sm" variant="ghost" iconEnd="right" onClick={() => openRecord({ type: 'driver', id: x.id })}>Review</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Review queue is clear" art="verification">New applications appear here.</Empty>
            )}
          </Card>
        </Panel>
      );
    },
    support: () => {
      const w = supportWork(d, t, here, staff?.id);
      const queue = sortQueue(d.cases.filter((c) => here(c.city) && c.team === 'care' && isOpen(c.status) && (c.ownerId === staff?.id || overResponseTarget(c, t) || c.status === 'escalated'))).slice(0, 5);
      return (
        <Panel k="support" path="/cases" action="Open support cases">
          <div className="grid cols-4">
            <Stat label="Assigned to me" icon="user" value={count(w.mine)} sub="Open cases you own" onClick={open('/cases')} />
            <Stat label="Escalations" icon="flag" value={count(w.escalated)} sub="Waiting on another team" onClick={open('/cases')} />
            <Stat label="Unresolved" icon="headphone" value={count(w.unresolved)} sub="Open support cases" onClick={open('/cases')} />
            <Stat label="Past response target" icon="time" value={count(w.overdue)} tone={w.overdue ? 'danger' : undefined} sub="Placeholder targets" onClick={open('/cases')} />
          </div>
          <Card flush>
            {queue.length ? (
              <ul className="mini-list">
                {queue.map((c) => (
                  <li key={c.id}>
                    <span>
                      <span className="strong" style={{ display: 'block' }}>{c.ref} · {c.subject}</span>
                      <span className="cell-sub">{c.priority.charAt(0).toUpperCase() + c.priority.slice(1)} priority · opened {when(c.openedAt, t)}{overResponseTarget(c, t) ? ' · past response target' : ''}</span>
                    </span>
                    <Button size="sm" variant="ghost" iconEnd="right" onClick={deep('/cases', c.id)} disabledReason={deep('/cases', c.id) ? undefined : 'Your role can’t open support cases'}>Open</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nothing urgent in your queue" art="supportTicket">Cases you own, escalations and overdue cases appear here.</Empty>
            )}
          </Card>
        </Panel>
      );
    },
    safety: () => {
      const w = safetyWork(d, here);
      const list = sortQueue(d.cases.filter((c) => here(c.city) && c.team === 'safety' && isOpen(c.status))).slice(0, 5);
      return (
        <Panel k="safety" path="/safety" action="Open safety">
          <div className="grid cols-3">
            <Stat label="Not acknowledged" icon="safeAlert" value={count(w.unacknowledged)} tone={w.unacknowledged ? 'danger' : undefined} sub="Needs a person now" onClick={open('/safety')} />
            <Stat label="Open incidents" icon="shield" value={count(w.open)} sub="Acknowledged or in progress" onClick={open('/safety')} />
            <Stat label="Urgent" icon="alert" value={count(w.urgent)} sub="Highest priority" onClick={open('/safety')} />
          </div>
          <Card flush>
            {list.length ? (
              <ul className="mini-list">
                {list.map((c) => (
                  <li key={c.id}>
                    <span>
                      <span className="strong" style={{ display: 'block' }}>{c.ref} · {c.subject}</span>
                      <span className="cell-sub">{c.status === 'new' ? 'Not acknowledged' : 'In progress'} · opened {when(c.openedAt, t)}</span>
                    </span>
                    <Button size="sm" variant="ghost" iconEnd="right" onClick={deep('/safety', c.id)}>Open</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No open incidents" art="safetyShield" />
            )}
          </Card>
        </Panel>
      );
    },
    finance: () => {
      const w = financeWork(d);
      return (
        <Panel k="finance" path="/finance/collections" action="Open collections">
          <div className="grid cols-4">
            <Stat label="Payment issues" icon="exchange" value={count(w.pendingCollections + w.failedCollections)} tone={w.failedCollections ? 'warning' : undefined} sub={`${count(w.pendingCollections)} pending · ${count(w.failedCollections)} failed`} onClick={open('/finance/collections')} />
            <Stat label="Reconciliation" icon="balance" value={count(w.reconciliationFailures)} tone={w.reconciliationFailures ? 'danger' : undefined} sub="Runs failed or needing a lookup (simulated)" onClick={open('/finance/reconciliation')} />
            <Stat label="Expense approvals" icon="receipt" value={count(w.expenseApprovals)} sub={w.expenseApprovals ? 'Waiting for a decision' : 'None waiting'} onClick={open('/costs/expenses')} />
            <Stat label="Payout records" icon="bank" value={count(w.payoutsWaiting)} sub={`Awaiting review · ${count(w.payoutsProcessing)} processing`} onClick={open('/finance/withdrawals')} />
          </div>
        </Panel>
      );
    },
    technical: () => {
      const w = technicalWork(d);
      const failed = d.automationRuns.filter((r) => r.status === 'failed' || r.status === 'needs_lookup').slice(0, 4);
      const name = (id: string) => AUTOMATIONS.find((a) => a.id === id)?.name ?? id;
      return (
        <Panel k="technical" path="/developer" action="Open integrations">
          <div className="grid cols-4">
            <Stat label="Provider health" icon="plugin" value={`${count(w.integrationsLive)} of ${count(w.integrationsTotal)}`} sub="Integrations live; the rest are prototype or test" onClick={open('/developer')} />
            <Stat label="Degraded" icon="alert" value={count(w.degraded)} tone={w.degraded ? 'danger' : undefined} sub={`${count(w.openFailures)} unresolved failures`} onClick={open('/developer')} />
            <Stat label="Automation failures" icon="settings" value={count(w.automationFailures)} tone={w.automationFailures ? 'warning' : undefined} sub={`${count(w.needsLookup)} need a lookup · simulated history`} onClick={open('/automation/failed')} />
            <Stat label="API availability" icon="server" value="Not measured" sub="Monitoring not connected" />
          </div>
          <Card flush>
            {failed.length ? (
              <ul className="mini-list">
                {failed.map((r) => (
                  <li key={r.id}>
                    <span>
                      <span className="strong" style={{ display: 'block' }}>{name(r.automationId)}</span>
                      <span className="cell-sub">{r.attempts.at(-1)?.failure?.message ?? 'Failed'} · {when(r.finishedAt ?? r.queuedAt, t)}</span>
                    </span>
                    <Pill tone={r.status === 'needs_lookup' ? 'danger' : 'warning'}>{r.status === 'needs_lookup' ? 'Needs lookup' : 'Failed'}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No automation failures" art="automation" />
            )}
          </Card>
        </Panel>
      );
    },
  };

  return (
    <>
      <PageHead
        eyebrow={new Date(t).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: LAGOS })}
        title="My work"
        sub={`${greeting(t)}. Your queues as ${staff ? staff.roles.map((r) => ROLE_LABELS[r]).join(' and ') : 'staff'}, most urgent first.`}
        meta={<Pill tone="neutral" icon="info">Test data</Pill>}
      />
      {panels.length ? (
        <div className="work-panels">{panels.map((k) => <div key={k}>{render[k]()}</div>)}</div>
      ) : (
        <Card>
          <Empty title="No focused queues for your role" art="analytics">Use the menu to open the pages your role can see.</Empty>
        </Card>
      )}
    </>
  );
}
