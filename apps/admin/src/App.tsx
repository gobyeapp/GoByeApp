import { Suspense, useCallback, useEffect, useState } from 'react';
import { HashRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CITY_LABELS, ROLE_LABELS, type CityId } from '@gobye/core';
import { initials } from '@/data/format';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF, useFilters, useSession, type RangeKey } from '@/data/session';
import { PlatformProvider, ToastProvider, usePlatform } from '@/data/store';
import { ALL_ITEMS, NAV, ROLE_HOME, groupOf } from '@/nav';
import { attentionNotes } from '@/shell/attention';
import { CommandPalette } from '@/shell/CommandPalette';
import { Popover } from '@/shell/Popover';
import { Icon } from '@/ui/Icon';
import { Dimensional } from '@/ui/Dimensional';
import { Empty, ErrorState, IconButton, Notice, Select, Skeleton } from '@/ui/kit';

/** The dashboard is white only (owner rule 2026-10-23): no dark theme. Clears any choice saved by older builds. */
function useLightOnly() {
  useEffect(() => {
    document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.removeItem('gobye.admin.theme');
    } catch {
      /* storage unavailable */
    }
  }, []);
}

export default function App() {
  return (
    <SessionProvider>
      <Root />
    </SessionProvider>
  );
}

/**
 * The test data lives above sign in, so switching staff in the same tab keeps every change: care can
 * request a refund, sign out, and finance (a different person) approves it. Reloading the page or
 * "Reset test data" starts again.
 */
function Root() {
  const { staff, actor } = useSession();
  return (
    <PlatformProvider actor={actor}>
      <ToastProvider>
        {!staff ? (
          <SignIn />
        ) : (
          <FilterProvider>
            <HashRouter>
              <RecordProvider>
                <Shell />
              </RecordProvider>
            </HashRouter>
          </FilterProvider>
        )}
      </ToastProvider>
    </PlatformProvider>
  );
}

function SignIn() {
  const { signIn } = useSession();
  return (
    <main className="signin">
      <section className="signin-brand" aria-label="GoBye Management">
        <div className="brand">
          <div className="brand-mark">GB</div>
          <div>
            <div className="brand-name">GoBye</div>
            <div className="brand-sub">Management</div>
          </div>
        </div>
        <div>
          <h1>Run rides, drivers, care and money from one place.</h1>
          <p>Each staff role sees its own workspace and only the actions it is allowed to take.</p>
          <div className="signin-art" aria-hidden>
            <Dimensional name="sedan" size={128} />
            <Dimensional name="routePin" size={96} />
            <Dimensional name="wallet" size={104} />
          </div>
        </div>
        <div className="small muted">Lagos · Abuja</div>
      </section>
      <section className="signin-panel" aria-labelledby="signin-title">
        <div>
          <h2 id="signin-title" style={{ fontSize: 20, fontWeight: 700 }}>Staff sign in</h2>
          <p className="muted" style={{ marginTop: 4 }}>Choose a test staff account to open that role’s workspace.</p>
        </div>
        <Notice tone="warning" icon="info">
          Prototype on test data. Sign in is simulated. Changes stay while this tab is open, so you can switch staff to follow a request from one team to another. Real sign in (email with one time code, session limits) comes with the backend.
        </Notice>
        <div className="staff-list" role="list">
          {TEST_STAFF.map((s) => (
            <button key={s.id} className="staff-option" role="listitem" onClick={() => signIn(s.id)} disabled={s.status !== 'active'} style={s.status !== 'active' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              <span className="avatar">{initials(s.name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="strong">{s.name}</span>
                <span className="muted small" style={{ display: 'block' }}>
                  {s.roles.map((r) => ROLE_LABELS[r]).join(' + ')}
                  {s.cities.length ? ` · ${s.cities.map((c) => CITY_LABELS[c as CityId]).join(', ')} only` : ''}
                  {s.status !== 'active' ? ' · Invite not accepted' : ''}
                </span>
              </span>
              <Icon name="right" />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

const COLLAPSE_KEY = 'gobye.admin.sidebar';
function useCollapsed(): [boolean, () => void] {
  const [c, setC] = useState(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      // No saved choice: start as a rail on laptop widths so tables get the room.
      return saved ? saved === 'collapsed' : window.innerWidth < 1200;
    } catch {
      return typeof window !== 'undefined' && window.innerWidth < 1200;
    }
  });
  const toggle = useCallback(() => {
    setC((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? 'open' : 'collapsed');
      } catch {
        /* per-viewer preference only */
      }
      return !v;
    });
  }, []);
  return [c, toggle];
}

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

function Shell() {
  const { staff, can, inScope, signOut } = useSession();
  const { data, loading, error, reload, reset, now, simulateFailures, setSimulateFailures } = usePlatform();
  const { city, setCity, range, setRange } = useFilters();
  useLightOnly();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === 'Escape' && navOpen) setNavOpen(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [navOpen]);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  if (!staff) return null;

  const allowed = ALL_ITEMS.filter((i) => i.anyOf.some((p) => can(p)));
  const home = allowed.find((i) => i.path === ROLE_HOME[staff.roles[0]!])?.path ?? allowed[0]?.path ?? '/overview';
  const cityOptions = [{ value: 'all' as const, label: staff.cities.length ? 'My cities' : 'All cities' }, ...(['lagos', 'abuja'] as CityId[]).filter((c) => !staff.cities.length || staff.cities.includes(c)).map((c) => ({ value: c, label: CITY_LABELS[c] }))];
  const current = ALL_ITEMS.find((i) => i.path === loc.pathname);
  const group = current ? groupOf(current.path) : undefined;
  const siblings = group?.subnav ? group.items.filter((i) => i.anyOf.some((p) => can(p))) : [];
  const notes = data ? attentionNotes(data, now(), can, inScope) : [];
  const scopeText = `${city === 'all' ? (staff.cities.length ? 'My cities' : 'All cities') : CITY_LABELS[city]} · ${RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ''}`;
  const noteTotal = notes.reduce((s, n) => s + n.count, 0);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspaces" onClick={(e) => e.target === e.currentTarget && setNavOpen(false)}>
        <div className="side-head">
          <Link to={home} className="brand" style={{ textDecoration: 'none' }} aria-label="GoBye Management, home">
            <div className="brand-mark" aria-hidden>GB</div>
            <div>
              <div className="brand-name">GoBye</div>
              <div className="brand-sub">Management</div>
            </div>
          </Link>
          <button className="side-toggle collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name={collapsed ? 'sidebarOpen' : 'sidebarClose'} size={18} />
          </button>
          <button className="side-toggle menu-btn" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className="side-scroll" aria-label="Main">
          {NAV.map((g) => {
            const items = g.items.filter((i) => i.anyOf.some((p) => can(p)));
            if (!items.length) return null;
            return (
              <div key={g.title || 'home'} className="nav-group" role="group" aria-label={g.title || 'Home'}>
                {g.title ? <div className="nav-title" aria-hidden>{g.title}</div> : null}
                {items.map((i) => {
                  const n = data && i.badge ? i.badge(data, now(), inScope) : 0;
                  return (
                    <NavLink key={i.path} to={i.path} end title={collapsed ? `${i.label}${n ? ` (${n})` : ''}` : undefined} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      {({ isActive }) => (
                        <>
                          <Icon name={i.icon} filled={isActive} />
                          <span className="label">{i.label}</span>
                          {n ? <span className="count" aria-label={`, ${n} need attention`}>{n}</span> : null}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="row small" style={{ color: 'var(--side-title)', padding: '2px 6px' }} title="Prototype: test data only">
            <Icon name="info" size={16} />
            <span className="label">Test data · simulated</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="proto-banner" role="note">
          <Icon name="info" size={15} /> Prototype · test data and simulated responses only. No real money, people or providers.
        </div>
        <header className="topbar">
          <div className="top-left">
            <span className="menu-btn">
              <IconButton icon="menu" label="Open menu" onClick={() => setNavOpen(true)} />
            </span>
            <nav className="crumbs" aria-label="Breadcrumb">
              <ol>
                <li className="crumb-parent">GoBye</li>
                <li className="crumb-sep" aria-hidden><Icon name="right" size={14} /></li>
                {group?.title ? (
                  <>
                    <li className="crumb-parent">{group.title}</li>
                    <li className="crumb-sep" aria-hidden><Icon name="right" size={14} /></li>
                  </>
                ) : null}
                <li aria-current="page">{current?.label ?? 'Management'}</li>
              </ol>
            </nav>
          </div>
          <div className="top-center">
            <button className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search rides, drivers, riders, payments" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
              <Icon name="search" size={17} />
              <span className="label">Search rides, drivers, riders, payments...</span>
              <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
            </button>
          </div>
          <div className="top-right">
            <span className="search-mobile">
              <IconButton icon="search" label="Search" onClick={() => setPaletteOpen(true)} />
            </span>
            <Popover
              label="Scope"
              trigger={({ open, toggle, id }) => (
                <button className="scope-chip" aria-label={`Showing ${scopeText}. Change city or dates`} aria-expanded={open} aria-controls={id} onClick={toggle}>
                  <span className="dot" aria-hidden />
                  <span className="scope-text">{scopeText}</span>
                  <Icon name="down" size={14} />
                </button>
              )}
            >
              {() => (
                <>
                  <div className="popover-head">
                    <h2>What every page shows</h2>
                  </div>
                  <div className="popover-body">
                    <Select label="City" value={city} onChange={setCity} options={cityOptions} />
                    <Select<RangeKey> label="Date range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
                    <span className="small muted">Applies to lists and figures across the dashboard. Test data.</span>
                  </div>
                </>
              )}
            </Popover>
            <Popover
              label="Notifications"
              className="icon-dot"
              trigger={({ open, toggle, id }) => (
                <button className="icon-btn" aria-label={noteTotal ? `Notifications, ${notes.length} need attention` : 'Notifications'} aria-expanded={open} aria-controls={id} onClick={toggle} title="Notifications">
                  <Icon name="bell" size={19} />
                  {notes.length ? <span className="dot" aria-hidden>{notes.length}</span> : null}
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="popover-head">
                    <h2>Needs attention</h2>
                    <span className="muted small" style={{ marginLeft: 'auto' }}>Your pages and cities</span>
                  </div>
                  <div className="popover-list">
                    {notes.length ? (
                      notes.map((n) => (
                        <button key={n.key} className="pop-item" onClick={() => (close(), navigate(n.path))}>
                          <span className="tone-ico" style={{ color: `var(--${n.tone})` }}><Icon name={n.icon} size={16} /></span>
                          <span className="body">
                            <span className="strong" style={{ display: 'block' }}>{n.text}</span>
                            <span className="cell-sub">{ALL_ITEMS.find((i) => i.path === n.path)?.label}</span>
                          </span>
                          <Icon name="right" size={16} />
                        </button>
                      ))
                    ) : (
                      <Empty title="You’re all caught up" art="completedTrips">Nothing waiting in the pages you can open.</Empty>
                    )}
                  </div>
                  <div className="cmdk-foot">Counts from the loaded test data. Staff alerts by push or email need the backend.</div>
                </>
              )}
            </Popover>
            <Popover
              label="Help"
              trigger={({ open, toggle, id }) => (
                <button className="icon-btn" aria-label="Help" aria-expanded={open} aria-controls={id} onClick={toggle} title="Help">
                  <Icon name="question" size={19} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="popover-head"><h2>Help</h2></div>
                  <div className="popover-body small">
                    <div className="row" style={{ justifyContent: 'space-between' }}><span>Search everything</span><kbd className="kbd">{isMac ? '⌘ K' : 'Ctrl K'}</kbd></div>
                    <div className="row" style={{ justifyContent: 'space-between' }}><span>Close a panel or menu</span><kbd className="kbd">Esc</kbd></div>
                    <div className="row" style={{ justifyContent: 'space-between' }}><span>Move between tabs</span><kbd className="kbd">← →</kbd></div>
                  </div>
                  <div className="menu-section">
                    <button className="menu-item" onClick={() => (close(), setPaletteOpen(true))}><Icon name="search" size={16} /> Find a page</button>
                  </div>
                  <div className="cmdk-foot">This is a prototype on test data. Nothing here moves real money or contacts real people.</div>
                </>
              )}
            </Popover>
            <Popover
              label="Account"
              trigger={({ open, toggle, id }) => (
                <button className="who" aria-label={`Account: ${staff.name}`} aria-expanded={open} aria-controls={id} onClick={toggle}>
                  <span className="avatar">{initials(staff.name)}</span>
                  <span className="who-text">
                    <span className="strong small">{staff.name}</span>
                    <span className="muted small">{staff.roles.map((r) => ROLE_LABELS[r]).join(' + ')}</span>
                  </span>
                  <Icon name="down" size={16} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="popover-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span className="strong">{staff.name}</span>
                    <span className="muted small">{staff.email}</span>
                    <span className="muted small">
                      {staff.roles.map((r) => ROLE_LABELS[r]).join(' + ')} · {staff.cities.length ? staff.cities.map((c) => CITY_LABELS[c as CityId]).join(', ') : 'All cities'}
                    </span>
                  </div>
                  <div className="menu-section">
                    <div className="cmdk-group" style={{ padding: '6px 10px 2px' }}>Prototype tools</div>
                    <label className="menu-item" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={simulateFailures} onChange={(e) => setSimulateFailures(e.target.checked)} />
                      Simulate server failures
                    </label>
                    <button className="menu-item" onClick={() => (close(), reset())}>
                      <Icon name="refresh" size={16} /> Reset test data
                    </button>
                  </div>
                  <div className="menu-section">
                    <button className="menu-item" onClick={signOut}>
                      <Icon name="exit" size={16} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </Popover>
          </div>
        </header>
        <main className="content" id="main" tabIndex={-1} style={{ outline: 'none' }}>
          {siblings.length > 1 ? (
            <nav className="subnav" aria-label={`${group!.title} pages`} ref={(el) => el?.querySelector<HTMLElement>('a.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
              {siblings.map((i) => (
                <NavLink key={i.path} to={i.path} end className={({ isActive }) => (isActive ? 'active' : '')}>
                  {i.label}
                </NavLink>
              ))}
            </nav>
          ) : null}
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : loading || !data ? (
            <div className="stack" style={{ gap: 20 }} aria-busy="true" aria-label="Loading">
              <div className="skel" style={{ height: 30, width: 260 }} />
              <div className="grid cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card"><Skeleton rows={2} /></div>)}</div>
              <div className="card"><Skeleton rows={7} /></div>
            </div>
          ) : (
            <Suspense fallback={<Skeleton rows={6} />}>
              <Routes>
                <Route path="/" element={<Navigate to={home} replace />} />
                {ALL_ITEMS.map((i) => (
                  <Route key={i.path} path={i.path} element={i.anyOf.some((p) => can(p)) ? <i.page /> : <NoAccess />} />
                ))}
                <Route path="*" element={<Navigate to={home} replace />} />
              </Routes>
            </Suspense>
          )}
        </main>
      </div>
      {paletteOpen && data ? <CommandPalette onClose={closePalette} /> : null}
    </div>
  );
}

function NoAccess() {
  return (
    <div className="empty">
      <div className="empty-ico"><Icon name="lock" size={24} /></div>
      <div className="title">Your role can’t open this page</div>
      <div>Ask the company owner to add the permission to your staff account.</div>
    </div>
  );
}
