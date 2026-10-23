import { useState } from 'react';
import { COST_CATEGORY_LABEL, monthKey, monthSpend, type CostCategory, type Vendor, type VendorStatus } from '@gobye/core';
import { money } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Button, Card, Drawer, Field, FilterBar, Pill, Select, Stat, Table, type Column } from '@/ui/kit';
import { CostsHead, VendorStatusPill } from './parts';
import { VENDOR_STATUS, monthLabel, saveVendor, validateVendor, type VendorInput } from './logic';

export default function Vendors() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const [status, setStatus] = useState<VendorStatus | 'all'>('all');
  const [edit, setEdit] = useState<Vendor | 'new' | null>(null);
  const month = monthKey(now());
  const rows = d.vendors.filter((v) => status === 'all' || v.status === status);
  const canManage = can('costs.manage');

  const columns: Column<Vendor>[] = [
    { key: 'name', label: 'Vendor', sortValue: (v) => v.name, render: (v) => <div><div className="cell-title">{v.name}</div><div className="cell-sub">{v.note}</div></div> },
    { key: 'cat', label: 'Category', sortValue: (v) => COST_CATEGORY_LABEL[v.category], render: (v) => COST_CATEGORY_LABEL[v.category] },
    { key: 'plan', label: 'Plan', render: (v) => <div className="stack tight"><span>{v.plan}</span><VendorStatusPill status={v.status} /></div> },
    { key: 'billing', label: 'Billing data', render: () => <Pill tone="neutral" icon="plugin">Not connected</Pill> },
    { key: 'owner', label: 'Looked after by', render: (v) => v.owner },
    { key: 'spend', label: monthLabel(month), align: 'right', sortValue: (v) => monthSpend(d.expenses.filter((e) => e.vendorId === v.id), month), render: (v) => <span className="num">{money(monthSpend(d.expenses.filter((e) => e.vendorId === v.id), month))}</span> },
  ];
  const n = (s: VendorStatus) => d.vendors.filter((v) => v.status === s).length;

  return (
    <>
      <CostsHead title="Vendors" sub="The services GoBye pays for or will pay for, with the plan each is on today." actions={<Button variant="primary" icon="add" onClick={() => setEdit('new')} disabledReason={canManage ? undefined : 'Needs cost management access'}>Add vendor</Button>} />
      <div className="grid cols-4">
        <Stat icon="store" label="Vendors" value={d.vendors.length.toLocaleString('en-NG')} sub="Listed" />
        <Stat icon="checkCircle" label="On free plans" value={n('free_plan').toLocaleString('en-NG')} sub="₦0 until an invoice arrives" />
        <Stat icon="time" label="Not chosen or proposed" value={(n('not_chosen') + n('proposed')).toLocaleString('en-NG')} sub="Decisions still open" />
        <Stat icon="plugin" label="Billing connected" value="0" sub="Costs are entered by hand" />
      </div>
      <div className="section">
        <FilterBar count={`${rows.length} of ${d.vendors.length}`}>
          <Select<VendorStatus | 'all'> label="Plan status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Every status' }, ...(Object.keys(VENDOR_STATUS) as VendorStatus[]).map((s) => ({ value: s, label: VENDOR_STATUS[s].text }))]} />
        </FilterBar>
        <Card flush>
          <Table rows={rows} columns={columns} rowKey={(v) => v.id} onRowClick={canManage ? (v) => setEdit(v) : undefined} caption="Vendors" />
        </Card>
      </div>
      {edit ? <VendorForm vendor={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function VendorForm({ vendor, onClose }: { vendor?: Vendor; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState<VendorInput>(vendor ? { name: vendor.name, category: vendor.category, plan: vendor.plan, status: vendor.status, currency: vendor.currency, owner: vendor.owner, note: vendor.note } : { name: '', category: 'backend_hosting', plan: '', status: 'not_chosen', currency: 'USD', owner: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<VendorInput>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    const e = validateVendor(f);
    setErr(e);
    if (e) return;
    const r = await act({
      label: vendor ? 'Update vendor' : 'Add vendor',
      apply: (draft) => saveVendor(draft, f, vendor?.id),
      audit: () => ({
        action: vendor ? 'vendor.updated' : 'vendor.added',
        target: { type: 'config', id: vendor?.id ?? 'vendor', label: `Vendor ${f.name}` },
        summary: `${vendor ? 'Updated' : 'Added'} vendor ${f.name}`,
        diff: vendor ? (['plan', 'status', 'owner'] as const).filter((k) => vendor[k] !== f[k]).map((k) => ({ field: k, from: String(vendor[k]), to: String(f[k]) })) : undefined,
      }),
    });
    if (r.ok) onClose();
  };
  return (
    <Drawer title={vendor ? vendor.name : 'Add vendor'} sub="Plan and status as they are today. Costs are recorded as expenses." onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="cost-form">
        <Field label="Name" error={err && !f.name.trim() ? err : undefined}>{(id) => <input id={id} className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Select<CostCategory> label="Category" value={f.category} onChange={(v) => set({ category: v })} options={(Object.keys(COST_CATEGORY_LABEL) as CostCategory[]).map((c) => ({ value: c, label: COST_CATEGORY_LABEL[c] }))} />
        <div className="cost-form-row">
          <Field label="Plan">{(id) => <input id={id} className="input" value={f.plan} onChange={(e) => set({ plan: e.target.value })} placeholder="Free, Pro, Not chosen" />}</Field>
          <Select<VendorStatus> label="Status" value={f.status} onChange={(v) => set({ status: v })} options={(Object.keys(VENDOR_STATUS) as VendorStatus[]).map((s) => ({ value: s, label: VENDOR_STATUS[s].text }))} />
          <Select label="Billed in" value={f.currency} onChange={(v) => set({ currency: v as 'NGN' | 'USD' })} options={[{ value: 'USD', label: 'US dollars' }, { value: 'NGN', label: 'Naira' }]} />
        </div>
        <Field label="Looked after by">{(id) => <input id={id} className="input" value={f.owner} onChange={(e) => set({ owner: e.target.value })} />}</Field>
        <Field label="Note">{(id) => <textarea id={id} className="textarea" value={f.note} onChange={(e) => set({ note: e.target.value })} />}</Field>
        {err ? <div className="field"><span className="error" role="alert">{err}</span></div> : null}
      </div>
    </Drawer>
  );
}
