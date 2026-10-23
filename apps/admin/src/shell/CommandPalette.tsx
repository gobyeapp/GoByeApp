import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CITY_LABELS } from '@gobye/core';
import { useOpenRecord } from '@/data/records';
import { useSession } from '@/data/session';
import { useData } from '@/data/store';
import { ALL_ITEMS, groupOf } from '@/nav';
import { Icon, type IconName } from '@/ui/Icon';

/**
 * Ctrl/Cmd + K: jump to any page the role can open, or find a record already loaded in the dashboard
 * (drivers, passengers, trips, cases). Search runs over the loaded test data in the browser; a
 * server-side search across all records needs the backend (ADMIN_DASHBOARD_REDESIGN §7).
 */
interface Hit {
  id: string;
  group: 'Pages' | 'Drivers' | 'Passengers' | 'Trips' | 'Cases';
  title: string;
  sub: string;
  icon: IconName;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} #]/gu, '');

export function matchScore(query: string, ...fields: (string | undefined)[]): number {
  const q = norm(query).trim();
  if (!q) return 0;
  const words = q.split(/\s+/);
  let score = 0;
  const hay = fields.map((f) => norm(f ?? ''));
  for (const w of words) {
    const best = Math.max(...hay.map((h, i) => (h.startsWith(w) ? 3 : h.includes(` ${w}`) ? 2 : h.includes(w) ? 1 : 0) * (i === 0 ? 2 : 1)));
    if (!best) return 0;
    score += best;
  }
  return score;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const d = useData();
  const { can, inScope } = useSession();
  const navigate = useNavigate();
  const openRecord = useOpenRecord();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    restore.current = document.activeElement;
    input.current?.focus();
    return () => (restore.current as HTMLElement | null)?.focus?.();
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const go = (path: string) => () => {
      onClose();
      navigate(path);
    };
    const rec = (type: 'driver' | 'passenger' | 'trip', id: string) => () => {
      onClose();
      openRecord({ type, id });
    };
    const pages = ALL_ITEMS.filter((i) => i.anyOf.some((p) => can(p)));
    if (!q.trim()) {
      return pages.slice(0, 8).map((i) => ({ id: i.path, group: 'Pages' as const, title: i.label, sub: groupOf(i.path)?.title || 'Home', icon: i.icon, run: go(i.path) }));
    }
    const scored: (Hit & { s: number })[] = [];
    for (const i of pages) {
      const s = matchScore(q, i.label, groupOf(i.path)?.title, i.keywords);
      if (s) scored.push({ s: s + 4, id: i.path, group: 'Pages', title: i.label, sub: groupOf(i.path)?.title || 'Home', icon: i.icon, run: go(i.path) });
    }
    if (can('drivers.view'))
      for (const x of d.drivers) {
        if (!inScope(x.city)) continue;
        const s = matchScore(q, x.name, x.id, x.vehicle.plate);
        if (s) scored.push({ s, id: x.id, group: 'Drivers', title: x.name, sub: `${x.vehicle.plate} · ${CITY_LABELS[x.city]}`, icon: 'steering', run: rec('driver', x.id) });
      }
    if (can('passengers.view'))
      for (const x of d.passengers) {
        if (!inScope(x.city)) continue;
        const s = matchScore(q, x.name, x.id);
        if (s) scored.push({ s, id: x.id, group: 'Passengers', title: x.name, sub: `${x.id} · ${CITY_LABELS[x.city]}`, icon: 'user', run: rec('passenger', x.id) });
      }
    if (can('trips.view'))
      for (const x of d.trips) {
        if (!inScope(x.city)) continue;
        const s = matchScore(q, x.ref, x.id, `${x.pickup} ${x.destination}`);
        if (s) scored.push({ s, id: x.id, group: 'Trips', title: x.ref, sub: `${x.pickup} → ${x.destination}`, icon: 'route', run: rec('trip', x.id) });
      }
    for (const x of d.cases) {
      const page = x.team === 'safety' ? '/safety' : '/cases';
      if (!inScope(x.city) || !can(x.team === 'safety' ? 'safety.view' : 'cases.view')) continue;
      const s = matchScore(q, x.ref, x.subject, x.id);
      if (s) scored.push({ s, id: x.id, group: 'Cases', title: `${x.ref} · ${x.subject}`, sub: x.team === 'safety' ? 'Safety case' : 'Support case', icon: x.team === 'safety' ? 'safeAlert' : 'headphone', run: go(`${page}?open=${encodeURIComponent(x.id)}`) });
    }
    const order = ['Pages', 'Drivers', 'Passengers', 'Trips', 'Cases'];
    // Best matches first within each group; at most 5 per record group so pages stay visible.
    const out: Hit[] = [];
    for (const g of order) out.push(...scored.filter((h) => h.group === g).sort((a, b) => b.s - a.s).slice(0, g === 'Pages' ? 6 : 5));
    return out;
  }, [q, d, can, inScope, navigate, openRecord, onClose]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(hits.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      hits[sel]?.run();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // focus stays in the dialog
    }
  };

  let last = '';
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search pages and records" onKeyDown={onKey}>
        <div className="cmdk-input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, drivers, passengers, trips, cases"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={hits[sel] ? `cmdk-${sel}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef} aria-label="Results">
          {hits.length ? (
            hits.map((h, i) => {
              const head = h.group !== last ? ((last = h.group), <div key={`g-${h.group}`} className="cmdk-group" role="presentation">{q.trim() || h.group !== 'Pages' ? h.group : 'Go to'}</div>) : null;
              return [
                head,
                <button key={`${h.group}-${h.id}`} id={`cmdk-${i}`} className="cmdk-item" role="option" aria-selected={i === sel} tabIndex={-1} onMouseMove={() => setSel(i)} onClick={h.run}>
                  <span className="ico"><Icon name={h.icon} size={16} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="strong" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                    <span className="cell-sub">{h.sub}</span>
                  </span>
                  {i === sel ? <Icon name="enter" size={16} /> : null}
                </button>,
              ];
            })
          ) : (
            <div className="empty" style={{ padding: 28 }}>
              <div className="title">No matches</div>
              <div>Search covers pages you can open and the records loaded in this dashboard.</div>
            </div>
          )}
        </div>
        <div className="cmdk-foot" aria-hidden>
          <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move</span>
          <span><kbd className="kbd">Enter</kbd> open</span>
          <span>Test data · searched in this browser</span>
        </div>
      </div>
    </>
  );
}
