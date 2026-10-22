import { Suspense, useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CITY_LABELS, ROLE_LABELS, type CityId } from '@gobye/core';
import { initials } from '@/data/format';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF, useFilters, useSession, type RangeKey } from '@/data/session';
import { PlatformProvider, ToastProvider, usePlatform } from '@/data/store';
import { ALL_ITEMS, NAV, ROLE_HOME } from '@/nav';
import { Icon } from '@/ui/Icon';
import { Button, ErrorState, IconButton, Notice, Select, Skeleton } from '@/ui/kit';

type Theme = 'system' | 'light' | 'dark';
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('gobye.admin.theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('gobye.admin.theme', theme);
    } catch {
      /* per-viewer preference only */
    }
  }, [theme]);
  return [theme, setTheme];
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
      <div className="card stack" style={{ gap: 16 }}>
        <div className="brand">
          <div className="brand-mark">GB</div>
          <div>
            <div className="brand-name">GoBye Management</div>
            <div className="muted small">Staff sign in</div>
          </div>
        </div>
        <Notice tone="warning" icon="info">
          Prototype on test data. Sign in is simulated: choose a test staff account to see that role’s workspace. Changes stay while this tab is open, so you can switch staff to follow a request from one team to another. Real sign in (email with one time code, session limits) comes with the backend.
        </Notice>
        <div className="staff-list" role="list">
          {TEST_STAFF.map((s) => (
            <button key={s.id} className="staff-option" role="listitem" onClick={() => signIn(s.id)} disabled={s.status !== 'active'} style={s.status !== 'active' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              <span className="avatar">{initials(s.name)}</span>
              <span style={{ flex: 1 }}>
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
      </div>
    </main>
  );
}

function Shell() {
  const { staff, can, signOut } = useSession();
  const { data, loading, error, reload, reset, now, simulateFailures, setSimulateFailures } = usePlatform();
  const { city, setCity, range, setRange } = useFilters();
  const [theme, setTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  if (!staff) return null;

  const allowed = ALL_ITEMS.filter((i) => i.anyOf.some((p) => can(p)));
  const home = allowed.find((i) => i.path === ROLE_HOME[staff.roles[0]!])?.path ?? allowed[0]?.path ?? '/overview';
  const cityOptions = [{ value: 'all' as const, label: staff.cities.length ? 'My cities' : 'All cities' }, ...(['lagos', 'abuja'] as CityId[]).filter((c) => !staff.cities.length || staff.cities.includes(c)).map((c) => ({ value: c, label: CITY_LABELS[c] }))];

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <nav className="sidebar" aria-label="Workspaces" onClick={(e) => e.target === e.currentTarget && setNavOpen(false)}>
        <div className="brand">
          <div className="brand-mark">GB</div>
          <div>
            <div className="brand-name">GoBye</div>
            <div className="muted small">Management</div>
          </div>
        </div>
        {NAV.map((g) => {
          const items = g.items.filter((i) => i.anyOf.some((p) => can(p)));
          if (!items.length) return null;
          return (
            <div key={g.title} className="nav-group">
              <div className="nav-title">{g.title}</div>
              {items.map((i) => {
                const n = data && i.badge ? i.badge(data, now()) : 0;
                return (
                  <NavLink key={i.path} to={i.path} end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Icon name={i.icon} />
                    <span>{i.label}</span>
                    {n ? <span className="count" aria-label={`${n} need attention`}>{n}</span> : null}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
        <div style={{ marginTop: 'auto' }} className="stack">
          <label className="row small muted" style={{ padding: '0 8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={simulateFailures} onChange={(e) => setSimulateFailures(e.target.checked)} />
            Simulate server failures
          </label>
          <Button size="sm" variant="ghost" icon="refresh" onClick={reset}>
            Reset test data
          </Button>
        </div>
      </nav>

      <div className="main">
        <div className="proto-banner" role="note">
          <Icon name="info" size={15} /> Prototype · test data and simulated responses only. No real money, people or providers.
        </div>
        <header className="topbar">
          <span className="menu-btn">
            <IconButton icon="layout" label="Open menu" onClick={() => setNavOpen(true)} />
          </span>
          <Select label="City" value={city} onChange={setCity} options={cityOptions} />
          <Select<RangeKey>
            label="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: 'all', label: 'All time' },
            ]}
          />
          <span className="spacer" />
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={`Theme: ${theme}. Change`} onClick={() => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')} />
          <div className="row" title={staff.roles.map((r) => ROLE_LABELS[r]).join(', ')}>
            <span className="avatar">{initials(staff.name)}</span>
            <span className="small who-text" style={{ lineHeight: 1.2 }}>
              <span className="strong" style={{ display: 'block' }}>{staff.name}</span>
              <span className="muted">{staff.roles.map((r) => ROLE_LABELS[r]).join(' + ')}</span>
            </span>
          </div>
          <IconButton icon="exit" label="Sign out" onClick={signOut} />
        </header>
        <main className="content" id="main">
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : loading || !data ? (
            <div className="stack" style={{ gap: 20 }}>
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
    </div>
  );
}

function NoAccess() {
  return (
    <div className="empty">
      <Icon name="lock" size={28} />
      <div className="title">Your role can’t open this page</div>
      <div>Ask the company owner to add the permission to your staff account.</div>
    </div>
  );
}
