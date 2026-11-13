import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ROLE_LABELS, TEST_STAFF_FALLBACK, type StaffMember } from './data';
import { initials } from '@/data/format';
import { useSession } from '@/data/session';
import { useData } from '@/data/store';
import { resolveTheme, useTheme, type ThemeChoice } from '@/data/theme';
import { Icon, type IconName } from '@/ui/Icon';
import { Button, PageHead, Pill, SearchInput } from '@/ui/kit';
import './settings.css';

/**
 * Settings (D-069): General (profile, appearance, security), Team, Sessions and Support. Compact and flat,
 * after the owner's reference design. Sign in is still simulated, so password, two step setup and
 * session sign out say what they need rather than pretending to work.
 */
type Tab = 'general' | 'team' | 'sessions' | 'support';
const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: 'general', label: 'General', icon: 'settings' },
  { value: 'team', label: 'Team', icon: 'group' },
  { value: 'sessions', label: 'Sessions', icon: 'computer' },
  { value: 'support', label: 'Support', icon: 'headphone' },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'general') as Tab;
  const go = (t: Tab) => setParams(t === 'general' ? {} : { tab: t }, { replace: true });
  return (
    <>
      <PageHead title="Settings" />
      <div
        className="set-tabs"
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const i = TABS.findIndex((t) => t.value === tab);
          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
          go(next.value);
          requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
        }}
      >
        {TABS.map((t) => (
          <button key={t.value} role="tab" id={`tab-${t.value}`} aria-controls={`panel-${t.value}`} aria-selected={t.value === tab} tabIndex={t.value === tab ? 0 : -1} onClick={() => go(t.value)}>
            <Icon name={t.icon} size={16} />
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'general' ? <General /> : tab === 'team' ? <Team /> : tab === 'sessions' ? <Sessions /> : <Support />}
      </div>
    </>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="set-row">
      <div className="set-intro">
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="set-controls">{children}</div>
    </section>
  );
}

function General() {
  const { staff } = useSession();
  const [theme, setTheme] = useTheme();
  const me = staff ?? TEST_STAFF_FALLBACK;
  const options: { value: ThemeChoice; label: string }[] = [
    { value: 'light', label: 'Light mode' },
    { value: 'system', label: 'System mode' },
    { value: 'dark', label: 'Dark mode' },
  ];
  return (
    <>
      <Row title="Personal information" desc="Your name and email on this workspace.">
        <div className="set-avatar" aria-hidden>{initials(me.name)}</div>
        <div className="set-field">
          <span className="set-label">Full name</span>
          <span className="set-value">{me.name}</span>
        </div>
        <div className="set-field">
          <span className="set-label">Email address</span>
          <span className="set-value">{me.email}</span>
        </div>
        <span className="small muted">Changes to your name or email go through the owner while sign in is simulated.</span>
      </Row>
      <Row title="Appearance" desc="Light, dark, or follow your device.">
        <div className="themes" role="radiogroup" aria-label="Appearance">
          {options.map((o) => (
            <label key={o.value} className={`theme-opt ${theme === o.value ? 'on' : ''}`}>
              <span className={`thumb ${o.value}`} aria-hidden>
                <span className="t-side" />
                <span className="t-main">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
              <span className="theme-label">
                <input type="radio" name="theme" value={o.value} checked={theme === o.value} onChange={() => setTheme(o.value)} />
                {o.label}
              </span>
            </label>
          ))}
        </div>
        <span className="small muted">Showing {resolveTheme(theme)} now.</span>
      </Row>
      <Row title="Security" desc="Your role, password and two step sign in.">
        <div className="set-field inline">
          <span className="set-label">Role</span>
          <span className="role-pills">
            {me.roles.map((r) => (
              <Pill key={r} tone="neutral" icon="shield">{ROLE_LABELS[r]}</Pill>
            ))}
          </span>
        </div>
        <div className="set-field inline">
          <span className="set-label">Password</span>
          <span className="set-value">••••••••</span>
          <Button size="sm" disabledReason="Available when real staff sign in goes live">Change</Button>
        </div>
        <div className="set-field inline">
          <span className="set-label">Two step sign in</span>
          <span className="set-value">{me.twoStep ? 'Authenticator app on' : 'Not set'}</span>
          <Button size="sm" disabledReason="Available when real staff sign in goes live">{me.twoStep ? 'Manage' : 'Set up'}</Button>
        </div>
      </Row>
    </>
  );
}

const AVATAR_TONES = ['#1E3A5F', '#5A3A1E', '#1E4D3A', '#5A1E2A', '#5A4A1E', '#1E4D4D', '#4A1E5A', '#2E2A5A'];
const tone = (id: string) => AVATAR_TONES[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_TONES.length]!;
const signedIn = (ms?: number) =>
  ms
    ? new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' }).replace(',', '')
    : 'Not yet';

function Team() {
  const d = useData();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return d.staff.filter((m: StaffMember) => !s || [m.name, m.email, ...m.roles.map((r) => ROLE_LABELS[r])].some((x) => x.toLowerCase().includes(s)));
  }, [d.staff, q]);
  const without = d.staff.filter((m) => m.status === 'active' && !m.twoStep).length;
  return (
    <div className="set-team">
      <div className="team-bar">
        <SearchInput value={q} onChange={setQ} placeholder="Search members" />
        <span className="small muted">{without ? `${without} without two step sign in` : 'Everyone has two step sign in'}</span>
        <span style={{ flex: 1 }} />
        <a className="btn primary" href="#/staff" aria-disabled={!can('staff.manage')} onClick={(e) => !can('staff.manage') && e.preventDefault()}>
          <Icon name="userAdd" size={16} /> Invite member
        </a>
      </div>
      <table className="team-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Last sign in</th>
            <th>Two step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>
                <span className="team-name">
                  <span className="mini-avatar" style={{ background: tone(m.id) }} aria-hidden>{initials(m.name)}</span>
                  <b>{m.name}</b>
                  {m.status !== 'active' ? <Pill tone="neutral">{m.status === 'invited' ? 'Pending' : 'Suspended'}</Pill> : null}
                </span>
              </td>
              <td className="muted">{m.email}</td>
              <td>
                <span className="team-role">
                  <Icon name="shield" size={14} />
                  {m.roles.map((r) => ROLE_LABELS[r]).join(', ')}
                </span>
              </td>
              <td className="num">{signedIn(m.lastSignInAt)}</td>
              <td>{m.twoStep ? <span className="tf on"><Icon name="checkCircle" size={14} /> Enabled</span> : <span className="tf off"><Icon name="warning" size={14} /> {m.status === 'active' ? 'Disabled' : 'Not yet'}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="muted small">No members match your search.</p> : null}
      <p className="small muted">Showing {rows.length} of {d.staff.length} · simulated sign in data · roles and invites are managed in Staff and access</p>
    </div>
  );
}

function Sessions() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /Windows NT 10/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown system';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return (
    <Row title="Sessions" desc="Where you are signed in. End any session you do not recognise.">
      <table className="team-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>System and browser</th>
            <th>Last active</th>
            <th>Manage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="team-name">
                <Icon name="computer" size={18} />
                <b>This device</b>
              </span>
            </td>
            <td>
              <b>{os}</b> <span className="muted">· {browser}</span>
            </td>
            <td>Just now</td>
            <td className="strong">Current session</td>
          </tr>
        </tbody>
      </table>
      <span className="small muted">Other devices, locations and remote sign out appear here once real staff sign in goes live.</span>
    </Row>
  );
}

function Support() {
  const cards: { icon: IconName; title: string; desc: string; cta: string; href: string }[] = [
    { icon: 'headphone', title: 'Contact support', desc: 'Send a message to the GoBye team.', cta: 'Email support', href: 'mailto:gobyeapp@gmail.com?subject=GoBye%20admin%20support' },
    { icon: 'warning', title: 'Report a problem', desc: 'Tell us about something that is not working.', cta: 'Report a problem', href: 'mailto:gobyeapp@gmail.com?subject=GoBye%20admin%20problem%20report&body=What%20happened%3A%0A%0AWhat%20you%20expected%3A%0A%0APage%3A%0A' },
    { icon: 'search', title: 'Find anything', desc: 'Search rides, drivers, riders and pages.', cta: 'Press Ctrl K', href: '#/overview' },
  ];
  return (
    <div className="support-grid">
      {cards.map((c) => (
        <a key={c.title} className="support-card" href={c.href}>
          <Icon name={c.icon} size={20} />
          <b>{c.title}</b>
          <span className="muted">{c.desc}</span>
          <span className="strong support-cta">
            {c.cta} <Icon name="right" size={14} />
          </span>
        </a>
      ))}
    </div>
  );
}
