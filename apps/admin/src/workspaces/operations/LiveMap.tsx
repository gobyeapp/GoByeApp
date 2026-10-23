import { CITY_LABELS, type CityId, type DriverRecord, type TripRecord } from '@gobye/core';
import { Pill } from '@/ui/kit';

/**
 * Honest schematic in place of a map: no map provider is chosen (D-025 proposed), so positions are
 * SIMULATED, placed deterministically from place names on a neutral grid. Markers stay light and
 * readable; nothing here is a real location.
 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
export const spot = (key: string) => ({ x: 0.1 + hash(`${key}:x`) * 0.8, y: 0.2 + hash(`${key}:y`) * 0.7 });

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const progress: Partial<Record<TripRecord['status'], number>> = { matched: 0, en_route: 0, arrived: 0, in_progress: 0.5, payment_pending: 1 };

export function LiveMap({ city, rides, drivers, selected, onSelect }: { city: CityId; rides: TripRecord[]; drivers: DriverRecord[]; selected?: string; onSelect: (id: string) => void }) {
  const W = 1000;
  const H = 640;
  const P = (p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H });
  return (
    <div className="map-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Simulated positions of ${rides.length} active rides and ${drivers.length} available drivers in ${CITY_LABELS[city]}`}>
        <defs>
          <pattern id="mapgrid" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M 64 0 L 0 0 0 64" fill="none" stroke="#eef1ef" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="#fff" />
        <rect width={W} height={H} fill="url(#mapgrid)" />
        {/* Faint "arterial roads" for orientation only. */}
        <path d={`M 0 ${H * 0.62} C ${W * 0.3} ${H * 0.52}, ${W * 0.6} ${H * 0.74}, ${W} ${H * 0.58}`} stroke="#e3e7e5" strokeWidth="16" fill="none" strokeLinecap="round" />
        <path d={`M ${W * 0.38} 0 C ${W * 0.44} ${H * 0.4}, ${W * 0.32} ${H * 0.7}, ${W * 0.4} ${H}`} stroke="#e3e7e5" strokeWidth="12" fill="none" strokeLinecap="round" />
        {drivers.map((dr) => {
          const p = P(spot(dr.id));
          return <circle key={dr.id} cx={p.x} cy={p.y} r={10} fill="#fff" stroke="#8a938e" strokeWidth={4} />;
        })}
        {rides.map((r) => {
          const a = P(spot(r.pickup));
          const b = P(spot(r.destination));
          const sel = r.id === selected;
          const f = progress[r.status] ?? 0;
          const car = { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
          const searching = r.status === 'searching';
          return (
            <g key={r.id} onClick={() => onSelect(r.id)} style={{ cursor: 'pointer' }} opacity={selected && !sel ? 0.45 : 1}>
              {!searching ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel ? 'var(--jade)' : '#b9c4bf'} strokeWidth={sel ? 7 : 3.5} strokeDasharray={sel ? undefined : '10 10'} strokeLinecap="round" /> : null}
              <circle cx={a.x} cy={a.y} r={sel ? 16 : 12} fill="#fff" stroke={searching ? 'var(--warning)' : 'var(--ink)'} strokeWidth={5} />
              {!searching ? <circle cx={car.x} cy={car.y} r={sel ? 16 : 12} fill="var(--jade)" stroke="#fff" strokeWidth={5} /> : null}
              {sel ? (
                <>
                  <text x={a.x + 24} y={a.y - 16} className="map-label">{r.pickup}</text>
                  <rect x={b.x - 11} y={b.y - 11} width={22} height={22} rx={5} fill="var(--ink)" />
                  <text x={b.x + 24} y={b.y + 8} className="map-label">{r.destination}</text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div style={{ position: 'absolute', left: 14, top: 12 }}>
        <Pill tone="neutral" icon="info">Simulated positions · map provider not chosen</Pill>
      </div>
    </div>
  );
}
