import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { naira, type CityId, type EventPartnership } from '@gobye/core';
import { city as cityLabel, count, date, money, pct, when } from '@/data/format';
import { useScopedFilter, useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import type { IconName } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, KV, Notice, PageHead, Pill, Stat, Table, Tabs, type Column, type Tone } from '@/ui/kit';
import { ChipsInput, NumberField, TextField } from '@/workspaces/config/fields';
import { fromLocalInput, toLocalInput } from '@/workspaces/config/logic';
import { EVENT_FLOW, eventResults, validateEvent, type EventStatus } from './logic';

const STATUS: Record<EventStatus, { tone: Tone; text: string; icon: IconName }> = {
  planned: { tone: 'info', text: 'Planned', icon: 'calendar' },
  live: { tone: 'success', text: 'Live', icon: 'radar' },
  ended: { tone: 'neutral', text: 'Ended', icon: 'checkCircle' },
};
const CAMPAIGN_TONE: Record<string, Tone> = { active: 'success', draft: 'neutral', scheduled: 'info', paused: 'warning', ended: 'neutral', pending_approval: 'warning', rejected: 'danger' };

type Form = { id?: string; name: string; partner: string; venue: string; city: CityId; starts: string; ends: string; pickupZones: string[]; sponsorshipNaira: number | null };

export default function Events() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const keep = useScopedFilter();
  const act = useAction();
  const navigate = useNavigate();
  const t = now();

  const [tab, setTab] = useState<'all' | EventStatus>('all');
  const [form, setForm] = useState<Form | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { e: EventPartnership; to: EventStatus }>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = can('events.manage');
  const showMoney = canManage || can('finance.view');
  const events = useMemo(() => d.events.filter((e) => keep(e.city, undefined, t)).sort((a, b) => b.startsAt - a.startsAt), [d.events, keep, t]);
  const rows = tab === 'all' ? events : events.filter((e) => e.status === tab);

  const toEvent = (f: Form) => ({
    name: f.name.trim(),
    partner: f.partner.trim(),
    venue: f.venue.trim(),
    city: f.city,
    startsAt: fromLocalInput(f.starts),
    endsAt: fromLocalInput(f.ends),
    pickupZones: f.pickupZones,
    sponsorship: f.sponsorshipNaira === null || Number.isNaN(f.sponsorshipNaira) ? undefined : naira(Math.round(f.sponsorshipNaira)),
  });

  const save = async () => {
    if (!form) return;
    const f = form;
    const e = toEvent(f);
    let id = f.id ?? '';
    const prev = f.id ? d.events.find((x) => x.id === f.id) : undefined;
    const r = await act(
      {
        label: f.id ? 'Save event' : 'Create event',
        apply: (draft, ctx) => {
          const errs = validateEvent(e);
          if (errs.length) return { ok: false, error: errs[0]! };
          if (!f.id) {
            id = `evt-${ctx.now.toString(36)}`;
            draft.events.push({ ...e, id, status: 'planned', bookings: 0 });
            return { ok: true };
          }
          const x = draft.events.find((y) => y.id === f.id);
          if (!x) return { ok: false, error: 'Event not found.' };
          if (x.status === 'ended') return { ok: false, error: 'Ended events can’t be edited.' };
          Object.assign(x, e);
          return { ok: true };
        },
        audit: () => ({
          action: f.id ? 'event.edited' : 'event.created',
          target: { type: 'event', id, label: e.name },
          summary: f.id ? `Edited event “${e.name}”` : `Created event “${e.name}” with ${e.partner}`,
          diff: prev
            ? [
                prev.venue !== e.venue && { field: 'Venue', from: prev.venue, to: e.venue },
                prev.pickupZones.join(', ') !== e.pickupZones.join(', ') && { field: 'Pickup zones', from: prev.pickupZones.join(', '), to: e.pickupZones.join(', ') },
                prev.startsAt !== e.startsAt && { field: 'Starts', from: when(prev.startsAt, t), to: when(e.startsAt, t) },
                prev.sponsorship !== e.sponsorship && { field: 'Sponsorship', from: prev.sponsorship !== undefined ? money(prev.sponsorship) : 'None', to: e.sponsorship !== undefined ? money(e.sponsorship) : 'None' },
              ].filter((x): x is { field: string; from: string; to: string } => !!x)
            : undefined,
        }),
      },
      f.id ? 'Event saved' : 'Event created',
    );
    if (r.ok) {
      setForm(null);
      setOpenId(id);
    } else setError(r.error);
  };

  const transition = async (e: EventPartnership, to: EventStatus) => {
    const r = await act(
      {
        label: `Mark event ${to}`,
        apply: (draft) => {
          const x = draft.events.find((y) => y.id === e.id);
          if (!x) return { ok: false, error: 'Event not found.' };
          if (!EVENT_FLOW[x.status].includes(to)) return { ok: false, error: `Can’t move from ${STATUS[x.status].text.toLowerCase()} to ${STATUS[to].text.toLowerCase()}.` };
          x.status = to;
          return { ok: true };
        },
        audit: () => ({ action: `event.${to}`, target: { type: 'event', id: e.id, label: e.name }, summary: `Marked “${e.name}” as ${STATUS[to].text.toLowerCase()}` }),
      },
      `Marked ${STATUS[to].text.toLowerCase()}`,
    );
    if (r.ok) setConfirm(null);
  };

  const startNew = () => {
    setError(null);
    const start = t + 14 * 86_400_000;
    setForm({ name: '', partner: '', venue: '', city: 'lagos', starts: toLocalInput(start), ends: toLocalInput(start + 6 * 3_600_000), pickupZones: [], sponsorshipNaira: null });
  };
  const edit = (e: EventPartnership) => {
    setOpenId(null);
    setError(null);
    setForm({ id: e.id, name: e.name, partner: e.partner, venue: e.venue, city: e.city, starts: toLocalInput(e.startsAt), ends: toLocalInput(e.endsAt), pickupZones: [...e.pickupZones], sponsorshipNaira: e.sponsorship === undefined ? null : e.sponsorship / 100 });
  };

  const cols: Column<EventPartnership>[] = [
    { key: 'n', label: 'Event', render: (e) => <div><div className="cell-title">{e.name}</div><div className="cell-sub">{e.partner}</div></div> },
    { key: 'v', label: 'Venue', render: (e) => <div><div className="small">{e.venue}</div><div className="cell-sub">{cityLabel(e.city)}</div></div> },
    { key: 'd', label: 'Dates', render: (e) => <span className="small num">{when(e.startsAt, t)}</span> },
    { key: 's', label: 'Status', render: (e) => <Pill tone={STATUS[e.status].tone} icon={STATUS[e.status].icon}>{STATUS[e.status].text}</Pill> },
    { key: 'z', label: 'Pickup zones', render: (e) => <span className="small">{e.pickupZones.join(', ')}</span> },
    { key: 'b', label: 'Bookings', align: 'right', render: (e) => <span className="num">{count(e.bookings)}</span> },
    ...(showMoney ? [{ key: 'm', label: 'Sponsorship', align: 'right' as const, render: (e: EventPartnership) => <span className="num small">{e.sponsorship !== undefined ? money(e.sponsorship) : 'None'}</span> }] : []),
  ];

  const open = d.events.find((e) => e.id === openId);
  const formErrs = form ? validateEvent(toEvent(form)) : [];

  return (
    <>
      <PageHead
        title="Events and partners"
        sub="Event partnerships with pickup zones at the venue, sponsorship and results."
        actions={canManage ? <Button variant="primary" icon="add" onClick={startNew}>New event</Button> : <Button icon="add" disabledReason="Needs events access">New event</Button>}
      />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Planned" value={count(events.filter((e) => e.status === 'planned').length)} onClick={() => setTab('planned')} />
        <Stat label="Live now" value={count(events.filter((e) => e.status === 'live').length)} onClick={() => setTab('live')} />
        <Stat label="Bookings from events" value={count(events.reduce((s, e) => s + e.bookings, 0))} />
        {showMoney ? <Stat label="Sponsorship agreed" value={money(events.reduce((s, e) => s + (e.sponsorship ?? 0), 0))} sub="Not yet reconciled with finance" /> : <Stat label="Ended" value={count(events.filter((e) => e.status === 'ended').length)} />}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All', count: events.length },
          { value: 'planned', label: 'Planned', count: events.filter((e) => e.status === 'planned').length },
          { value: 'live', label: 'Live', count: events.filter((e) => e.status === 'live').length },
          { value: 'ended', label: 'Ended', count: events.filter((e) => e.status === 'ended').length },
        ]}
      />
      <Card flush>
        <Table rows={rows} columns={cols} rowKey={(e) => e.id} onRowClick={(e) => setOpenId(e.id)} empty={<Empty title="No events here" icon="calendar" action={canManage ? <Button icon="add" onClick={startNew}>New event</Button> : undefined}>Events in the selected city and status show here.</Empty>} />
      </Card>

      {open ? (
        (() => {
          const res = eventResults(d, open);
          const due = open.status === 'planned' && open.startsAt <= t;
          return (
            <Drawer
              title={open.name}
              sub={<Pill tone={STATUS[open.status].tone} icon={STATUS[open.status].icon}>{STATUS[open.status].text}</Pill>}
              onClose={() => setOpenId(null)}
              footer={
                canManage && open.status !== 'ended'
                  ? [
                      <Button key="e" variant="ghost" icon="edit" onClick={() => edit(open)}>Edit</Button>,
                      can('promos.manage') ? (
                        <Button key="p" icon="layout" onClick={() => navigate(`/promos?event=${open.id}`)}>Create promo card</Button>
                      ) : null,
                      ...EVENT_FLOW[open.status].map((s) => (
                        <Button key={s} variant={s === 'ended' ? 'danger-soft' : 'primary'} onClick={() => setConfirm({ e: open, to: s })}>
                          Mark {STATUS[s].text.toLowerCase()}
                        </Button>
                      )),
                    ]
                  : undefined
              }
            >
              {due ? <Notice tone="warning">The start time has passed. Mark the event live if it is running.</Notice> : null}
              <KV
                items={[
                  ['Partner', open.partner],
                  ['Venue', `${open.venue}, ${cityLabel(open.city)}`],
                  ['Starts', when(open.startsAt, t)],
                  ['Ends', when(open.endsAt, t)],
                  ...(showMoney ? ([['Sponsorship', open.sponsorship !== undefined ? money(open.sponsorship) : 'None']] as [string, string][]) : []),
                ]}
              />
              <ChipsInput label="Pickup zones" values={open.pickupZones} onChange={() => undefined} placeholder="" readOnly />
              <div className="stack">
                <h3>Results</h3>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                  <Stat label="Bookings" value={count(open.bookings)} sub="Recorded for the event" />
                  <Stat label="Trips in window" value={count(res.trips)} sub={`${cityLabel(open.city)}, during the event`} />
                  <Stat label="Completed" value={count(res.completed)} sub={res.trips ? `${pct(res.completed / res.trips)} of trips` : 'None yet'} />
                  <Stat label="Card opens" value={count(res.opens)} sub={`${count(res.impressions)} impressions`} />
                </div>
                {open.status === 'planned' ? <p className="muted small">Results fill in once the event starts.</p> : null}
              </div>
              <div className="stack">
                <h3>Linked promo cards</h3>
                {res.campaigns.length ? (
                  res.campaigns.map((c) => (
                    <div key={c.id} className="row wrap" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span>
                        <span className="strong">{c.title}</span>
                        <div className="cell-sub">
                          {date(c.startsAt)}
                          {c.endsAt ? ` to ${date(c.endsAt)}` : ''} · {count(c.impressions)} impressions
                        </div>
                      </span>
                      <Pill tone={CAMPAIGN_TONE[c.status] ?? 'neutral'}>{c.status === 'pending_approval' ? 'Pending approval' : c.status.charAt(0).toUpperCase() + c.status.slice(1)}</Pill>
                    </div>
                  ))
                ) : (
                  <Empty title="No promo card linked" icon="layout">
                    {can('promos.manage') ? 'Create one so passengers see the pickup zones.' : 'Marketing can link a card to this event.'}
                  </Empty>
                )}
                {res.campaigns.length ? (
                  <div>
                    <Button size="sm" variant="ghost" icon="arrowRight" onClick={() => navigate('/promos')}>
                      Open promotions
                    </Button>
                  </div>
                ) : null}
              </div>
              {res.announcements.length ? (
                <div className="stack">
                  <h3>Announcements to attendees</h3>
                  {res.announcements.map((a) => (
                    <div key={a.id} className="small">
                      {a.title} <span className="muted">· {a.status.replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Drawer>
          );
        })()
      ) : null}

      {form ? (
        <Drawer
          title={form.id ? 'Edit event' : 'New event'}
          sub="Pickup zones show in the passenger app when a linked card is active."
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="primary" icon="check" onClick={save} disabledReason={formErrs[0]}>Save</Button>
            </>
          }
        >
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <TextField label="Event name" value={form.name} onChange={(name) => setForm({ ...form, name })} max={60} />
          <TextField label="Partner" value={form.partner} onChange={(partner) => setForm({ ...form, partner })} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            <TextField label="Venue" value={form.venue} onChange={(venue) => setForm({ ...form, venue })} />
            <Field label="City">
              {(id) => (
                <select id={id} className="select" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value as CityId })}>
                  <option value="lagos">Lagos</option>
                  <option value="abuja">Abuja</option>
                </select>
              )}
            </Field>
            <Field label="Starts" hint="Lagos time">{(id) => <input id={id} className="input" type="datetime-local" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} />}</Field>
            <Field label="Ends">{(id) => <input id={id} className="input" type="datetime-local" value={form.ends} min={form.starts} onChange={(e) => setForm({ ...form, ends: e.target.value })} />}</Field>
          </div>
          <ChipsInput label="Pickup zones" values={form.pickupZones} onChange={(pickupZones) => setForm({ ...form, pickupZones })} placeholder="Add a gate or car park" />
          <NumberField label="Sponsorship (optional)" prefix="₦" step={1000} value={form.sponsorshipNaira ?? Number.NaN} onChange={(v) => setForm({ ...form, sponsorshipNaira: Number.isNaN(v) ? null : v })} hint="Agreed amount. Finance records the actual payment." />
          {formErrs.length ? (
            <Notice tone="danger">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {formErrs.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </Drawer>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={`Mark “${confirm.e.name}” ${STATUS[confirm.to].text.toLowerCase()}`}
          body={confirm.to === 'ended' ? 'The event can’t be edited after it ends. Results are kept.' : 'Pickup zones are treated as in use from now.'}
          confirmLabel={`Mark ${STATUS[confirm.to].text.toLowerCase()}`}
          danger={confirm.to === 'ended'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => transition(confirm.e, confirm.to)}
        />
      ) : null}
    </>
  );
}
