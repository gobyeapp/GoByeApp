import { DRIVER_ACCESS_PACKAGES, toNaira, versionInForce } from '@gobye/core';
import { count, money } from '@/data/format';
import { useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Card, Field, Notice, PageHead, Pill, Stat } from '@/ui/kit';
import { Check, NumberField } from './fields';
import { ACTIVATION_LABEL, describePackages, discounted, nairaText, normalizePackages, validatePackages, versionsOf, type PackageRule, type Packages as Pkgs } from './logic';
import { VersionedSettings } from './VersionedSettings';

const DAY = 86_400_000;

/** Driver access packages (key `packages`, D-024). Prices are provisional until the owner confirms. */
export default function Packages() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const current = normalizePackages(versionInForce(versionsOf(d.configVersions, 'packages'), t)?.value);

  const approved = d.drivers.filter((x) => x.verification === 'approved');
  const active = (id: 'daily' | 'monthly') => approved.filter((x) => x.access?.packageId === id && x.access.expiresAt > t).length;
  const without = approved.filter((x) => !x.access || x.access.expiresAt <= t).length;
  const purchases = d.collections.filter((c) => c.purpose === 'package_purchase' && c.status === 'successful' && t - c.createdAt <= 30 * DAY);
  const showMoney = can('finance.view') || can('ledger.view');

  const mismatches = current.items.filter((i) => {
    const app = DRIVER_ACCESS_PACKAGES.find((p) => p.id === i.id);
    return app && toNaira(app.price) !== i.price;
  });

  return (
    <>
      <PageHead eyebrow="Settings" title="Driver packages" sub="Access passes approved drivers buy to go online. GoBye takes no commission per trip." />
      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <Stat label="Active daily passes" value={count(active('daily'))} />
        <Stat label="Active monthly passes" value={count(active('monthly'))} />
        <Stat label="Approved drivers without access" value={count(without)} sub="Can’t go online until they buy a pass" />
        <Stat label="Purchases in 30 days" value={count(purchases.length)} sub={showMoney ? `${money(purchases.reduce((s, c) => s + c.amount, 0))} collected` : 'Amounts need finance access'} />
      </div>
      {current.provisional ? (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warning">
            Prices are provisional (D-024) until the owner confirms them.
            {mismatches.length
              ? ` The driver app’s built in list differs: ${mismatches.map((i) => `${i.name} ${nairaText(toNaira(DRIVER_ACCESS_PACKAGES.find((p) => p.id === i.id)!.price))} in the app, ${nairaText(i.price)} here`).join('; ')}. Confirm one price before launch.`
              : ''}
          </Notice>
        </div>
      ) : null}
      <VersionedSettings<Pkgs>
        configKey="packages"
        name="Packages"
        normalize={normalizePackages}
        describe={describePackages}
        validate={validatePackages}
        effect="Purchased passes keep their price, length and terms. New prices apply to purchases from the effective date."
        renderValue={(v) => <PackageCards value={v} />}
        renderEditor={({ value, onChange }) => (
          <div className="stack" style={{ gap: 14 }}>
            {value.items.map((i, k) => (
              <PackageEditor key={i.id} item={i} onChange={(next) => onChange({ ...value, items: value.items.map((x, j) => (j === k ? next : x)) })} />
            ))}
            <Card>
              <h3 style={{ marginBottom: 12 }}>Renewal and eligibility</h3>
              <div className="stack" style={{ gap: 12 }}>
                <Notice tone="info" icon="lock">
                  Eligibility is fixed: approved drivers only. Suspended or unverified drivers can’t buy a pass.
                </Notice>
                <NumberField label="Renewal reminder" suffix="hours before access ends" value={value.renewalReminderHours} min={1} max={72} onChange={(renewalReminderHours) => onChange({ ...value, renewalReminderHours })} />
                <Field label="Buying again before access ends">
                  {(id) => (
                    <select id={id} className="select" value={value.earlyRenewal} onChange={(e) => onChange({ ...value, earlyRenewal: e.target.value as Pkgs['earlyRenewal'] })}>
                      <option value="extends">Allowed: adds time after current access</option>
                      <option value="not_allowed">Not allowed until access ends</option>
                    </select>
                  )}
                </Field>
                <Check checked={value.provisional} onChange={(provisional) => onChange({ ...value, provisional })}>
                  Prices are provisional (D-024)
                </Check>
                <p className="muted small">Automatic renewal is not offered: there are no saved payment methods.</p>
              </div>
            </Card>
          </div>
        )}
      />
    </>
  );
}

function PackageCards({ value }: { value: Pkgs }) {
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {value.items.map((i) => (
          <Card key={i.id} muted>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="strong">{i.name}</span>
              {value.provisional ? <Pill tone="warning" icon="time">Provisional</Pill> : <Pill tone="success">Confirmed</Pill>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, margin: '6px 0' }} className="num">
              {nairaText(i.price)}
            </div>
            <div className="muted small">
              {i.durationDays} day{i.durationDays === 1 ? '' : 's'} · {ACTIVATION_LABEL[i.activation].toLowerCase()}
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {i.firstPurchaseDiscountPct > 0 ? `First purchase ${i.firstPurchaseDiscountPct}% off: ${nairaText(discounted(i))}` : 'No first purchase offer'}
            </div>
          </Card>
        ))}
      </div>
      <p className="muted small">
        Approved drivers only · reminder {value.renewalReminderHours} hours before access ends · early renewal {value.earlyRenewal === 'extends' ? 'adds time' : 'not allowed'}
      </p>
    </div>
  );
}

function PackageEditor({ item, onChange }: { item: PackageRule; onChange: (i: PackageRule) => void }) {
  return (
    <Card>
      <h3 style={{ marginBottom: 12 }}>{item.name}</h3>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
        <NumberField label="Price" prefix="₦" value={item.price} onChange={(price) => onChange({ ...item, price })} />
        <NumberField label="Duration" suffix="days" value={item.durationDays} min={1} max={31} onChange={(durationDays) => onChange({ ...item, durationDays })} />
        <Field label="Access starts">
          {(id) => (
            <select id={id} className="select" value={item.activation} onChange={(e) => onChange({ ...item, activation: e.target.value as PackageRule['activation'] })}>
              <option value="on_payment">{ACTIVATION_LABEL.on_payment}</option>
              <option value="next_midnight">{ACTIVATION_LABEL.next_midnight}</option>
            </select>
          )}
        </Field>
        <NumberField
          label="First purchase discount"
          suffix="%"
          value={item.firstPurchaseDiscountPct}
          min={0}
          max={50}
          onChange={(firstPurchaseDiscountPct) => onChange({ ...item, firstPurchaseDiscountPct })}
          hint={item.firstPurchaseDiscountPct > 0 && Number.isFinite(item.price) ? `Driver pays ${nairaText(discounted(item))} once` : 'A real discount on a driver’s first pass'}
        />
      </div>
    </Card>
  );
}
