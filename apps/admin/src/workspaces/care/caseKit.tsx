import { useEffect, useState, type ReactNode } from 'react';
import type { Actor, CasePriority, CaseRecord, CaseStatus } from '@gobye/core';
import { label } from '@/data/format';
import { Icon } from '@/ui/Icon';
import { Button, Empty, Field, IconButton, Pill, Segmented, Timeline, type Tone } from '@/ui/kit';

/* Case building blocks shared by the care and safety workspaces. */

export const PRIORITY_PILL: Record<CasePriority, { tone: Tone; text: string }> = {
  urgent: { tone: 'danger', text: 'Urgent' },
  high: { tone: 'warning', text: 'High' },
  normal: { tone: 'neutral', text: 'Normal' },
  low: { tone: 'neutral', text: 'Low' },
};

export const STATUS_PILL: Record<CaseStatus, { tone: Tone; text: string; icon?: 'time' | 'checkCircle' | 'flag' | 'info' | 'refresh' | 'lock' }> = {
  new: { tone: 'info', text: 'New', icon: 'info' },
  in_progress: { tone: 'brand', text: 'In progress', icon: 'refresh' },
  waiting: { tone: 'warning', text: 'Waiting', icon: 'time' },
  escalated: { tone: 'danger', text: 'Escalated', icon: 'flag' },
  resolved: { tone: 'success', text: 'Resolved', icon: 'checkCircle' },
  closed: { tone: 'neutral', text: 'Closed', icon: 'lock' },
};

export function PriorityPill({ p }: { p: CasePriority }) {
  const x = PRIORITY_PILL[p];
  return <Pill tone={x.tone} icon={p === 'urgent' ? 'alert' : p === 'high' ? 'warning' : 'flag'}>{x.text}</Pill>;
}
export function StatusPill({ s }: { s: CaseStatus }) {
  const x = STATUS_PILL[s];
  return <Pill tone={x.tone} icon={x.icon}>{x.text}</Pill>;
}

export const actorName = (a: Actor) => ('name' in a ? a.name : 'System');
export const actorRole = (a: Actor) => (a.kind === 'staff' ? 'Staff' : a.kind === 'system' ? 'Automated' : a.kind === 'provider' ? 'Provider' : label(a.kind));

/** A wider record drawer for case work (the shared Drawer is sized for record panels). */
export function WideDrawer({ title, sub, onClose, children, footer }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    // Escape closes this drawer only when no dialog or shared record panel is open on top of it.
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.dialog') && document.querySelectorAll('.drawer').length < 2 && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" style={{ width: 'min(920px, 100vw)' }} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Case'}>
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{title}</h2>
            {sub ? <div className="muted small">{sub}</div> : null}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}

/** A titled block inside a case view. */
export function Block({ title, icon, actions, children }: { title: string; icon?: Parameters<typeof Icon>[0]['name']; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="stack">
      <div className="row">
        {icon ? <Icon name={icon} size={16} /> : null}
        <h3 className="strong" style={{ fontSize: 14 }}>{title}</h3>
        {actions ? <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function MessageList({ messages, empty }: { messages: CaseRecord['messages']; empty: string }) {
  if (!messages.length) return <div className="muted small">{empty}</div>;
  return (
    <div className="stack">
      {messages.map((m) => (
        <div key={m.id} className="card" style={{ padding: 12, boxShadow: 'none', background: m.author.kind === 'staff' ? 'var(--surface)' : 'var(--muted)' }}>
          <div className="row small" style={{ marginBottom: 4 }}>
            <span className="strong">{actorName(m.author)}</span>
            <span className="muted">{actorRole(m.author)}</span>
            <span className="muted" style={{ marginLeft: 'auto' }}>
              {new Date(m.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' })}
            </span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Two separate streams: the customer conversation (visible to the passenger or driver) and internal
 * notes (never visible to them). The composer makes the destination explicit.
 */
export function MessageStreams({ c, canWrite, writeReason, onSend }: { c: CaseRecord; canWrite: boolean; writeReason?: string; onSend: (channel: 'customer' | 'internal', body: string) => Promise<boolean> }) {
  const customer = c.messages.filter((m) => m.channel === 'customer');
  const internal = c.messages.filter((m) => m.channel === 'internal');
  const [channel, setChannel] = useState<'customer' | 'internal'>('internal');
  const [body, setBody] = useState('');
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Block title={`Customer conversation (${customer.length})`} icon="chat">
          <div className="muted small">Visible to the passenger or driver.</div>
          <MessageList messages={customer} empty="No messages with the customer yet." />
        </Block>
        <Block title={`Internal notes (${internal.length})`} icon="lock">
          <div className="muted small">Staff only. Never shown to the passenger or driver.</div>
          <MessageList messages={internal} empty="No internal notes yet." />
        </Block>
      </div>
      {canWrite ? (
        <div className="card stack" style={{ boxShadow: 'none' }}>
          <div className="row wrap">
            <Segmented
              label="Message destination"
              value={channel}
              onChange={setChannel}
              options={[
                { value: 'customer', label: 'Reply to customer' },
                { value: 'internal', label: 'Internal note' },
              ]}
            />
            <span className="small muted row" style={{ gap: 4 }}>
              <Icon name={channel === 'customer' ? 'eye' : 'lock'} size={14} />
              {channel === 'customer' ? 'The customer will see this in the app (simulated, nothing is sent).' : 'Only staff will see this.'}
            </span>
          </div>
          <Field label={channel === 'customer' ? 'Reply' : 'Note'}>
            {(id) => <textarea id={id} className="textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder={channel === 'customer' ? 'Write to the customer' : 'Write a note for the team'} />}
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button
              variant="primary"
              icon={channel === 'customer' ? 'chat' : 'edit'}
              disabledReason={!body.trim() ? 'Write something first' : undefined}
              onClick={async () => {
                if (await onSend(channel, body)) setBody('');
              }}
            >
              {channel === 'customer' ? 'Send reply' : 'Add note'}
            </Button>
          </div>
        </div>
      ) : writeReason ? (
        <div className="muted small row" style={{ gap: 6 }}>
          <Icon name="lock" size={14} /> {writeReason}
        </div>
      ) : null}
    </div>
  );
}

export function ActionTimeline({ c }: { c: CaseRecord }) {
  if (!c.actions.length) return <Empty icon="history" title="No actions yet">Assigning, escalating and resolving are recorded here.</Empty>;
  const items = c.actions
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((a) => ({ at: a.at, title: a.label, sub: actorName(a.by) }));
  return <Timeline items={items} />;
}

/** Dialog with custom content (the shared ConfirmDialog only takes a reason). */
export function FormDialog({ title, body, children, confirmLabel, danger, blockReason, onConfirm, onCancel }: { title: string; body?: ReactNode; children?: ReactNode; confirmLabel: string; danger?: boolean; blockReason?: string; onConfirm: () => Promise<unknown> | void; onCancel: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <>
      <div className="scrim" style={{ zIndex: 41 }} onClick={onCancel} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <h2>{title}</h2>
        {body ? <div className="muted">{body}</div> : null}
        {children}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabledReason={blockReason} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
