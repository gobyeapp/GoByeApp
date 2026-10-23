import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Every date and time in the platform is shown in Nigerian time. */
export const LAGOS = 'Africa/Lagos';

/* Shared building blocks for every workspace. Keep screens on these so the platform stays consistent. */

export function PageHead({ title, sub, actions, eyebrow, meta }: { title: string; sub?: string; actions?: ReactNode; eyebrow?: string; meta?: ReactNode }) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
        {meta ? <div className="meta">{meta}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, actions, children, desc }: { title: string; actions?: ReactNode; children: ReactNode; desc?: ReactNode }) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {actions ? <div className="actions">{actions}</div> : null}
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, title, flush, muted, className, actions }: { children: ReactNode; title?: ReactNode; flush?: boolean; muted?: boolean; className?: string; actions?: ReactNode }) {
  return (
    <div className={['card', flush && 'flush', muted && 'muted-card', className].filter(Boolean).join(' ')}>
      {title ? (
        <div className="card-head" style={flush ? { padding: '16px 20px 0' } : undefined}>
          <h3>{title}</h3>
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** KPI card. `icon` adds a tinted icon; `onClick` makes the whole card a link to the detail page. */
export function Stat({ label, value, sub, onClick, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; tone?: Tone; icon?: IconName }) {
  const body = (
    <>
      <span className="label">
        {icon ? <span className="kpi-ico"><Icon name={icon} size={16} /></span> : null}
        {label}
        {onClick ? <Icon name="arrowRight" size={16} className="go" /> : null}
      </span>
      <span className="value" style={tone ? { color: `var(--${tone === 'neutral' ? 'text' : tone})` } : undefined}>
        {value}
      </span>
      {sub ? <span className="sub">{sub}</span> : null}
    </>
  );
  return onClick ? (
    <button className={`card stat ${tone ? `tone-${tone}` : ''}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`card stat ${tone ? `tone-${tone}` : ''}`}>{body}</div>
  );
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'brand';
const TONE_ICON: Record<Tone, IconName> = { success: 'checkCircle', warning: 'time', danger: 'alert', neutral: 'info', info: 'info', brand: 'star' };

/** Status pill: always icon + label, so colour is never the only signal. */
export function Pill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: IconName | null }) {
  const name = icon === null ? null : (icon ?? TONE_ICON[tone]);
  return (
    <span className={`pill ${tone}`}>
      {name ? <Icon name={name} size={13} /> : null}
      {children}
    </span>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void | Promise<unknown>;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
  size?: 'sm' | 'md';
  icon?: IconName;
  disabled?: boolean;
  /** Disabled with a reason shown as a tooltip and read by screen readers. */
  disabledReason?: string;
  type?: 'button' | 'submit';
  title?: string;
};

/** Button that shows progress while its async action runs and can't be pressed twice meanwhile. */
export function Button({ children, onClick, variant = 'secondary', size = 'md', icon, disabled, disabledReason, type = 'button', title }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const off = disabled || !!disabledReason || busy;
  return (
    <button
      type={type}
      className={`btn ${variant} ${size === 'sm' ? 'sm' : ''}`}
      disabled={off}
      title={disabledReason ?? title}
      aria-busy={busy || undefined}
      aria-description={disabledReason}
      onClick={async () => {
        if (!onClick || off) return;
        const r = onClick();
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          setBusy(true);
          try {
            await r;
          } finally {
            setBusy(false);
          }
        }
      }}
    >
      {busy ? <span className="spin" aria-hidden /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; icon?: IconName }) {
  const name = icon ?? (tone === 'danger' ? 'alert' : tone === 'warning' ? 'warning' : tone === 'success' ? 'checkCircle' : 'info');
  return (
    <div className={`notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={name} size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children, icon = 'list', action, tone }: { title: string; children?: ReactNode; icon?: IconName; action?: ReactNode; tone?: 'success' | 'danger' }) {
  const t = tone ?? (icon === 'checkCircle' ? 'success' : undefined);
  return (
    <div className={`empty ${t ? `tone-${t}` : ''}`}>
      <div className="empty-ico"><Icon name={icon} size={24} /></div>
      <div className="title">{title}</div>
      {children ? <div>{children}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 5, height = 18 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height, width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty tone-danger" role="alert">
      <div className="empty-ico"><Icon name="alert" size={24} /></div>
      <div className="title">Couldn’t load this</div>
      <div>{message}</div>
      <Button onClick={onRetry} icon="refresh">
        Try again
      </Button>
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: 'right';
  width?: number | string;
  /** Makes the column sortable (click the heading). Return a number or text to compare. */
  sortValue?: (row: T) => number | string;
}

/**
 * Data table: sticky header, optional sorting (columns with `sortValue`) and paging (`pageSize`).
 * Rows with `onRowClick` open with Enter or Space as well as a click.
 */
export function Table<T>({
  rows,
  columns,
  onRowClick,
  rowKey,
  empty,
  pageSize,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
  empty?: ReactNode;
  pageSize?: number;
  caption?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const v = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-NG')) * sort!.dir;
    });
  }, [rows, columns, sort]);
  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const p = Math.min(page, pages - 1);
  const shown = pageSize ? sorted.slice(p * pageSize, (p + 1) * pageSize) : sorted;
  if (!rows.length) return <>{empty ?? <Empty title="Nothing here" />}</>;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          {caption ? <caption className="sr">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.align === 'right' ? 'right' : undefined}
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}
                  >
                    {c.sortValue ? (
                      <button className="sort" onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}>
                        {c.label}
                        <Icon name={active ? (sort!.dir === 1 ? 'up' : 'down') : 'down'} size={14} style={active ? undefined : { opacity: 0.35 }} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={rowKey(r)}
                className={onRowClick ? 'clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'right' : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize && rows.length > pageSize ? (
        <div className="table-foot">
          <span className="num">
            {p * pageSize + 1}–{Math.min(rows.length, (p + 1) * pageSize)} of {rows.length.toLocaleString('en-NG')}
          </span>
          <span className="pager">
            <Button size="sm" variant="ghost" icon="left" disabledReason={p === 0 ? 'First page' : undefined} onClick={() => setPage(p - 1)}>
              Previous
            </Button>
            <span className="num">
              Page {p + 1} of {pages}
            </span>
            <Button size="sm" variant="ghost" disabledReason={p >= pages - 1 ? 'Last page' : undefined} onClick={() => setPage(p + 1)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </>
  );
}

/** Search, filters and the result count in one row above a list. */
export function FilterBar({ children, count, end }: { children: ReactNode; count?: ReactNode; end?: ReactNode }) {
  return (
    <div className="filter-bar" role="search">
      {children}
      {count !== undefined ? <span className="count-text" aria-live="polite">{count}</span> : null}
      {end ? <div className="end">{end}</div> : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <span className="sr">{placeholder}</span>
      <Icon name="search" size={16} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />
    </label>
  );
}

export function Select<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; label: string }) {
  return (
    <label>
      <span className="sr">{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as V)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<V extends string>({ value, onChange, tabs }: { value: V; onChange: (v: V) => void; tabs: { value: V; label: string; count?: number }[] }) {
  return (
    <div
      className="tabs"
      role="tablist"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = tabs.findIndex((t) => t.value === value);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
        onChange(next.value);
        requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
      }}
    >
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined ? <span className="tab-count"> {t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? 'Not set'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ items }: { items: { at: number; title: ReactNode; sub?: ReactNode }[] }) {
  return (
    <ol className="timeline">
      {items.map((it, i) => (
        <li key={i}>
          <div className="strong">{it.title}</div>
          <div className="when">
            {new Date(it.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: LAGOS })}
            {it.sub ? <> · {it.sub}</> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Side panel for record details: Escape closes, focus moves into it. */
export function Drawer({ title, onClose, children, footer, sub }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      // Keep Tab inside the panel while it is open.
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={ref} tabIndex={-1} style={{ outline: 'none' }} className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}>
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

/** Confirmation for consequential actions. `requireReason` makes the reason mandatory (audit). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  requireReason,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<unknown> | void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {body ? <div className="muted">{body}</div> : null}
        {requireReason ? (
          <Field label="Reason" hint="Saved to the audit trail.">
            {(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
          </Field>
        ) : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabledReason={requireReason && !reason.trim() ? 'Add a reason first' : undefined} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}

export function Bars({ values, highlight, label }: { values: number[]; highlight?: number; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars" role="img" aria-label={label}>
      {values.map((v, i) => (
        <div key={i} className={`bar ${i === highlight ? 'alt' : ''}`} style={{ height: `${(v / max) * 100}%` }} title={String(v)} />
      ))}
    </div>
  );
}

export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}
