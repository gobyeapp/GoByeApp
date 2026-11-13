import { useState, type ReactNode } from 'react';

/**
 * Small hand-built SVG charts (D-069): no chart library. Colours come from the theme tokens
 * (--chart, --chart-2, --chart-3, --chart-alt, --chart-grid), so every chart follows light and dark.
 * Each chart carries an accessible label and, where it has several values, a hidden table.
 */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Donut with a figure in the middle and a legend beside it. */
export function Donut({ slices, center, sub, label, size = 148 }: { slices: Slice[]; center: ReactNode; sub?: ReactNode; label: string; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <figure className="donut" style={{ width: size, height: size }} aria-label={label} role="img">
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--track)" strokeWidth="11" />
          {total > 0
            ? slices.map((s) => {
                const len = (s.value / total) * c;
                const el = <circle key={s.label} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="11" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />;
                offset += len;
                return el;
              })
            : null}
        </svg>
        <figcaption className="donut-center">
          <span className="donut-value">{center}</span>
          {sub ? <span className="donut-sub">{sub}</span> : null}
        </figcaption>
      </figure>
      <ul className="legend vertical">
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} aria-hidden />
            <span>{s.label}</span>
            <b className="num">{s.value.toLocaleString('en-NG')}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One value out of a whole, as a ring (for example money left out of money paid in). */
export function Ring({ value, label, center, sub, size = 112, tone = 'var(--chart)' }: { value: number; label: string; center: ReactNode; sub?: ReactNode; size?: number; tone?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <figure className="donut" style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--track)" strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 50 50)" />
      </svg>
      <figcaption className="donut-center">
        <span className="donut-value">{center}</span>
        {sub ? <span className="donut-sub">{sub}</span> : null}
      </figcaption>
    </figure>
  );
}

export interface Series {
  label: string;
  color: string;
  values: number[];
  /** Draw as a dashed line over the bars instead of bars (for example a target). */
  line?: boolean;
}

/** Grouped vertical bars with optional line series, x labels and hover values. */
export function BarChart({ labels, series, label, height = 200, format = (n: number) => n.toLocaleString('en-NG') }: { labels: string[]; series: Series[]; label: string; height?: number; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...series.flatMap((s) => s.values)) * 1.1;
  const bars = series.filter((s) => !s.line);
  const lines = series.filter((s) => s.line);
  const slot = (W - pad.l - pad.r) / Math.max(1, labels.length);
  const bw = Math.min(28, (slot * 0.7) / Math.max(1, bars.length));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const x0 = (i: number) => pad.l + slot * i + slot / 2;
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={label}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--chart-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {labels.map((_, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t - pad.b} fill={hover === i ? 'var(--hover)' : 'transparent'} />
            {bars.map((s, k) => {
              const v = s.values[i] ?? 0;
              const x = x0(i) - (bw * bars.length) / 2 + k * bw;
              return <rect key={s.label} x={x + 1} y={y(v)} width={Math.max(2, bw - 2)} height={Math.max(0, y(0) - y(v))} rx={2} fill={s.color} />;
            })}
          </g>
        ))}
        {lines.map((s) => (
          <polyline key={s.label} points={s.values.map((v, i) => `${x0(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="chart-x" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }} aria-hidden>
        {labels.map((l, i) => (
          <span key={i} className={hover === i ? 'on' : ''}>{l}</span>
        ))}
      </div>
      {hover !== null ? (
        <div className="chart-tip" style={{ left: `${((hover + 0.5) / labels.length) * 100}%` }}>
          <b>{labels[hover]}</b>
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} /> {s.label}: <b className="num">{format(s.values[hover] ?? 0)}</b>
            </span>
          ))}
        </div>
      ) : null}
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.line }))} />
      <table className="sr">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Period</th>
            {series.map((s) => <th key={s.label}>{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={i}>
              <td>{l}</td>
              {series.map((s) => <td key={s.label}>{format(s.values[i] ?? 0)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A small trend line for a KPI tile. */
export function Sparkline({ values, label, color = 'var(--chart)' }: { values: number[]; label: string; color?: string }) {
  const W = 120;
  const H = 32;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * W},${H - 2 - (v / max) * (H - 4)}`);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} preserveAspectRatio="none">
      <polyline points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="var(--primary-soft)" stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Horizontal bars for a ranked list (for example uses per check type). */
export function HBars({ items, label, format = (n: number) => n.toLocaleString('en-NG') }: { items: { label: string; value: number; color?: string }[]; label: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="hbars" aria-label={label}>
      {items.map((i) => (
        <li key={i.label}>
          <span className="hb-label">{i.label}</span>
          <span className="hb-track">
            <span style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? 'var(--chart)' }} />
          </span>
          <b className="num">{format(i.value)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}>
          <i className={i.dashed ? 'dashed' : ''} style={i.dashed ? { borderColor: i.color } : { background: i.color }} aria-hidden />
          <span>{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Compact KPI tile: label, figure, small change line and an optional sparkline. */
export function Kpi({ label, value, foot, spark, onClick }: { label: string; value: ReactNode; foot?: ReactNode; spark?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`kpi ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-row">
        <span className="kpi-value num">{value}</span>
        {spark}
      </span>
      {foot ? <span className="kpi-foot">{foot}</span> : null}
    </Tag>
  );
}
