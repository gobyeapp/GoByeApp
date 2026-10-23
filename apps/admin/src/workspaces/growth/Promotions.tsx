import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CAMPAIGN_FLOW, MOCK_SERVICE_CONFIG, canTransition, naira, nextStatuses, versionInForce, type CampaignStatus, type CityId, type ConfigKey, type PromoCampaign } from '@gobye/core';
import { count, date, money, pct } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Icon, type IconName } from '@/ui/Icon';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, KV, Notice, PageHead, Pill, Segmented, Stat, Table, Tabs, type Column, type Tone } from '@/ui/kit';
import './growth.css';
import { Check, MoveButtons, NumberField, TextField } from '@/workspaces/config/fields';
import { dayKey, startOfDay, versionsOf } from '@/workspaces/config/logic';
import { VersionedSettings } from '@/workspaces/config/VersionedSettings';
import {
  ALL_CITIES,
  ART_KEYS,
  CTA_MAX,
  CTA_ROUTES,
  INTERVAL_MAX,
  INTERVAL_MIN,
  PROMO_BODY_MAX,
  PROMO_TITLE_MAX,
  activationTarget,
  carouselFor,
  isShowing,
  moveInOrder,
  openRate,
  validateInterval,
  validatePromo,
} from './logic';

/**
 * Carousel interval: stored as a versioned setting (ConfigVersion key "promotions"), so changing it
 * is dated, attributed and approved like every other app setting. `ConfigKey` in core does not list
 * "promotions" yet, hence the cast; ask for it to be added to the shared type.
 */
export const PROMOTIONS_KEY = 'promotions' as ConfigKey;
type Carousel = { autoAdvanceSeconds: number };
const normalizeCarousel = (raw: unknown): Carousel => {
  const s = (raw as Partial<Carousel> | undefined)?.autoAdvanceSeconds;
  return { autoAdvanceSeconds: typeof s === 'number' ? s : MOCK_SERVICE_CONFIG.promotions.autoAdvanceSeconds };
};

const STATUS: Record<CampaignStatus, { tone: Tone; text: string; icon: IconName }> = {
  draft: { tone: 'neutral', text: 'Draft', icon: 'edit' },
  pending_approval: { tone: 'warning', text: 'Pending approval', icon: 'time' },
  scheduled: { tone: 'info', text: 'Scheduled', icon: 'calendar' },
  active: { tone: 'success', text: 'Active', icon: 'checkCircle' },
  paused: { tone: 'warning', text: 'Paused', icon: 'time' },
  ended: { tone: 'neutral', text: 'Ended', icon: 'close' },
  rejected: { tone: 'danger', text: 'Rejected', icon: 'close' },
};
const ART_ICON: Record<PromoCampaign['art'], IconName> = { sedan: 'car', gift: 'gift', wallet: 'wallet', destination: 'mapPin' };
const ART_LABEL: Record<PromoCampaign['art'], string> = { sedan: 'Sedan', gift: 'Gift', wallet: 'Wallet', destination: 'Destination pin' };
const ACTION_LABEL: Partial<Record<CampaignStatus, string>> = { active: 'Activate', scheduled: 'Schedule', paused: 'Pause', ended: 'End campaign', draft: 'Back to draft' };

function CampaignPill({ c, now }: { c: PromoCampaign; now: number }) {
  const s = STATUS[c.status];
  if (c.status === 'active' && !isShowing(c, now))
    return (
      <Pill tone="warning" icon="time">
        Active, outside its dates
      </Pill>
    );
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {s.text}
    </Pill>
  );
}

/** Phone width preview of a carousel card, compact like the passenger app. */
export function PromoCard({ c }: { c: Pick<PromoCampaign, 'title' | 'body' | 'ctaLabel' | 'art'> }) {
  return (
    <div style={{ background: '#351A40', color: '#fff', borderRadius: 20, padding: 16, display: 'flex', gap: 12, alignItems: 'center', minHeight: 84 }} title={c.ctaLabel ? `Opens the offer page. Its button reads “${c.ctaLabel}”.` : undefined}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16, lineHeight: '20px', overflowWrap: 'anywhere' }}>{c.title || 'Title'}</div>
        <div style={{ fontSize: 13, lineHeight: '18px', opacity: 0.82, marginTop: 4, overflowWrap: 'anywhere' }}>{c.body || 'Short copy'}</div>
      </div>
      <div style={{ width: 64, height: 64, display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-label={`${ART_LABEL[c.art]} artwork`} role="img">
        <Icon name={ART_ICON[c.art]} size={34} style={{ color: '#FF751F' }} />
      </div>
    </div>
  );
}

function Phone({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div style={{ width: 'min(340px, 100%)', margin: '0 auto', border: '1px solid var(--border)', borderRadius: 30, padding: '18px 14px 22px', background: 'var(--bg)' }} aria-label={caption}>
      <div style={{ width: 70, height: 5, borderRadius: 3, background: 'var(--border)', margin: '0 auto 14px' }} />
      {children}
      <p className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
        {caption}
      </p>
    </div>
  );
}

/** Live carousel preview: auto advances at the interval in force. */
function CarouselPreview({ cards, seconds, placement }: { cards: PromoCampaign[]; seconds: number; placement: string }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [cards.length]);
  useEffect(() => {
    if (cards.length < 2) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const h = setInterval(() => setI((x) => (x + 1) % cards.length), seconds * 1000);
    return () => clearInterval(h);
  }, [cards.length, seconds]);
  const c = cards[i % Math.max(1, cards.length)];
  return (
    <Phone caption={`${placement} carousel now · ${cards.length} card${cards.length === 1 ? '' : 's'} · every ${seconds} seconds`}>
      {c ? (
        <>
          <PromoCard c={c} />
          <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: 10 }} role="tablist" aria-label="Cards">
            {cards.map((x, k) => (
              <button key={x.id} role="tab" aria-selected={k === i} aria-label={x.title} onClick={() => setI(k)} style={{ width: k === i ? 18 : 6, height: 6, borderRadius: 3, border: 'none', padding: 0, cursor: 'pointer', background: k === i ? 'var(--text)' : 'var(--border)' }} />
            ))}
          </div>
        </>
      ) : (
        <Empty title="Nothing showing" icon="layout">The carousel is hidden when no campaign is active.</Empty>
      )}
    </Phone>
  );
}

type Form = Omit<PromoCampaign, 'spent' | 'impressions' | 'opens' | 'status' | 'sortOrder' | 'budget' | 'startsAt' | 'endsAt'> & { status?: CampaignStatus; startDay: string; endDay: string; budgetNaira: number | null; genuine: boolean };

export default function Promotions() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const t = now();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<'campaigns' | 'settings'>('campaigns');
  const [placement, setPlacement] = useState<'home' | 'wallet'>('home');
  const [previewCity, setPreviewCity] = useState<CityId>('lagos');
  const [form, setForm] = useState<Form | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { c: PromoCampaign; to: CampaignStatus }>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = can('promos.manage');
  const showMoney = canManage || can('finance.view');
  const seconds = normalizeCarousel(versionInForce(versionsOf(d.configVersions, PROMOTIONS_KEY), t)?.value).autoAdvanceSeconds;
  const sorted = useMemo(() => [...d.campaigns].sort((a, b) => a.sortOrder - b.sortOrder), [d.campaigns]);
  const showing = carouselFor(d.campaigns, placement, t, previewCity);

  const blank = (eventId?: string): Form => {
    const ev = d.events.find((e) => e.id === eventId);
    return {
      id: '',
      title: '',
      body: '',
      art: ev ? 'destination' : 'sedan',
      ctaLabel: '',
      ctaRoute: '/(tabs)',
      placements: ['home'],
      audience: { type: 'passenger', cities: ev ? [ev.city] : [...ALL_CITIES], eventId },
      startDay: dayKey(ev ? ev.startsAt : t),
      endDay: ev ? dayKey(ev.endsAt + 86_400_000) : '',
      budgetNaira: null,
      genuine: false,
    };
  };

  // Deep link from Events: /promos?event=evt-0001 opens a new campaign for that event.
  useEffect(() => {
    const ev = params.get('event');
    if (ev && canManage) {
      setError(null);
      setForm(blank(ev));
      setTab('campaigns');
      params.delete('event');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const toCampaign = (f: Form): Omit<PromoCampaign, 'spent' | 'impressions' | 'opens' | 'status' | 'sortOrder'> => ({
    id: f.id,
    title: f.title.trim(),
    body: f.body.trim(),
    art: f.art,
    ctaLabel: f.ctaLabel.trim(),
    ctaRoute: f.ctaRoute,
    placements: f.placements,
    audience: f.audience,
    startsAt: startOfDay(f.startDay),
    endsAt: f.endDay ? startOfDay(f.endDay) : undefined,
    budget: f.budgetNaira === null || Number.isNaN(f.budgetNaira) ? undefined : naira(Math.round(f.budgetNaira)),
  });

  const save = async () => {
    if (!form) return;
    const f = form;
    const c = toCampaign(f);
    let id = f.id;
    const r = await act(
      {
        label: f.id ? 'Save campaign' : 'Create campaign',
        apply: (draft, ctx) => {
          const errs = validatePromo(c);
          if (errs.length) return { ok: false, error: errs[0]! };
          if (!f.genuine) return { ok: false, error: 'Confirm the card describes a real feature or a real discount.' };
          if (!f.id) {
            id = `cmp-${ctx.now.toString(36)}`;
            const sortOrder = draft.campaigns.reduce((m, x) => Math.max(m, x.sortOrder), 0) + 1;
            draft.campaigns.push({ ...c, id, status: 'draft', sortOrder, spent: 0 as PromoCampaign['spent'], impressions: 0, opens: 0 });
            return { ok: true };
          }
          const x = draft.campaigns.find((y) => y.id === f.id);
          if (!x) return { ok: false, error: 'Campaign not found.' };
          if (x.status === 'active' || x.status === 'ended') return { ok: false, error: x.status === 'active' ? 'Pause the campaign before editing it.' : 'Ended campaigns can’t be edited.' };
          if (c.budget !== undefined && c.budget < x.spent) return { ok: false, error: 'Budget can’t be below what is already spent.' };
          Object.assign(x, c);
          return { ok: true };
        },
        audit: () => ({ action: f.id ? 'campaign.edited' : 'campaign.created', target: { type: 'campaign', id, label: c.title }, summary: f.id ? `Edited campaign “${c.title}”` : `Created draft campaign “${c.title}”` }),
      },
      f.id ? 'Campaign saved' : 'Draft campaign created',
    );
    if (r.ok) {
      setForm(null);
      setOpenId(id);
    } else setError(r.error);
  };

  const transition = async (c: PromoCampaign, to: CampaignStatus, reason = '') => {
    const r = await act(
      {
        label: `${ACTION_LABEL[to] ?? to} campaign`,
        apply: (draft, ctx) => {
          const x = draft.campaigns.find((y) => y.id === c.id);
          if (!x) return { ok: false, error: 'Campaign not found.' };
          if (!canTransition(CAMPAIGN_FLOW, x.status, to)) return { ok: false, error: `Can’t move from ${STATUS[x.status].text.toLowerCase()} to ${STATUS[to].text.toLowerCase()}.` };
          if (to === 'active' || to === 'scheduled') {
            const errs = validatePromo(x);
            if (errs.length) return { ok: false, error: errs[0]! };
            if (x.endsAt !== undefined && x.endsAt <= ctx.now) return { ok: false, error: 'The end date has passed. Edit the dates first.' };
            if (to === 'active' && x.startsAt > ctx.now) return { ok: false, error: 'The start date is in the future. Schedule it instead.' };
            if (x.budget !== undefined && x.spent >= x.budget) return { ok: false, error: 'The budget is used up.' };
          }
          x.status = to;
          return { ok: true };
        },
        audit: () => ({ action: `campaign.${to}`, target: { type: 'campaign', id: c.id, label: c.title }, summary: `${ACTION_LABEL[to] ?? to}: “${c.title}”${to === 'active' ? `, now in the ${c.placements.join(' and ')} carousel` : ''}`, reason: reason || undefined }),
      },
      to === 'active' ? 'Active. Showing in the carousel' : to === 'scheduled' ? `Scheduled from ${date(c.startsAt)}` : `${STATUS[to].text}`,
    );
    if (r.ok) setConfirm(null);
  };

  const move = (c: PromoCampaign, dir: -1 | 1) => {
    const order = moveInOrder(d.campaigns, c.id, dir);
    if (!order) return;
    void act(
      {
        label: 'Reorder carousel',
        latency: 350,
        apply: (draft) => {
          const o = moveInOrder(draft.campaigns, c.id, dir);
          if (!o) return { ok: false, error: 'Can’t move further.' };
          for (const x of draft.campaigns) x.sortOrder = o[x.id] ?? x.sortOrder;
          return { ok: true };
        },
        audit: () => ({ action: 'campaign.reordered', target: { type: 'campaign', id: c.id, label: c.title }, summary: `Moved “${c.title}” ${dir < 0 ? 'up' : 'down'} to position ${order[c.id]}`, diff: [{ field: 'Carousel order', from: String(c.sortOrder), to: String(order[c.id]) }] }),
      },
      'Order saved',
    );
  };

  const edit = (c: PromoCampaign) => {
    setOpenId(null);
    setError(null);
    setForm({ ...c, audience: structuredClone(c.audience), placements: [...c.placements], startDay: dayKey(c.startsAt), endDay: c.endsAt ? dayKey(c.endsAt) : '', budgetNaira: c.budget === undefined ? null : c.budget / 100, genuine: false });
  };

  const cols: Column<PromoCampaign>[] = [
    {
      key: 'o',
      label: 'Order',
      width: 90,
      render: (c) => (
        <span className="row" style={{ gap: 4 }}>
          <span className="num muted" style={{ width: 16 }}>{c.sortOrder}</span>
          {canManage ? <MoveButtons name={c.title} onUp={() => move(c, -1)} onDown={() => move(c, 1)} upDisabled={sorted[0]?.id === c.id} downDisabled={sorted[sorted.length - 1]?.id === c.id} /> : null}
        </span>
      ),
    },
    { key: 't', label: 'Card', sortValue: (c) => c.title, render: (c) => <div><div className="cell-title">{c.title}</div><div className="cell-sub">{c.body}</div></div> },
    { key: 's', label: 'Status', render: (c) => <CampaignPill c={c} now={t} /> },
    { key: 'p', label: 'Placements', render: (c) => <span className="small">{c.placements.map((p) => (p === 'home' ? 'Home' : 'Wallet')).join(', ')}</span> },
    { key: 'd', label: 'Dates', render: (c) => <span className="small num">{date(c.startsAt)}{c.endsAt ? ` to ${date(c.endsAt)}` : ', no end'}</span> },
    { key: 'i', label: 'Impressions', align: 'right', sortValue: (c) => c.impressions, render: (c) => <span className="num">{count(c.impressions)}</span> },
    { key: 'r', label: 'Opens', align: 'right', sortValue: (c) => c.opens, render: (c) => <span className="num">{count(c.opens)} <span className="muted small">{c.impressions ? pct(openRate(c)) : ''}</span></span> },
    ...(showMoney ? [{ key: 'b', label: 'Spent', align: 'right' as const, render: (c: PromoCampaign) => <span className="num small">{money(c.spent)}{c.budget !== undefined ? <span className="muted"> of {money(c.budget)}</span> : null}</span> }] : []),
  ];

  const open = d.campaigns.find((c) => c.id === openId);
  const errs = form ? validatePromo(toCampaign(form)) : [];
  const formBlock = errs[0] ?? (form && !form.genuine ? 'Confirm the card describes a real feature or a real discount' : undefined);

  return (
    <>
      <PageHead
        title="Promotions"
        sub="Cards in the passenger Home and Wallet carousels."
        actions={
          canManage ? (
            <Button variant="primary" icon="add" onClick={() => (setError(null), setForm(blank()))}>
              New campaign
            </Button>
          ) : (
            <Button icon="add" disabledReason="Needs promotions access">New campaign</Button>
          )
        }
      />
      <div className="stack" style={{ marginBottom: 16 }}>
        <Notice tone="warning" icon="shield">
          Only genuine offers: a card must describe a real feature or a real discount. Never invent a discount, a deadline or a prize.
        </Notice>
        <Notice tone="info">Activating a campaign shows it in the eligible Home or Wallet carousel.</Notice>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'campaigns', label: 'Campaigns', count: d.campaigns.length },
          { value: 'settings', label: 'Carousel settings' },
        ]}
      />
      {tab === 'campaigns' ? (
        <div className="stack" style={{ gap: 16 }}>
          <div className="promo-top">
          <div>
            <Card className="promo-preview" title="Carousel preview">
              <div className="stack">
                <div className="row wrap" style={{ justifyContent: 'space-between' }}>
                  <Segmented label="Placement" value={placement} onChange={setPlacement} options={[{ value: 'home', label: 'Home' }, { value: 'wallet', label: 'Wallet' }]} />
                  <Segmented label="City" value={previewCity} onChange={setPreviewCity} options={[{ value: 'lagos', label: 'Lagos' }, { value: 'abuja', label: 'Abuja' }]} />
                </div>
                <CarouselPreview cards={showing} seconds={seconds} placement={placement === 'home' ? 'Home' : 'Wallet'} />
              </div>
            </Card>
            <div className="small muted" style={{ marginTop: 8 }}>The whole card opens its offer page; the button label is used there.</div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', alignContent: 'start' }}>
            <Stat icon="layout" label="Active now" value={count(d.campaigns.filter((c) => c.status === 'active').length)} sub={`${count(d.campaigns.filter((c) => c.status === 'scheduled').length)} scheduled`} />
            <Stat icon="edit" label="Drafts" value={count(d.campaigns.filter((c) => c.status === 'draft').length)} sub="Not shown to passengers" />
            <Stat icon="eye" label="Impressions" value={count(d.campaigns.reduce((n, c) => n + c.impressions, 0))} sub="All campaigns, test data" />
            <Stat icon="arrowRight" label="Opens" value={count(d.campaigns.reduce((n, c) => n + c.opens, 0))} sub="Card taps that opened the offer" />
          </div>
          </div>
          <Card flush>
            <Table
              rows={sorted}
              columns={cols}
              rowKey={(c) => c.id}
              onRowClick={(c) => setOpenId(c.id)}
              empty={<Empty title="No campaigns yet" icon="layout" action={canManage ? <Button icon="add" onClick={() => setForm(blank())}>New campaign</Button> : undefined}>Create a card for a real feature or offer.</Empty>}
            />
          </Card>
        </div>
      ) : (
        <VersionedSettings<Carousel>
          configKey={PROMOTIONS_KEY}
          name="Carousel"
          normalize={normalizeCarousel}
          describe={(v) => [{ label: 'Auto advance', text: `Every ${v.autoAdvanceSeconds} seconds` }]}
          validate={(v) => validateInterval(v.autoAdvanceSeconds)}
          fallback={{ value: { autoAdvanceSeconds: MOCK_SERVICE_CONFIG.promotions.autoAdvanceSeconds }, label: `The app uses its built in ${MOCK_SERVICE_CONFIG.promotions.autoAdvanceSeconds} seconds.` }}
          editPermissions={['promos.manage', 'config.edit']}
          effect="The passenger app reads the interval when it opens. Cards already on screen finish their current slide."
          renderEditor={({ value, onChange }) => (
            <NumberField label="Auto advance interval" suffix="seconds" min={INTERVAL_MIN} max={INTERVAL_MAX} value={value.autoAdvanceSeconds} onChange={(autoAdvanceSeconds) => onChange({ autoAdvanceSeconds })} hint={`${INTERVAL_MIN} to ${INTERVAL_MAX} seconds`} />
          )}
        />
      )}

      {open ? (
        <Drawer
          title={open.title}
          sub={<CampaignPill c={open} now={t} />}
          onClose={() => setOpenId(null)}
          footer={
            canManage && open.status !== 'ended'
              ? [
                  ...(['draft', 'scheduled', 'paused', 'rejected'].includes(open.status) ? [<Button key="e" icon="edit" variant="ghost" onClick={() => edit(open)}>Edit</Button>] : []),
                  ...nextStatuses(CAMPAIGN_FLOW, open.status)
                    .filter((s) => s !== 'pending_approval' && s !== 'rejected')
                    .filter((s) => !(open.status === 'draft' && s === (activationTarget(open, t) === 'active' ? 'scheduled' : 'active')))
                    .filter((s) => !(open.status === 'scheduled' && s === 'active' && open.startsAt > t))
                    .map((s) => (
                      <Button key={s} variant={s === 'ended' ? 'danger-soft' : s === 'active' || s === 'scheduled' ? 'primary' : 'secondary'} onClick={() => (s === 'ended' || s === 'active' ? setConfirm({ c: open, to: s }) : transition(open, s))}>
                        {open.status === 'paused' && s === 'active' ? 'Resume' : (ACTION_LABEL[s] ?? s)}
                      </Button>
                    )),
                ]
              : undefined
          }
        >
          <Phone caption="Card preview at phone width">
            <PromoCard c={open} />
          </Phone>
          {open.status === 'active' && !isShowing(open, t) ? <Notice tone="warning">Active but outside its dates, so it is not showing.</Notice> : null}
          <KV
            items={[
              ['Placements', open.placements.map((p) => (p === 'home' ? 'Home' : 'Wallet')).join(', ')],
              ['Audience', `Passengers in ${open.audience.cities.map((c) => (c === 'lagos' ? 'Lagos' : 'Abuja')).join(' and ')}${open.audience.eventId ? ` · ${d.events.find((e) => e.id === open.audience.eventId)?.name ?? 'event'}` : ''}`],
              ['Button', `${open.ctaLabel} → ${CTA_ROUTES.find((r) => r.value === open.ctaRoute)?.label ?? open.ctaRoute}`],
              ['Dates', `${date(open.startsAt)}${open.endsAt ? ` to ${date(open.endsAt)}` : ', no end date'}`],
              ['Carousel order', String(open.sortOrder)],
              ['Impressions', count(open.impressions)],
              ['Opens', `${count(open.opens)} (${pct(openRate(open))})`],
              ...(showMoney ? ([['Budget', open.budget !== undefined ? `${money(open.spent)} spent of ${money(open.budget)}` : `${money(open.spent)} spent, no budget set`]] as [string, string][]) : []),
            ]}
          />
          {open.status === 'active' ? <p className="muted small">Pause the campaign to edit it.</p> : null}
        </Drawer>
      ) : null}

      {form ? (
        <Drawer
          title={form.id ? 'Edit campaign' : 'New campaign'}
          sub="Saved as a draft. Activate it from the campaign panel."
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="primary" icon="check" onClick={save} disabledReason={formBlock}>Save</Button>
            </>
          }
        >
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Phone caption="Card preview at phone width">
            <PromoCard c={form} />
          </Phone>
          <Field label="Artwork">
            {() => (
              <div className="row wrap" role="radiogroup" aria-label="Artwork">
                {ART_KEYS.map((k) => (
                  <button key={k} role="radio" aria-checked={form.art === k} className={`btn sm ${form.art === k ? 'primary' : 'secondary'}`} onClick={() => setForm({ ...form, art: k })}>
                    <Icon name={ART_ICON[k]} size={15} />
                    {ART_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <TextField label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} max={PROMO_TITLE_MAX} />
          <TextField label="Short copy" value={form.body} onChange={(body) => setForm({ ...form, body })} max={PROMO_BODY_MAX} hint="One sentence with the key condition" />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            <TextField label="Button label" value={form.ctaLabel} onChange={(ctaLabel) => setForm({ ...form, ctaLabel })} max={CTA_MAX} />
            <Field label="Button opens">
              {(id) => (
                <select id={id} className="select" value={form.ctaRoute} onChange={(e) => setForm({ ...form, ctaRoute: e.target.value })}>
                  {CTA_ROUTES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            <span className="small strong">Placements</span>
            {(['home', 'wallet'] as const).map((p) => (
              <Check key={p} checked={form.placements.includes(p)} onChange={(on) => setForm({ ...form, placements: on ? [...form.placements, p] : form.placements.filter((x) => x !== p) })}>
                {p === 'home' ? 'Home' : 'Wallet'}
              </Check>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            <span className="small strong">Cities</span>
            {ALL_CITIES.map((ci) => (
              <Check key={ci} checked={form.audience.cities.includes(ci)} onChange={(on) => setForm({ ...form, audience: { ...form.audience, cities: on ? [...form.audience.cities, ci] : form.audience.cities.filter((x) => x !== ci) } })}>
                {ci === 'lagos' ? 'Lagos' : 'Abuja'}
              </Check>
            ))}
          </div>
          <Field label="Linked event" hint="Optional. Results show on the event.">
            {(id) => (
              <select id={id} className="select" value={form.audience.eventId ?? ''} onChange={(e) => setForm({ ...form, audience: { ...form.audience, eventId: e.target.value || undefined } })}>
                <option value="">None</option>
                {d.events.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            )}
          </Field>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            <Field label="Starts">{(id) => <input id={id} className="input" type="date" value={form.startDay} onChange={(e) => setForm({ ...form, startDay: e.target.value })} />}</Field>
            <Field label="Ends (optional)" hint="Shows until the start of this day">
              {(id) => <input id={id} className="input" type="date" value={form.endDay} min={form.startDay} onChange={(e) => setForm({ ...form, endDay: e.target.value })} />}
            </Field>
            <NumberField label="Budget (optional)" prefix="₦" step={1000} value={form.budgetNaira ?? Number.NaN} onChange={(v) => setForm({ ...form, budgetNaira: Number.isNaN(v) ? null : v })} hint="Only for real discounts or rewards" />
          </div>
          {errs.length ? (
            <Notice tone="danger">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {errs.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <Card muted>
            <Check checked={form.genuine} onChange={(genuine) => setForm({ ...form, genuine })}>
              This card describes a real feature or a real discount that passengers can use.
            </Check>
          </Card>
        </Drawer>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.to === 'ended' ? `End “${confirm.c.title}”` : `Activate “${confirm.c.title}”`}
          body={confirm.to === 'ended' ? 'It leaves the carousel and can’t be restarted. Results are kept.' : `It shows now in the ${confirm.c.placements.map((p) => (p === 'home' ? 'Home' : 'Wallet')).join(' and ')} carousel for passengers in ${confirm.c.audience.cities.map((c) => (c === 'lagos' ? 'Lagos' : 'Abuja')).join(' and ')}.`}
          confirmLabel={confirm.to === 'ended' ? 'End campaign' : 'Activate'}
          danger={confirm.to === 'ended'}
          requireReason={confirm.to === 'ended'}
          onCancel={() => setConfirm(null)}
          onConfirm={(reason) => transition(confirm.c, confirm.to, reason)}
        />
      ) : null}
    </>
  );
}
