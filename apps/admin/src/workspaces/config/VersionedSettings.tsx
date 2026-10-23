import { useMemo, useState, type ReactNode } from 'react';
import { canDecide, versionInForce, type ConfigKey, type ConfigVersion, type Permission } from '@gobye/core';
import { date, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, KV, Notice, Pill, Section, Table, type Column, type Tone } from '@/ui/kit';
import { Icon, type IconName } from '@/ui/Icon';
import './config.css';
import {
  approvalFor,
  dayKey,
  decideVersion,
  deriveStatus,
  diffDescribed,
  discardDraft,
  effectiveFromDay,
  isPublished,
  nextScheduled,
  publishDirect,
  saveDraft,
  submitForApproval,
  validateEffectiveDay,
  versionsOf,
  type DerivedStatus,
  type Described,
  type Diff,
} from './logic';

/**
 * One versioned setting (fares, packages, categories…): what is in force now, what is scheduled
 * next, changes in progress, and full history with who changed what. Changes are always new
 * ConfigVersion records; an active version is never edited.
 */

export const TERMS_LINE = 'Existing bookings, purchased passes and earned rewards keep the terms that applied when they were created.';

export const VERSION_STATUS: Record<DerivedStatus, { tone: Tone; text: string; icon: IconName }> = {
  draft: { tone: 'neutral', text: 'Draft', icon: 'edit' },
  pending_approval: { tone: 'warning', text: 'Pending approval', icon: 'time' },
  approved: { tone: 'info', text: 'Approved, not yet published', icon: 'check' },
  scheduled: { tone: 'info', text: 'Scheduled', icon: 'calendar' },
  in_force: { tone: 'success', text: 'In force', icon: 'checkCircle' },
  superseded: { tone: 'neutral', text: 'Superseded', icon: 'history' },
  rejected: { tone: 'danger', text: 'Rejected', icon: 'close' },
};

export function VersionPill({ status }: { status: DerivedStatus }) {
  const s = VERSION_STATUS[status];
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {s.text}
    </Pill>
  );
}

export function DiffTable({ diff, empty = 'No changes from the version in force.' }: { diff: Diff; empty?: string }) {
  if (!diff.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="table-wrap diff-table">
      <table className="table">
        <caption className="sr">Changed settings, before and after</caption>
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">Before</th>
            <th scope="col" aria-hidden />
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {diff.map((d) => (
            <tr key={d.field}>
              <td className="strong">{d.field}</td>
              <td className="muted num">
                <del>{d.from}</del>
              </td>
              <td className="muted" aria-hidden style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}>
                <Icon name="arrowRight" size={14} />
              </td>
              <td className="num">
                <ins className="diff-after">{d.to}</ins>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const describedKV = (d: Described): [string, ReactNode][] => d.map((x) => [x.label, x.text]);
const actorName = (a?: { name: string }) => a?.name ?? 'Not yet';

export interface VersionedSettingsProps<T> {
  configKey: ConfigKey;
  /** Name used in titles, e.g. "Fare rules" → "Fare rules v3". */
  name: string;
  normalize: (raw: unknown) => T;
  describe: (v: T) => Described;
  /** Validation errors for a proposed value. `canOverride` = the viewer holds config.publish (owner). */
  validate?: (v: T, ctx: { canOverride: boolean }) => string[];
  renderEditor: (p: { value: T; onChange: (v: T) => void; base: T | null; canOverride: boolean }) => ReactNode;
  /** Side by side comparison (e.g. example fares) of the version in force and a proposed one. */
  renderPreview?: (p: { current: T; proposed: T; proposedLabel: string }) => ReactNode;
  /** Custom read only view of a value (defaults to a key/value list). */
  renderValue?: (v: T) => ReactNode;
  /** Warnings for a change (e.g. pausing a city). Shown in the editor and the change's details. */
  warnings?: (before: T | null, after: T) => ReactNode;
  /** What changes elsewhere when a version takes effect. */
  effect: ReactNode;
  /** Used when no version has ever been published. */
  fallback?: { value: T; label: string };
  /** Who may create and edit drafts (default: config.edit or config.publish). */
  editPermissions?: Permission[];
}

type EditorState<T> = { id?: string; value: T; day: string; note: string };

export function VersionedSettings<T>(p: VersionedSettingsProps<T>) {
  const d = useData();
  const { now } = usePlatform();
  const { can, staff } = useSession();
  const act = useAction();
  const t = now();

  const versions = useMemo(() => versionsOf<unknown>(d.configVersions, p.configKey), [d.configVersions, p.configKey]);
  const inForce = versionInForce(versions, t);
  const next = nextScheduled(versions, t);
  const inProgress = versions.filter((v) => ['draft', 'pending_approval', 'approved'].includes(deriveStatus(v, versions, d.approvals, t)));
  const latestPublished = versions.find(isPublished);

  const canPublish = can('config.publish');
  const canEdit = (p.editPermissions ?? ['config.edit', 'config.publish']).some((x) => can(x as Permission)) || canPublish;

  const [editor, setEditor] = useState<EditorState<T> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'publish' | 'reject' | 'discard'; id?: string }>(null);
  const [error, setError] = useState<string | null>(null);

  const valueOf = (v?: ConfigVersion<unknown>) => (v ? p.normalize(v.value) : (p.fallback?.value ?? null));
  const inForceValue = valueOf(inForce);
  const label = (v: Pick<ConfigVersion, 'version'>) => `${p.name} v${v.version}`;
  /** "Before" for a version: the published one before it, or for unpublished ones what will be in force on its date. */
  const beforeOf = (v: ConfigVersion<unknown>): T | null => {
    if (isPublished(v)) {
      const prev = versions.filter((x) => isPublished(x) && x.version < v.version)[0];
      return prev ? p.normalize(prev.value) : (p.fallback?.value ?? null);
    }
    const at = versionInForce(versions.filter((x) => x.id !== v.id), Math.max(v.effectiveFrom, t));
    return at ? p.normalize(at.value) : (p.fallback?.value ?? null);
  };
  const diffOf = (v: ConfigVersion<unknown>) => {
    const b = beforeOf(v);
    return diffDescribed(b ? p.describe(b) : null, p.describe(p.normalize(v.value)));
  };

  /* ---------- Actions ---------- */
  const startNew = () => {
    const base = valueOf(latestPublished) ?? valueOf(inForce);
    if (base === null) return;
    setError(null);
    setEditor({ value: structuredClone(base), day: dayKey(t), note: '' });
  };
  const startEdit = (v: ConfigVersion<unknown>) => {
    setError(null);
    setOpenId(null);
    setEditor({ id: v.id, value: p.normalize(structuredClone(v.value)), day: dayKey(Math.max(v.effectiveFrom, t)), note: v.note });
  };

  const save = async (then: 'draft' | 'submit' | 'publish') => {
    if (!editor) return;
    const ed = editor;
    const effectiveFrom = effectiveFromDay(ed.day, t);
    const before = (() => {
      const at = versionInForce(versions.filter((x) => x.id !== ed.id), Math.max(effectiveFrom, t));
      return at ? p.normalize(at.value) : (p.fallback?.value ?? null);
    })();
    const diff = diffDescribed(before ? p.describe(before) : null, p.describe(ed.value));
    let savedId = ed.id ?? '';
    let versionNo = 0;
    const r = await act(
      {
        label: then === 'publish' ? `Publish ${p.name}` : then === 'submit' ? `Send ${p.name} for approval` : `Save ${p.name} draft`,
        apply: (draft, ctx) => {
          const dayErr = validateEffectiveDay(ed.day, ctx.now);
          if (dayErr) return { ok: false, error: dayErr };
          const s = saveDraft(draft, { id: ed.id, key: p.configKey, value: ed.value, note: ed.note, effectiveFrom: effectiveFromDay(ed.day, ctx.now) }, ctx);
          if (!s.ok) return s;
          savedId = s.id;
          const v = draft.configVersions.find((x) => x.id === s.id)!;
          versionNo = v.version;
          if (then === 'submit') return submitForApproval(draft, s.id, `Publish ${label(v)} (effective ${date(v.effectiveFrom)})`, ctx);
          if (then === 'publish') return publishDirect(draft, s.id, ctx);
          return { ok: true };
        },
        audit: () => ({
          action: then === 'publish' ? 'config.published' : then === 'submit' ? 'config.submitted' : 'config.draft_saved',
          target: { type: 'config', id: savedId, label: `${p.name} v${versionNo}` },
          summary:
            then === 'publish'
              ? `Published ${p.name} v${versionNo} directly as owner, effective ${date(effectiveFrom)}`
              : then === 'submit'
                ? `Sent ${p.name} v${versionNo} for owner approval, effective ${date(effectiveFrom)}`
                : `Saved ${p.name} v${versionNo} as a draft`,
          diff,
          reason: ed.note.trim() || undefined,
        }),
      },
      then === 'publish' ? (effectiveFrom > t ? `Scheduled for ${date(effectiveFrom)}` : 'Published. Now in force') : then === 'submit' ? 'Sent for owner approval' : 'Draft saved',
    );
    if (r.ok) setEditor(null);
    else setError(r.error);
  };

  const runOn = async (v: ConfigVersion<unknown>, kind: 'submit' | 'publish' | 'approve' | 'finish' | 'reject' | 'discard', reason = '') => {
    const diff = diffOf(v);
    const titles = { submit: 'Send for approval', publish: 'Publish', approve: 'Approve', finish: 'Finish publishing', reject: 'Reject', discard: 'Discard draft' } as const;
    const r = await act(
      {
        label: `${titles[kind]} ${label(v)}`,
        apply: (draft, ctx) => {
          if (kind === 'submit') return submitForApproval(draft, v.id, `Publish ${label(v)} (effective ${date(v.effectiveFrom)})`, ctx);
          if (kind === 'publish') return publishDirect(draft, v.id, ctx);
          if (kind === 'discard') return discardDraft(draft, v.id);
          return decideVersion(draft, v.id, kind !== 'reject', reason, ctx);
        },
        audit: () => ({
          action: { submit: 'config.submitted', publish: 'config.published', approve: 'config.approved', finish: 'config.published', reject: 'config.rejected', discard: 'config.draft_discarded' }[kind],
          target: { type: 'config', id: v.id, label: label(v) },
          summary: {
            submit: `Sent ${label(v)} for owner approval`,
            publish: `Published ${label(v)} directly as owner`,
            approve: `Approved and published ${label(v)}`,
            finish: `Published ${label(v)} after approval`,
            reject: `Rejected ${label(v)}`,
            discard: `Discarded draft ${label(v)}`,
          }[kind],
          diff: kind === 'discard' || kind === 'reject' ? undefined : diff,
          reason: reason || undefined,
        }),
      },
      { submit: 'Sent for owner approval', publish: 'Published', approve: 'Approved and published', finish: 'Published', reject: 'Rejected', discard: 'Draft discarded' }[kind],
    );
    if (r.ok) {
      setConfirm(null);
      if (kind === 'discard') setOpenId(null);
    }
    return r;
  };

  /** Actions available on a version for this viewer. */
  const actionsFor = (v: ConfigVersion<unknown>, compact = false) => {
    const st = deriveStatus(v, versions, d.approvals, t);
    const a = approvalFor(d.approvals, v.id);
    const size = compact ? 'sm' : 'md';
    const out: ReactNode[] = [];
    if (st === 'draft' && canEdit) {
      out.push(<Button key="edit" size={size} icon="edit" onClick={() => startEdit(v)}>Edit</Button>);
      out.push(<Button key="discard" size={size} variant="ghost" onClick={() => setConfirm({ kind: 'discard', id: v.id })}>Discard</Button>);
      if (canPublish) out.push(<Button key="pub" size={size} variant="primary" icon="check" onClick={() => setConfirm({ kind: 'publish', id: v.id })}>Publish</Button>);
      else out.push(<Button key="sub" size={size} variant="primary" icon="arrowRight" onClick={() => runOn(v, 'submit')}>Send for approval</Button>);
    }
    if (st === 'pending_approval' && a && staff) {
      if (canDecide(a, staff)) {
        out.push(<Button key="rej" size={size} variant="danger-soft" onClick={() => setConfirm({ kind: 'reject', id: v.id })}>Reject</Button>);
        out.push(<Button key="app" size={size} variant="primary" icon="check" onClick={() => runOn(v, 'approve')}>Approve and publish</Button>);
      } else if (canPublish) {
        out.push(<Button key="pub" size={size} variant="primary" icon="check" onClick={() => setConfirm({ kind: 'publish', id: v.id })}>Publish directly</Button>);
      } else {
        out.push(<Button key="wait" size={size} disabledReason={a.requestedBy.kind === 'staff' && a.requestedBy.id === staff.id ? 'Waiting for the owner. You can’t approve your own request.' : 'Only the owner can approve configuration changes'}>Approve</Button>);
      }
    }
    if (st === 'approved' && (canEdit || canPublish)) out.push(<Button key="fin" size={size} variant="primary" icon="check" onClick={() => runOn(v, 'finish')}>Finish publishing</Button>);
    return out;
  };

  /* ---------- Editor validation ---------- */
  const edErrors = editor ? (p.validate?.(editor.value, { canOverride: canPublish }) ?? []) : [];
  const edDayError = editor ? validateEffectiveDay(editor.day, t) : null;
  const edBlock = edErrors[0] ?? edDayError ?? (editor && !editor.note.trim() ? 'Add a note that explains the change' : undefined);
  const edBefore = (() => {
    if (!editor) return null;
    const at = versionInForce(versions.filter((x) => x.id !== editor.id), Math.max(edDayError ? t : effectiveFromDay(editor.day, t), t));
    return at ? p.normalize(at.value) : (p.fallback?.value ?? null);
  })();
  const edDiff = editor ? diffDescribed(edBefore ? p.describe(edBefore) : null, p.describe(editor.value)) : [];

  const open = versions.find((v) => v.id === openId);
  const confirmV = confirm?.id ? versions.find((v) => v.id === confirm.id) : undefined;

  const historyCols: Column<ConfigVersion<unknown>>[] = [
    { key: 'v', label: 'Version', sortValue: (v) => v.version, render: (v) => <span className="strong">v{v.version}</span>, width: 90 },
    { key: 's', label: 'Status', render: (v) => <VersionPill status={deriveStatus(v, versions, d.approvals, t)} /> },
    { key: 'e', label: 'Effective from', sortValue: (v) => v.effectiveFrom, render: (v) => <span className="num">{date(v.effectiveFrom)}</span> },
    { key: 'c', label: 'Created by', render: (v) => <div><div>{actorName(v.createdBy)}</div><div className="cell-sub">{when(v.createdAt, t)}</div></div> },
    { key: 'a', label: 'Approved by', render: (v) => <span className={v.approvedBy ? undefined : 'muted'}>{v.approvedBy ? actorName(v.approvedBy) : 'Not yet'}</span> },
    { key: 'n', label: 'Note', render: (v) => <span className="cell-sub">{v.note}</span> },
    { key: 'd', label: 'Changes', render: (v) => <span className="muted small">{diffOf(v).length || 'None'}</span>, align: 'right' },
  ];

  const pendingCompare = next ?? inProgress[0];

  return (
    <>
      <Notice tone="info" icon="history">
        <div className="strong">{TERMS_LINE}</div>
        <div className="muted small" style={{ marginTop: 2 }}>{p.effect}</div>
      </Notice>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card className="cfg-current" title="In force now" actions={inForce ? <VersionPill status="in_force" /> : <Pill tone="neutral">Default</Pill>}>
          {inForce ? (
            <dl className="cfg-meta">
              <div><dt>Version</dt><dd>{label(inForce)}</dd></div>
              <div><dt>Since</dt><dd className="num">{date(inForce.effectiveFrom)}</dd></div>
              <div><dt>Created by</dt><dd>{actorName(inForce.createdBy)}</dd></div>
              <div><dt>Approved by</dt><dd>{actorName(inForce.approvedBy)}</dd></div>
            </dl>
          ) : (
            <p className="muted small" style={{ marginBottom: 12 }}>No version published yet. {p.fallback?.label}</p>
          )}
          {inForceValue !== null ? (p.renderValue ? p.renderValue(inForceValue) : <KV items={describedKV(p.describe(inForceValue))} />) : <Empty title="Nothing in force" />}
        </Card>
        <Card title="Next scheduled" actions={next ? <VersionPill status="scheduled" /> : null}>
          {next ? (
            <div className="stack">
              <p className="muted small">
                {label(next)} takes effect <span className="strong" style={{ color: 'var(--text)' }}>{date(next.effectiveFrom)}</span> · approved by {actorName(next.approvedBy)} · {next.note}
              </p>
              <DiffTable diff={diffOf(next)} />
              {p.warnings?.(inForceValue, p.normalize(next.value))}
              <div>
                <Button size="sm" variant="ghost" icon="eye" onClick={() => setOpenId(next.id)}>
                  View details
                </Button>
              </div>
            </div>
          ) : (
            <Empty title="Nothing scheduled" icon="calendar">
              The version in force stays until a new one is published.
            </Empty>
          )}
        </Card>
      </div>

      <div className="cfg-rule small" role="note">
        <Icon name="shield" size={16} />
        <span>
          <span className="strong">How a change goes live:</span> save a draft, send it for approval, the company owner approves, and it takes effect on its effective date (Lagos time).{' '}
          {canPublish ? 'As owner you may publish directly; your name is recorded as the approver.' : canEdit ? 'You can prepare and send changes; only the owner can approve them.' : 'Your role can view these settings but not change them.'}
        </span>
      </div>

      {p.renderPreview && inForceValue !== null && pendingCompare ? (
        <Section title={`Compare with ${label(pendingCompare)}`}>
          <Card>{p.renderPreview({ current: inForceValue, proposed: p.normalize(pendingCompare.value), proposedLabel: `${label(pendingCompare)} (${VERSION_STATUS[deriveStatus(pendingCompare, versions, d.approvals, t)].text.toLowerCase()})` })}</Card>
        </Section>
      ) : null}

      <Section
        title="Changes in progress"
        actions={
          canEdit ? (
            <Button variant="primary" icon="add" onClick={startNew}>
              New version
            </Button>
          ) : (
            <Button icon="add" disabledReason="Your role can view settings but not change them">New version</Button>
          )
        }
      >
        {inProgress.length === 0 ? (
          <Card>
            <Empty title="No drafts or approval requests" icon="edit">
              {canEdit ? 'Start a new version to change these settings. It takes effect only after the owner approves it.' : 'Nothing is waiting.'}
            </Empty>
          </Card>
        ) : (
          <div className="stack">
            {inProgress.map((v) => {
              const st = deriveStatus(v, versions, d.approvals, t);
              const a = approvalFor(d.approvals, v.id);
              const diff = diffOf(v);
              return (
                <Card key={v.id} className="cfg-change">
                  <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12, alignItems: 'flex-start' }}>
                    <div className="stack tight" style={{ minWidth: 0 }}>
                      <div className="row wrap">
                        <span className="strong" style={{ fontSize: 15 }}>{label(v)}</span>
                        <VersionPill status={st} />
                      </div>
                      <span className="muted small">
                        effective {date(v.effectiveFrom)} · by {actorName(v.createdBy)} {when(v.createdAt, t).toLowerCase()}
                        {a && st === 'pending_approval' ? ` · waiting for ${a.approverRoles.join(' or ')}` : ''}
                      </span>
                    </div>
                    <div className="row wrap">
                      <Button size="sm" variant="ghost" icon="eye" onClick={() => setOpenId(v.id)}>
                        Details
                      </Button>
                      {actionsFor(v, true)}
                    </div>
                  </div>
                  {v.effectiveFrom < t && st !== 'draft' ? (
                    <div style={{ marginBottom: 10 }}>
                      <Notice tone="warning">The effective date has passed. Publishing makes it take effect immediately.</Notice>
                    </div>
                  ) : null}
                  <p className="small cfg-note" style={{ marginBottom: 10 }}>
                    <Icon name="chat" size={14} /> {v.note}
                  </p>
                  <DiffTable diff={diff} />
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="History">
        <Card flush>
          <Table rows={versions} columns={historyCols} caption={`${p.name} versions`} rowKey={(v) => v.id} onRowClick={(v) => setOpenId(v.id)} empty={<Empty title="No versions yet" />} />
        </Card>
      </Section>

      {open ? (
        <Drawer title={label(open)} sub={<VersionPill status={deriveStatus(open, versions, d.approvals, t)} />} onClose={() => setOpenId(null)} footer={actionsFor(open).length ? actionsFor(open) : undefined}>
          {(() => {
            const a = approvalFor(d.approvals, open.id);
            const v = p.normalize(open.value);
            const before = beforeOf(open);
            return (
              <>
                <KV
                  items={[
                    ['Effective from', date(open.effectiveFrom)],
                    ['Created by', `${actorName(open.createdBy)}, ${when(open.createdAt, t)}`],
                    ['Approved by', actorName(open.approvedBy)],
                    ['Approval request', a ? `${a.status === 'pending' ? 'Pending' : a.status === 'approved' ? 'Approved' : 'Rejected'}${a.decidedBy ? ` by ${a.decidedBy.name}` : ''}${a.note ? `: ${a.note}` : ''}` : 'None'],
                    ['Note', open.note],
                  ]}
                />
                <div className="stack">
                  <h3>{isPublished(open) ? 'Changed from the previous version' : 'Changes from what will be in force'}</h3>
                  <DiffTable diff={diffOf(open)} empty="No differences." />
                </div>
                {p.warnings?.(before, v)}
                {p.renderPreview && inForceValue !== null && open.id !== inForce?.id ? (
                  <div className="stack">
                    <h3>Preview</h3>
                    {p.renderPreview({ current: inForceValue, proposed: v, proposedLabel: label(open) })}
                  </div>
                ) : null}
                <div className="stack">
                  <h3>All settings in this version</h3>
                  {p.renderValue ? p.renderValue(v) : <KV items={describedKV(p.describe(v))} />}
                </div>
              </>
            );
          })()}
        </Drawer>
      ) : null}

      {editor ? (
        <Drawer
          title={editor.id ? `Edit draft` : `New ${p.name.toLowerCase()} version`}
          sub="Saved as a new version. The version in force is never edited."
          onClose={() => setEditor(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button onClick={() => save('draft')} disabledReason={edBlock}>
                Save draft
              </Button>
              {canPublish ? (
                <Button variant="primary" icon="check" onClick={() => setConfirm({ kind: 'publish' })} disabledReason={edBlock}>
                  Publish
                </Button>
              ) : (
                <Button variant="primary" icon="arrowRight" onClick={() => save('submit')} disabledReason={edBlock}>
                  Send for approval
                </Button>
              )}
            </>
          }
        >
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <h3 className="cfg-step"><span>1</span> Settings</h3>
          {p.renderEditor({ value: editor.value, onChange: (value) => setEditor({ ...editor, value }), base: edBefore, canOverride: canPublish })}
          {edErrors.length ? (
            <Notice tone="danger" icon="alert">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {edErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {p.warnings?.(edBefore, editor.value)}
          <h3 className="cfg-step"><span>2</span> When and why</h3>
          <div className="grid cols-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            <Field label="Effective date" hint="Today or later. Lagos time." error={edDayError ?? undefined}>
              {(id) => <input id={id} className="input" type="date" min={dayKey(t)} value={editor.day} onChange={(e) => setEditor({ ...editor, day: e.target.value })} />}
            </Field>
          </div>
          <Field label="Note" hint="Why this change. Shown in the history and the approval request.">
            {(id) => <textarea id={id} className="textarea" value={editor.note} onChange={(e) => setEditor({ ...editor, note: e.target.value })} />}
          </Field>
          <h3 className="cfg-step"><span>3</span> Review</h3>
          <div className="stack">
            <h3>Before and after</h3>
            <DiffTable diff={edDiff} />
          </div>
          {p.renderPreview && edBefore !== null ? (
            <div className="stack">
              <h3>Preview</h3>
              {p.renderPreview({ current: edBefore, proposed: editor.value, proposedLabel: 'This draft' })}
            </div>
          ) : null}
          <Notice tone="info">{canPublish ? 'As owner you can publish directly. It is recorded in the audit trail with your name.' : 'The owner must approve before this takes effect.'}</Notice>
        </Drawer>
      ) : null}

      {confirm?.kind === 'publish' ? (
        <ConfirmDialog
          title="Publish without a second approval"
          body={[
            'As owner you can publish directly.',
            editor && !confirm.id ? `It takes effect ${editor.day === dayKey(t) ? 'now' : `on ${date(effectiveFromDay(editor.day, t))}`}.` : confirmV ? `It takes effect ${confirmV.effectiveFrom > t ? `on ${date(confirmV.effectiveFrom)}` : 'now'}.` : '',
            'Your name is recorded as the approver in the audit trail.',
          ]
            .filter(Boolean)
            .join(' ')}
          confirmLabel="Publish"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirmV) await runOn(confirmV, 'publish');
            else {
              await save('publish');
              setConfirm(null);
            }
          }}
        />
      ) : null}
      {confirm?.kind === 'reject' && confirmV ? (
        <ConfirmDialog title={`Reject ${label(confirmV)}`} body="The version in force stays. The requester sees your reason." confirmLabel="Reject" danger requireReason onCancel={() => setConfirm(null)} onConfirm={(reason) => runOn(confirmV, 'reject', reason)} />
      ) : null}
      {confirm?.kind === 'discard' && confirmV ? (
        <ConfirmDialog title={`Discard ${label(confirmV)}`} body="This draft never took effect. The audit trail keeps a record that it was discarded." confirmLabel="Discard" danger onCancel={() => setConfirm(null)} onConfirm={() => runOn(confirmV, 'discard')} />
      ) : null}
    </>
  );
}
