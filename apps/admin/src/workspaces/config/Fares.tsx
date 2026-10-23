import { useState } from 'react';
import { PageHead, Tabs } from '@/ui/kit';
import { NumberField } from './fields';
import {
  CANCELLATION_DEFAULTS,
  FARE_DEFAULTS,
  describeCancellation,
  describeFares,
  farePreview,
  nairaText,
  normalizeCancellation,
  normalizeFares,
  validateCancellation,
  validateFares,
  type FareRules,
} from './logic';
import { VersionedSettings } from './VersionedSettings';

/** Fare settings: suggested fare rules (key `fares`) and waiting and cancellation (key `cancellation`). */
export default function Fares() {
  const [tab, setTab] = useState<'fares' | 'cancellation'>('fares');
  return (
    <>
      <PageHead eyebrow="Settings" title="Fare settings" sub="Suggested fare rules, waiting and cancellation. Passengers may still negotiate around the suggested fare." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'fares', label: 'Suggested fare' },
          { value: 'cancellation', label: 'Waiting and cancellation' },
        ]}
      />
      {tab === 'fares' ? (
        <VersionedSettings<FareRules>
          key="fares"
          configKey="fares"
          name="Fare rules"
          normalize={normalizeFares}
          describe={describeFares}
          validate={validateFares}
          fallback={{ value: FARE_DEFAULTS, label: 'The apps use their built in placeholder rates.' }}
          effect="New quotes use the version in force when the passenger asks for a price. A quote already shown keeps its fare until it expires."
          renderPreview={({ current, proposed, proposedLabel }) => <FarePreview current={current} proposed={proposed} proposedLabel={proposedLabel} />}
          renderEditor={({ value, onChange }) => (
            <div className="grid cols-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              <NumberField label="Base fare" prefix="₦" value={value.base} onChange={(base) => onChange({ ...value, base })} />
              <NumberField label="Per km" prefix="₦" value={value.perKm} onChange={(perKm) => onChange({ ...value, perKm })} />
              <NumberField label="Per minute" prefix="₦" value={value.perMin} onChange={(perMin) => onChange({ ...value, perMin })} />
              <NumberField label="Minimum fare" prefix="₦" value={value.minimum} onChange={(minimum) => onChange({ ...value, minimum })} />
              <NumberField label="Round up to" prefix="₦" step={10} value={value.rounding} onChange={(rounding) => onChange({ ...value, rounding })} hint="0 rounds to the nearest naira" />
            </div>
          )}
        />
      ) : (
        <VersionedSettings
          key="cancellation"
          configKey="cancellation"
          name="Waiting and cancellation"
          normalize={normalizeCancellation}
          describe={describeCancellation}
          validate={validateCancellation}
          fallback={{ value: CANCELLATION_DEFAULTS, label: 'The apps use their built in placeholder rules.' }}
          effect="Applies to trips requested from the effective date. A trip in progress keeps the rules it started with."
          renderEditor={({ value, onChange }) => (
            <div className="stack" style={{ gap: 14 }}>
              <h3>Cancellation</h3>
              <div className="grid cols-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                <NumberField label="Free cancellation window" suffix="minutes" value={value.freeMinutes} onChange={(freeMinutes) => onChange({ ...value, freeMinutes })} hint="After a driver accepts" />
                <NumberField label="Cancellation fee" prefix="₦" value={value.fee} onChange={(fee) => onChange({ ...value, fee })} />
              </div>
              <h3>Waiting at pickup</h3>
              <div className="grid cols-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                <NumberField label="Free waiting" suffix="minutes" value={value.waitingFreeMinutes} onChange={(waitingFreeMinutes) => onChange({ ...value, waitingFreeMinutes })} />
                <NumberField label="Waiting charge" prefix="₦" suffix="per minute" value={value.waitingPerMin} onChange={(waitingPerMin) => onChange({ ...value, waitingPerMin })} hint="0 means waiting is not charged" />
              </div>
            </div>
          )}
        />
      )}
    </>
  );
}

function change(n: number, pct: number) {
  if (n === 0) return <span className="muted">No change</span>;
  return (
    <span className="strong">
      {nairaText(Math.abs(n))} {n > 0 ? 'more' : 'less'} <span className="muted small">({Math.round(Math.abs(pct) * 100)}%)</span>
    </span>
  );
}

export function FarePreview({ current, proposed, proposedLabel }: { current: FareRules; proposed: FareRules; proposedLabel: string }) {
  const rows = farePreview(current, proposed);
  return (
    <div className="stack">
      <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Example trip</th>
              <th className="right">In force now</th>
              <th className="right">{proposedLabel}</th>
              <th className="right">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="strong">{r.label}</td>
                <td className="right num">{nairaText(r.current)}</td>
                <td className="right num strong">{nairaText(r.proposed)}</td>
                <td className="right num">{change(r.change, r.pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Suggested fare = base + per km + per minute, at least the minimum, rounded up. Example distances and times only.</p>
    </div>
  );
}
