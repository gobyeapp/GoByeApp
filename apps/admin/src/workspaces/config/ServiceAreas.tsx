import { useMemo } from 'react';
import { city as cityLabel, count } from '@/data/format';
import { useData, usePlatform } from '@/data/store';
import { Card, Field, Notice, PageHead, Pill, Segmented, Stat } from '@/ui/kit';
import { Check, ChipsInput } from './fields';
import { describeAreas, newlyPaused, normalizeAreas, validateAreas, versionsOf, type CityArea, type ServiceAreas as Areas } from './logic';
import { VersionedSettings } from './VersionedSettings';
import { versionInForce } from '@gobye/core';

const DAY = 86_400_000;

/** Service areas: cities, operating zones and availability rules (key `service_areas`). */
export default function ServiceAreas() {
  const d = useData();
  const { now } = usePlatform();
  const t = now();
  const current = normalizeAreas(versionInForce(versionsOf(d.configVersions, 'service_areas'), t)?.value);

  const stats = useMemo(
    () =>
      current.cities.map((c) => ({
        c,
        online: d.drivers.filter((x) => x.city === c.id && x.online).length,
        trips: d.trips.filter((x) => x.city === c.id && t - x.requestedAt <= 30 * DAY).length,
      })),
    [current.cities, d.drivers, d.trips, t],
  );

  return (
    <>
      <PageHead title="Service areas" sub="Cities, operating zones and when GoBye takes bookings in each." />
      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        {stats.map(({ c, online, trips }) => (
          <Stat
            key={c.id}
            label={cityLabel(c.id)}
            value={<AreaStatus status={c.status} />}
            sub={`${c.zones.length} zones · ${count(online)} drivers online · ${count(trips)} trips in 30 days`}
          />
        ))}
      </div>
      <VersionedSettings<Areas>
        configKey="service_areas"
        name="Service areas"
        normalize={normalizeAreas}
        describe={describeAreas}
        validate={validateAreas}
        effect="Booking screens in a paused city show “Not available here yet”. Trips already booked continue."
        warnings={(before, after) => <PauseWarning before={before} after={after} />}
        renderValue={(v) => <AreaCards areas={v} />}
        renderEditor={({ value, onChange }) => (
          <div className="stack" style={{ gap: 14 }}>
            {value.cities.map((c, i) => (
              <CityEditor key={c.id} city={c} onChange={(next) => onChange({ cities: value.cities.map((x, j) => (j === i ? next : x)) })} />
            ))}
          </div>
        )}
      />
    </>
  );
}

function AreaStatus({ status }: { status: CityArea['status'] }) {
  return status === 'active' ? <Pill tone="success">Active</Pill> : <Pill tone="warning" icon="time">Paused</Pill>;
}

function PauseWarning({ before, after }: { before: Areas | null; after: Areas }) {
  const paused = newlyPaused(before, after);
  if (!paused.length) return null;
  return (
    <Notice tone="warning">
      Pausing {paused.map((c) => c.name).join(' and ')}: booking screens there will show “Not available here yet”. Trips already booked continue, and drivers there can’t receive new requests.
    </Notice>
  );
}

function AreaCards({ areas }: { areas: Areas }) {
  return (
    <div className="stack">
      {areas.cities.map((c) => (
        <Card key={c.id} muted>
          <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="strong">{c.name}</span>
            <span className="row">
              <AreaStatus status={c.status} />
              <span className="muted small">{c.allDay ? 'All day' : `${c.opens} to ${c.closes}`}</span>
            </span>
          </div>
          <ChipsInput label={`Zones (${c.zones.length})`} values={c.zones} onChange={() => undefined} placeholder="" readOnly />
        </Card>
      ))}
    </div>
  );
}

function CityEditor({ city, onChange }: { city: CityArea; onChange: (c: CityArea) => void }) {
  return (
    <Card>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3>{city.name}</h3>
        <Segmented
          label={`${city.name} status`}
          value={city.status}
          onChange={(status) => onChange({ ...city, status })}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
          ]}
        />
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <Check checked={city.allDay} onChange={(allDay) => onChange({ ...city, allDay })}>
          Takes bookings all day
        </Check>
        {city.allDay ? null : (
          <div className="row wrap">
            <Field label="Opens">{(id) => <input id={id} className="input" type="time" value={city.opens} onChange={(e) => onChange({ ...city, opens: e.target.value })} />}</Field>
            <Field label="Closes" hint="Lagos time">
              {(id) => <input id={id} className="input" type="time" value={city.closes} onChange={(e) => onChange({ ...city, closes: e.target.value })} />}
            </Field>
          </div>
        )}
        <ChipsInput label="Operating zones" values={city.zones} onChange={(zones) => onChange({ ...city, zones })} placeholder={`Add a zone in ${city.name}`} />
      </div>
    </Card>
  );
}
