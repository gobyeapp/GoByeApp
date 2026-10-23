import { useEffect, useRef, useState } from 'react';
import { LAGOS } from '@/ui/kit';
import type { DayPoint } from './insights';

/**
 * Ride activity chart: calm hand-built SVG on white. Two views:
 *  - volume: ride requests (light) beside completed rides (jade) per day,
 *  - mode: requests split into Quick Match (jade) and Negotiated (soft jade), stacked.
 * Hover or focus a day for exact figures. A hidden table gives screen readers every value.
 */
export type ChartView = 'volume' | 'mode';

const H = 220;

/** Draw at the real pixel width so axis text stays 11px on every screen. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
const PAD = { l: 34, r: 8, t: 10, b: 26 };
const day = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString('en-NG', { ...opts, timeZone: LAGOS });

function niceMax(v: number) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

export function RideChart({ points, view }: { points: DayPoint[]; view: ChartView }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth(720);
  const series = view === 'volume' ? [{ key: 'requested', label: 'Ride requests', color: '#bfe0d2' }, { key: 'completed', label: 'Completed rides', color: 'var(--jade)' }] : [{ key: 'quickMatch', label: 'Quick Match', color: 'var(--jade)' }, { key: 'negotiated', label: 'Negotiated', color: '#8cc9b2' }];
  const val = (p: DayPoint, k: string) => p[k as keyof DayPoint] as number;
  const peak = view === 'volume' ? Math.max(...points.map((p) => Math.max(p.requested, p.completed))) : Math.max(...points.map((p) => p.quickMatch + p.negotiated));
  const max = niceMax(peak);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / points.length;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const fit = Math.max(1, Math.floor(iw / 64));
  const labelEvery = Math.max(1, Math.ceil(points.length / fit));
  const h = hover === null ? null : points[hover];

  return (
    <div className="ride-chart">
      <div className="legend" aria-hidden>
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
        <span className="muted">Lagos days</span>
      </div>
      <div className="rc-plot" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${series.map((s) => s.label).join(' and ')} per day, ${points.length} days`} width={W} height={H}>
          {ticks.map((tk, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(tk)} y2={y(tk)} stroke={i === 0 ? '#d6dbd9' : '#eef1ef'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={PAD.l - 8} y={y(tk) + 4} textAnchor="end" className="rc-axis">{tk}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const x0 = PAD.l + i * slot;
            const inner = Math.min(slot * 0.62, 26);
            const left = x0 + (slot - inner) / 2;
            const active = hover === i;
            if (view === 'volume') {
              const bw = inner / 2 - 1;
              return (
                <g key={p.day} opacity={hover === null || active ? 1 : 0.45}>
                  <rect x={left} y={y(p.requested)} width={bw} height={Math.max(0, PAD.t + ih - y(p.requested))} rx={2} fill={series[0]!.color} />
                  <rect x={left + bw + 2} y={y(p.completed)} width={bw} height={Math.max(0, PAD.t + ih - y(p.completed))} rx={2} fill={series[1]!.color} />
                </g>
              );
            }
            const a = val(p, 'quickMatch');
            const b = val(p, 'negotiated');
            return (
              <g key={p.day} opacity={hover === null || active ? 1 : 0.45}>
                <rect x={left} y={y(a)} width={inner} height={Math.max(0, PAD.t + ih - y(a))} rx={2} fill={series[0]!.color} />
                <rect x={left} y={y(a + b)} width={inner} height={Math.max(0, y(a) - y(a + b))} rx={2} fill={series[1]!.color} />
              </g>
            );
          })}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text key={`l${p.day}`} x={PAD.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="rc-axis">
                {i === points.length - 1 ? 'Today' : day(p.day + 3_600_000, { day: 'numeric', month: 'short' })}
              </text>
            ) : null,
          )}
          {points.map((p, i) => (
            <rect
              key={`h${p.day}`}
              x={PAD.l + i * slot}
              y={PAD.t}
              width={slot}
              height={ih}
              fill="transparent"
              tabIndex={0}
              aria-label={`${day(p.day + 3_600_000, { weekday: 'short', day: 'numeric', month: 'short' })}: ${series.map((s) => `${val(p, s.key)} ${s.label.toLowerCase()}`).join(', ')}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              style={{ outline: 'none', cursor: 'default' }}
            />
          ))}
        </svg>
        {h ? (
          <div className="rc-tip" style={{ left: `${((PAD.l + (hover! + 0.5) * slot) / W) * 100}%` }} aria-hidden>
            <div className="strong">{hover === points.length - 1 ? 'Today' : day(h.day + 3_600_000, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
            {series.map((s) => (
              <div key={s.key} className="row" style={{ gap: 6 }}>
                <i style={{ background: s.color }} />
                <span>{s.label}</span>
                <span className="num strong" style={{ marginLeft: 'auto' }}>{val(h, s.key)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <table className="sr">
        <caption>Rides per day</caption>
        <thead><tr><th>Day</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}><td>{day(p.day + 3_600_000, { day: 'numeric', month: 'short' })}</td>{series.map((s) => <td key={s.key}>{val(p, s.key)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
