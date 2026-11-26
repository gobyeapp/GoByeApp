import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHECK_LABEL, CITY_LABELS, ISSUES, type CityId, type IssueCode } from '@gobye/core';
import { LIVE } from '@/data/live';
import { useSession } from '@/data/session';
import { useToast } from '@/data/store';
import { Button, ConfirmDialog, Drawer, Empty, ErrorState, Field, KV, Notice, PageHead, Pill, Skeleton, Table, Tabs, Timeline, type Tone } from '@/ui/kit';
import { FILE_LABEL, actionError, applicationsApi, masked, type AppStatus, type ApplicationDetail, type QueueItem } from './applicationsApi';

const TABS: { value: AppStatus; label: string }[] = [
  { value: 'pending_review', label: 'In review' },
  { value: 'changes_requested', label: 'Changes asked' },
  { value: 'in_progress', label: 'Registering' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
const FILE_TONE: Record<string, [Tone, string]> = { ready: ['success', 'Checked'], checking: ['warning', 'Checking'], problem: ['danger', 'Refused'], missing: ['danger', 'Missing'] };
const CHECK_TONE: Record<string, Tone> = { passed: 'success', failed: 'danger', waiting: 'warning', checking: 'info', queued: 'neutral' };
const EVENT: Record<string, string> = { step_saved: 'Saved a step', submitted: 'Sent for review', resubmitted: 'Sent back for review', changes_requested: 'Changes asked', approved: 'Approved', rejected: 'Rejected' };
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Driver applications from the GoBye API (D-081): the review queue, the application, and decisions. */
export default function Applications() {
  const { can } = useSession();
  const api = useMemo(() => (LIVE ? applicationsApi(LIVE.api) : null), []);
  const [tab, setTab] = useState<AppStatus>('pending_review');
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    const r = await api.list(tab);
    if (r.ok) setItems(r.value.items);
    else setError(r.error.message);
  }, [api, tab]);
  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  if (!api) return <Empty title="Not connected">The GoBye API isn’t connected to this build.</Empty>;

  return (
    <>
      <PageHead title="Driver applications" actions={<Button icon="refresh" onClick={load}>Refresh</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={TABS} />
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !items ? (
        <Skeleton rows={6} />
      ) : (
        <Table<QueueItem>
          rows={items}
          rowKey={(x) => x.driverId}
          onRowClick={(x) => setOpen(x.driverId)}
          empty={<Empty title="Nothing here" icon="fileCheck" />}
          columns={[
            { key: 'name', label: 'Driver', render: (x) => <span className="strong">{x.name}</span>, sortValue: (x) => x.name },
            { key: 'city', label: 'City', render: (x) => CITY_LABELS[x.city as CityId] },
            { key: 'sent', label: 'Sent', render: (x) => at(x.submittedAt), sortValue: (x) => x.submittedAt ?? '' },
            { key: 'issues', label: 'Open items', align: 'right', render: (x) => (x.openIssues ? <Pill tone="warning">{x.openIssues}</Pill> : '—') },
          ]}
        />
      )}
      {open ? <Review driverId={open} api={api} canVerify={can('drivers.verify')} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </>
  );
}

function Review({ driverId, api, canVerify, onClose, onChanged }: { driverId: string; api: ReturnType<typeof applicationsApi>; canVerify: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'changes' | null>(null);

  const load = useCallback(async () => {
    const r = await api.get(driverId);
    if (r.ok) setD(r.value);
    else setError(r.error.message);
  }, [api, driverId]);
  useEffect(() => void load(), [load]);

  const after = async (r: Awaited<ReturnType<typeof api.approve>>, done: string) => {
    const msg = actionError(r);
    if (msg) {
      toast(msg);
      await load();
      return;
    }
    if (r.ok) setD({ ...d!, ...r.value });
    toast(done);
    setDialog(null);
    onChanged();
  };

  const a = d?.application;
  const inReview = d?.status === 'pending_review';
  const why = !canVerify ? 'Your role can view applications but not decide them.' : !inReview ? 'Only an application in review can be decided.' : undefined;

  return (
    <Drawer
      title={d?.driver.name ?? 'Application'}
      sub={d ? `${CITY_LABELS[d.application.city as CityId]} · version ${d.version}` : undefined}
      onClose={onClose}
      footer={
        d ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" icon="check" disabled={!!why} disabledReason={why} onClick={() => setDialog('approve')}>Approve</Button>
            <Button icon="flag" disabled={!!why} disabledReason={why} onClick={() => setDialog('changes')}>Ask for changes</Button>
            <Button variant="danger-soft" disabled={!!why} disabledReason={why} onClick={() => setDialog('reject')}>Reject</Button>
          </div>
        ) : undefined
      }
    >
      {error ? <ErrorState message={error} onRetry={load} /> : !d || !a ? <Skeleton rows={8} /> : (
        <div style={{ display: 'grid', gap: 20 }}>
          <Notice tone={d.summary.stage === 'approved' ? 'success' : d.summary.stage === 'rejected' ? 'danger' : 'info'}>{d.summary.title}</Notice>
          <section>
            <h3 className="drawer-h">Checks</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {d.summary.checks.length ? d.summary.checks.map((c) => <Pill key={c.id} tone={CHECK_TONE[c.state] ?? 'neutral'}>{CHECK_LABEL[c.id]}</Pill>) : <span className="muted">Not sent yet</span>}
            </div>
          </section>
          {d.summary.issues.length ? (
            <section>
              <h3 className="drawer-h">Open items</h3>
              <ul>{d.summary.issues.map((i) => <li key={i.id}>{i.title}{i.note ? ` · ${i.note}` : ''}</li>)}</ul>
            </section>
          ) : null}
          <section>
            <h3 className="drawer-h">Details</h3>
            <KV
              items={[
                ['Name', a.personal ? `${a.personal.firstName} ${a.personal.lastName}` : '—'],
                ...(d.driver.phone ? ([['Phone', d.driver.phone]] as [string, string][]) : []),
                ['Licence', a.licence ? `${a.licence.number} · expires ${a.licence.expiry}` : '—'],
                ['Identity', a.identity ? `${a.identity.type.toUpperCase().replace('_', ' ')} ${masked(a.identity.number)}` : '—'],
                ['Vehicle', a.vehicle ? `${a.vehicle.year} ${a.vehicle.make} ${a.vehicle.model}, ${a.vehicle.colour} · ${a.vehicle.plate}` : '—'],
              ]}
            />
          </section>
          <section>
            <h3 className="drawer-h">Documents</h3>
            <KV items={d.files.map((f) => [FILE_LABEL[f.slot] ?? f.slot, <Pill key={f.fileId} tone={FILE_TONE[f.state]![0]}>{FILE_TONE[f.state]![1]}</Pill>])} />
            <p className="small muted" style={{ marginTop: 6 }}>Viewing documents needs file storage, which isn’t connected yet.</p>
          </section>
          <section>
            <h3 className="drawer-h">History</h3>
            <Timeline items={d.events.map((e) => ({ at: Date.parse(e.at), title: EVENT[e.kind] ?? e.kind, sub: e.by === 'staff' ? 'Staff' : e.by === 'driver' ? 'Driver' : 'System' }))} />
          </section>
        </div>
      )}
      {dialog === 'approve' && d ? (
        <ConfirmDialog title="Approve this driver?" body="Their vehicle becomes active and they can buy an access pass and go online." confirmLabel="Approve" onConfirm={async () => after(await api.approve(d.driverId, d.version), 'Driver approved')} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog === 'reject' && d ? (
        <ConfirmDialog title="Reject this application?" body="The driver sees your reason. Use at least 10 characters." confirmLabel="Reject" danger requireReason onConfirm={async (reason) => after(await api.reject(d.driverId, d.version, reason), 'Application rejected')} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog === 'changes' && d ? <ChangesDialog onCancel={() => setDialog(null)} onSend={async (codes, note) => after(await api.requestChanges(d.driverId, d.version, codes.map((code) => ({ code })), note), 'Sent back to the driver')} /> : null}
    </Drawer>
  );
}

function ChangesDialog({ onSend, onCancel }: { onSend: (codes: IssueCode[], note?: string) => Promise<void>; onCancel: () => void }) {
  const [codes, setCodes] = useState<IssueCode[]>([]);
  const [note, setNote] = useState('');
  return (
    <ConfirmDialog
      title="Ask for changes"
      confirmLabel={codes.length ? `Send ${codes.length === 1 ? '1 item' : `${codes.length} items`}` : 'Choose items'}
      body={
        <div style={{ display: 'grid', gap: 8 }}>
          {(Object.keys(ISSUES) as IssueCode[]).map((c) => (
            <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={codes.includes(c)} onChange={(e) => setCodes((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} />
              <span>{ISSUES[c].title}</span>
            </label>
          ))}
          <Field label="Note to the driver (optional)">{(id) => <textarea id={id} className="textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      }
      onConfirm={() => (codes.length ? onSend(codes, note.trim() || undefined) : undefined)}
      onCancel={onCancel}
    />
  );
}
