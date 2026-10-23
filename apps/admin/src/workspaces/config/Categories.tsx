import { useSession } from '@/data/session';
import { Button, Card, Field, Notice, PageHead, Pill, Select } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { Check, NumberField, TextField } from './fields';
import { IMAGE_KEYS, describeCategories, launchRule, normalizeCategories, slug, validateCategories, type Categories as Cats, type CategoryItem } from './logic';
import { VersionedSettings } from './VersionedSettings';

/** Vehicle categories (key `categories`). Launch rule: one car category enabled. */
export default function Categories() {
  return (
    <>
      <PageHead eyebrow="Settings" title="Vehicle categories" sub="What passengers can choose on the booking screen. GoBye launches with one car category." />
      <VersionedSettings<Cats>
        configKey="categories"
        name="Categories"
        normalize={normalizeCategories}
        describe={describeCategories}
        validate={validateCategories}
        effect="Eligible booking screens show the category. Drivers whose vehicle matches an enabled category can receive its requests."
        warnings={(_, after) => <LaunchNotice value={after} />}
        renderValue={(v) => <CategoryList value={v} />}
        renderEditor={({ value, onChange, base, canOverride }) => <CategoryEditor value={value} onChange={onChange} base={base} canOverride={canOverride} />}
      />
    </>
  );
}

function LaunchNotice({ value }: { value: Cats }) {
  const rule = launchRule(value);
  if (!rule.violates) return null;
  if (rule.overridden)
    return (
      <Notice tone="warning">
        {rule.enabledCars.length} car categories enabled under a launch override: “{value.launchOverride?.note}” ({value.launchOverride?.by}).
      </Notice>
    );
  return (
    <Notice tone="danger">
      Only one car category can be enabled at launch. {rule.enabledCars.join(' and ')} are both enabled. Turn one off, or the owner adds a launch override note.
    </Notice>
  );
}

function CategoryList({ value }: { value: Cats }) {
  const items = [...value.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const shown = items.filter((i) => i.enabled);
  return (
    <div className="stack">
      <span className="muted small">Booking screen shows {shown.length ? shown.map((i) => i.name).join(', ') : 'nothing'}</span>
      {items.map((i) => (
        <div key={i.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <span className="row">
            <Icon name="car" size={18} />
            <span>
              <span className="strong">{i.name}</span>
              <span className="muted small"> · {i.seats} seats · {i.kind === 'car' ? 'Car' : 'Tricycle'}</span>
              <div className="cell-sub">{i.description}</div>
            </span>
          </span>
          {i.enabled ? <Pill tone="success">Enabled</Pill> : <Pill tone="neutral" icon="close">Off</Pill>}
        </div>
      ))}
    </div>
  );
}

function CategoryEditor({ value, onChange, base, canOverride }: { value: Cats; onChange: (v: Cats) => void; base: Cats | null; canOverride: boolean }) {
  const { staff } = useSession();
  const rule = launchRule(value);
  const items = [...value.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const set = (id: string, patch: Partial<CategoryItem>) => onChange({ ...value, items: value.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const isNew = (id: string) => !base?.items.some((b) => b.id === id);
  const add = () => {
    let id = slug('new category');
    let n = 1;
    while (value.items.some((i) => i.id === id)) id = `${slug('new category')}_${++n}`;
    const sortOrder = value.items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
    onChange({ ...value, items: [...value.items, { id, name: '', kind: 'car', seats: 4, description: '', image: 'sedan', sortOrder, enabled: false }] });
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      {items.map((i) => (
        <Card key={i.id}>
          <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <Check checked={i.enabled} onChange={(enabled) => set(i.id, { enabled })}>
              <span className="strong">{i.name || 'New category'}</span> <span className="muted small">enabled on booking screens</span>
            </Check>
            {isNew(i.id) ? (
              <Button size="sm" variant="ghost" icon="close" onClick={() => onChange({ ...value, items: value.items.filter((x) => x.id !== i.id) })}>
                Remove
              </Button>
            ) : (
              <span className="muted small">Published categories can be turned off, not removed</span>
            )}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            <TextField label="Name" value={i.name} onChange={(name) => set(i.id, { name })} max={24} />
            <Field label="Type">
              {(id) => (
                <select id={id} className="select" value={i.kind} onChange={(e) => set(i.id, { kind: e.target.value as CategoryItem['kind'] })}>
                  <option value="car">Car</option>
                  <option value="tricycle">Tricycle</option>
                </select>
              )}
            </Field>
            <NumberField label="Seats" value={i.seats} min={1} max={8} onChange={(seats) => set(i.id, { seats })} />
            <NumberField label="Sort order" value={i.sortOrder} min={1} onChange={(sortOrder) => set(i.id, { sortOrder })} hint="Lower shows first" />
            <Field label="Image key" hint="Only sedan artwork exists in the apps">
              {() => <Select label="Image key" value={i.image} onChange={(image) => set(i.id, { image })} options={IMAGE_KEYS.map((k) => ({ value: k, label: k }))} />}
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <TextField label="Description" value={i.description} onChange={(description) => set(i.id, { description })} max={60} />
          </div>
        </Card>
      ))}
      <div>
        <Button icon="add" onClick={add}>
          Add category
        </Button>
      </div>
      {rule.violates ? (
        canOverride ? (
          <Card>
            <TextField
              label="Launch override note"
              hint="Owner only. Explains why more than one car category is enabled."
              value={value.launchOverride?.note ?? ''}
              onChange={(note) => onChange({ ...value, launchOverride: note.trim() ? { note, by: staff?.name ?? 'Owner' } : undefined })}
              multiline
            />
          </Card>
        ) : (
          <Notice tone="warning" icon="lock">
            Only the owner can add a launch override.
          </Notice>
        )
      ) : null}
    </div>
  );
}
