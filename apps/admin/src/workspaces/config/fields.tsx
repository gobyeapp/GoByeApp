import { useState, type ReactNode } from 'react';
import { Icon } from '@/ui/Icon';
import { Button, Field } from '@/ui/kit';

/**
 * Small form controls shared by the configuration and growth workspaces (kept local: the shared kit
 * has no number, checkbox or chip inputs yet).
 */

export function NumberField({ label, value, onChange, hint, prefix, suffix, min = 0, max, step = 1, error }: { label: string; value: number; onChange: (v: number) => void; hint?: string; prefix?: string; suffix?: string; min?: number; max?: number; step?: number; error?: string }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <div className="row" style={{ gap: 6 }}>
          {prefix ? <span className="muted">{prefix}</span> : null}
          <input
            id={id}
            className="input num"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(value) ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
            style={{ width: 140 }}
          />
          {suffix ? <span className="muted small">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}

export function TextField({ label, value, onChange, hint, max, error, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; hint?: string; max?: number; error?: string; placeholder?: string; multiline?: boolean }) {
  const counter = max !== undefined ? `${value.length} of ${max}` : undefined;
  const over = max !== undefined && value.length > max;
  return (
    <Field label={label} hint={[hint, counter].filter(Boolean).join(' · ') || undefined} error={error ?? (over ? `Too long: ${value.length} of ${max} characters` : undefined)}>
      {(id) =>
        multiline ? (
          <textarea id={id} className="textarea" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input id={id} className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="row" style={{ gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, alignItems: 'flex-start' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--primary)' }} />
      <span>{children}</span>
    </label>
  );
}

/** Editable list of short names (zones, pickup points). */
export function ChipsInput({ label, values, onChange, placeholder, readOnly }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; readOnly?: boolean }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t) return;
    if (values.some((v) => v.toLowerCase() === t.toLowerCase())) return setText('');
    onChange([...values, t]);
    setText('');
  };
  return (
    <div className="field">
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      <div className="row wrap" style={{ gap: 6 }}>
        {values.length === 0 ? <span className="muted small">None yet</span> : null}
        {values.map((v) => (
          <span key={v} className="pill neutral" style={{ color: 'var(--text)', paddingRight: readOnly ? 9 : 4 }}>
            {v}
            {readOnly ? null : (
              <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-grid', padding: 2, color: 'inherit' }}>
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {readOnly ? null : (
        <div className="row" style={{ gap: 6 }}>
          <input className="input" value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} style={{ flex: 1 }} />
          <Button size="sm" icon="add" onClick={add} disabledReason={text.trim() ? undefined : 'Type a name first'}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

/** Up/down reorder buttons (the icon set has no "up" glyph, so "down" is rotated). */
export function MoveButtons({ name, onUp, onDown, upDisabled, downDisabled }: { name: string; onUp: () => void; onDown: () => void; upDisabled?: boolean; downDisabled?: boolean }) {
  const style = { width: 30, height: 30 } as const;
  return (
    <span className="row" style={{ gap: 2 }}>
      <button className="icon-btn" style={style} aria-label={`Move ${name} up`} title="Move up" disabled={upDisabled} onClick={(e) => (e.stopPropagation(), onUp())}>
        <Icon name="down" size={16} style={{ transform: 'rotate(180deg)', opacity: upDisabled ? 0.3 : 1 }} />
      </button>
      <button className="icon-btn" style={style} aria-label={`Move ${name} down`} title="Move down" disabled={downDisabled} onClick={(e) => (e.stopPropagation(), onDown())}>
        <Icon name="down" size={16} style={{ opacity: downDisabled ? 0.3 : 1 }} />
      </button>
    </span>
  );
}

/** Ordered process steps with the current one highlighted (icon + label, not colour alone). */
export function Steps({ steps, current, failedAt }: { steps: string[]; current: number; failedAt?: number }) {
  return (
    <ol className="row wrap" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }} aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < current;
        const here = i === current;
        const failed = failedAt === i;
        return (
          <li key={s} className="row" style={{ gap: 6 }} aria-current={here ? 'step' : undefined}>
            <span className={`pill ${failed ? 'danger' : done ? 'success' : here ? 'info' : 'neutral'}`}>
              <Icon name={failed ? 'alert' : done ? 'check' : here ? 'time' : 'more'} size={13} />
              {s}
            </span>
            {i < steps.length - 1 ? <Icon name="right" size={14} style={{ color: 'var(--text-2)' }} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
