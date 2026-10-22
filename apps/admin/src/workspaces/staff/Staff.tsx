import { useState } from 'react';
import { APPROVAL_RULES, CITY_LABELS, ROLE_LABELS, isReadOnly, permissionsOf, type ApprovalRequest, type CityId, type PlatformDataset, type StaffMember, type StaffRole } from '@gobye/core';
import { label } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData } from '@/data/store';
import { Button, Card, ConfirmDialog, Drawer, Empty, Field, Notice, PageHead, Pill, SearchInput, Table, type Column, type Tone } from '@/ui/kit';
import { roleRequestNote } from '../approvals/logic';
import { AREA_LABELS, SENSITIVE_ROLES, groupPermissions, planRoleChange, validateInvite, wouldRemoveLastOwner } from './logic';

const ROLES = Object.keys(ROLE_LABELS) as StaffRole[];
const CITIES: CityId[] = ['lagos', 'abuja'];
const STATUS: Record<StaffMember['status'], { tone: Tone; text: string }> = {
  active: { tone: 'success', text: 'Active' },
  invited: { tone: 'warning', text: 'Invite sent' },
  suspended: { tone: 'danger', text: 'Suspended' },
};
const scopeText = (cities: string[]) => (cities.length ? cities.map((c) => CITY_LABELS[c as CityId] ?? c).join(', ') : 'All cities');

export default function Staff() {
  const d = useData();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const manage = can('staff.manage');
  const s = q.trim().toLowerCase();
  const rows = d.staff.filter((x) => !s || x.name.toLowerCase().includes(s) || x.email.toLowerCase().includes(s) || x.roles.some((r) => ROLE_LABELS[r].toLowerCase().includes(s)));
  const selected = openId ? d.staff.find((x) => x.id === openId) : undefined;
  const pendingFor = (id: string) => d.approvals.filter((a) => a.kind === 'staff_role' && a.status === 'pending' && a.target.id === id);

  const columns: Column<StaffMember>[] = [
    { key: 'name', label: 'Name', render: (x) => (<><div className="cell-title">{x.name}</div><div className="cell-sub">{x.email}</div></>) },
    { key: 'roles', label: 'Roles', render: (x) => <span className="small">{x.roles.map((r) => ROLE_LABELS[r]).join(' + ') || 'No roles'}{pendingFor(x.id).length ? <span className="muted"> · role request pending</span> : null}</span> },
    { key: 'city', label: 'City scope', render: (x) => <span className="small">{scopeText(x.cities)}</span> },
    { key: 'status', label: 'Status', render: (x) => <Pill tone={STATUS[x.status].tone}>{STATUS[x.status].text}</Pill> },
  ];

  return (
    <>
      <PageHead
        title="Staff and access"
        sub="Who can sign in, what each person can see and change, and in which cities."
        actions={manage ? <Button variant="primary" icon="userAdd" onClick={() => setInviting(true)}>Invite staff</Button> : null}
      />
      <div className="stack" style={{ gap: 12, marginBottom: 16 }}>
        <Notice icon="info">
          Sign in is simulated in this prototype. Changes here update the staff records; real invites, sign in and sessions come with the backend.
        </Notice>
        {!manage ? <Notice icon="lock">Read only. Only the company owner can invite staff or change access.</Notice> : null}
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, email or role" />
        <span className="muted small">{rows.length} of {d.staff.length}</span>
      </div>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(x) => x.id}
        onRowClick={(x) => setOpenId(x.id)}
        empty={<Card><Empty title="No staff match" icon="group">Clear the search to see everyone.</Empty></Card>}
      />
      <Card muted className="section">
        <div className="small">
          <span className="strong">Roles are permission groups.</span> A person can hold several roles. They get each role’s permissions side by side; roles are never merged into a wider role. Granting owner, finance or developer access needs the company owner.
        </div>
      </Card>
      {selected ? <MemberDrawer key={selected.id} member={selected} pending={pendingFor(selected.id)} onClose={() => setOpenId(null)} /> : null}
      {inviting ? <InviteDrawer onClose={() => setInviting(false)} /> : null}
    </>
  );
}

function RolePicker({ value, onChange, disabled, isOwner }: { value: StaffRole[]; onChange: (r: StaffRole[]) => void; disabled?: boolean; isOwner: boolean }) {
  return (
    <div className="stack tight" role="group" aria-label="Roles">
      {ROLES.map((r) => (
        <label key={r} className="row small" style={{ cursor: disabled ? 'default' : 'pointer', padding: '4px 0' }}>
          <input type="checkbox" disabled={disabled} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          <span style={{ flex: 1 }}>{ROLE_LABELS[r]}</span>
          {SENSITIVE_ROLES.includes(r) && !isOwner ? <span className="muted">Needs owner approval</span> : null}
        </label>
      ))}
    </div>
  );
}

function CityPicker({ value, onChange, disabled }: { value: string[]; onChange: (c: string[]) => void; disabled?: boolean }) {
  return (
    <div className="row wrap" role="group" aria-label="City scope">
      {CITIES.map((c) => (
        <label key={c} className="row small" style={{ cursor: disabled ? 'default' : 'pointer' }}>
          <input type="checkbox" disabled={disabled} checked={value.includes(c)} onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))} />
          {CITY_LABELS[c]}
        </label>
      ))}
      <span className="muted small">{value.length ? '' : 'None ticked means all cities'}</span>
    </div>
  );
}

function roleApproval(draft: PlatformDataset, member: Pick<StaffMember, 'id' | 'name'>, roles: StaffRole[], ctx: { now: number; actor: ApprovalRequest['requestedBy'] }) {
  draft.approvals.push({
    id: `apr-${ctx.now.toString(36)}-${member.id}`,
    kind: 'staff_role',
    title: `Grant ${roles.map((r) => ROLE_LABELS[r]).join(' and ')} to ${member.name}`,
    requestedBy: ctx.actor,
    requestedAt: ctx.now,
    target: { type: 'staff', id: member.id, label: member.name },
    status: 'pending',
    approverRoles: APPROVAL_RULES.staff_role.approverRoles,
    note: roleRequestNote(roles),
  });
}

function MemberDrawer({ member, pending, onClose }: { member: StaffMember; pending: ApprovalRequest[]; onClose: () => void }) {
  const d = useData();
  const { can, staff: me } = useSession();
  const act = useAction();
  const manage = can('staff.manage');
  const isOwner = !!me?.roles.includes('owner');
  const [roles, setRoles] = useState<StaffRole[]>(member.roles);
  const [cities, setCities] = useState<string[]>(member.cities);
  const [confirm, setConfirm] = useState<'suspend' | 'reactivate' | null>(null);
  const preview = { roles, status: 'active' as const };
  const groups = groupPermissions(permissionsOf(preview));
  const dirty = roles.slice().sort().join() !== member.roles.slice().sort().join() || cities.slice().sort().join() !== member.cities.slice().sort().join();
  const plan = planRoleChange(member.roles, roles, isOwner);
  const lastOwner = wouldRemoveLastOwner(d.staff, member.id, { roles });
  const self = me?.id === member.id;

  const save = async () => {
    const r = await act(
      {
        label: 'Change staff access',
        apply: (draft, ctx) => {
          const x = draft.staff.find((s) => s.id === member.id);
          if (!x) return { ok: false, error: 'Staff member not found' };
          if (!roles.length) return { ok: false, error: 'Keep at least one role, or suspend the account instead' };
          if (wouldRemoveLastOwner(draft.staff, member.id, { roles: plan.applyNow })) return { ok: false, error: 'There must always be an active company owner' };
          x.roles = plan.applyNow;
          x.cities = cities;
          if (plan.pending.length) roleApproval(draft, x, plan.pending, { now: ctx.now, actor: ctx.actor });
          return { ok: true };
        },
        audit: () => ({
          action: 'staff.access_changed',
          target: { type: 'staff', id: member.id, label: member.name },
          summary: `Changed access for ${member.name}${plan.pending.length ? `; requested ${plan.pending.map((r) => ROLE_LABELS[r]).join(', ')} for approval` : ''}`,
          diff: [
            { field: 'Roles', from: member.roles.map((r) => ROLE_LABELS[r]).join(', ') || 'None', to: plan.applyNow.map((r) => ROLE_LABELS[r]).join(', ') || 'None' },
            ...(cities.join() !== member.cities.join() ? [{ field: 'City scope', from: scopeText(member.cities), to: scopeText(cities) }] : []),
          ],
        }),
      },
      plan.pending.length ? 'Saved. The sensitive roles are waiting for owner approval.' : 'Access updated',
    );
    // Pending roles live on the approval request now, not in the form.
    if (r.ok) setRoles(plan.applyNow);
  };

  const setStatus = async (reason: string) => {
    const to: StaffMember['status'] = confirm === 'suspend' ? 'suspended' : 'active';
    const r = await act(
      {
        label: confirm === 'suspend' ? 'Suspend staff' : 'Reactivate staff',
        apply: (draft) => {
          const x = draft.staff.find((s) => s.id === member.id);
          if (!x) return { ok: false, error: 'Staff member not found' };
          if (to === 'suspended' && wouldRemoveLastOwner(draft.staff, x.id, { status: 'suspended' })) return { ok: false, error: 'There must always be an active company owner' };
          x.status = to;
          return { ok: true };
        },
        audit: () => ({
          action: to === 'suspended' ? 'staff.suspended' : 'staff.reactivated',
          target: { type: 'staff', id: member.id, label: member.name },
          summary: `${to === 'suspended' ? 'Suspended' : 'Reactivated'} ${member.name}`,
          diff: [{ field: 'Status', from: label(member.status), to: label(to) }],
          reason,
        }),
      },
      to === 'suspended' ? 'Suspended. They can’t sign in.' : 'Reactivated',
    );
    if (r.ok) setConfirm(null);
  };

  return (
    <Drawer
      title={member.name}
      sub={`${member.email} · ${scopeText(member.cities)}`}
      onClose={onClose}
      footer={
        manage ? (
          <>
            {member.status === 'suspended' ? (
              <Button onClick={() => setConfirm('reactivate')} icon="refresh">Reactivate</Button>
            ) : (
              <Button variant="danger-soft" icon="userForbid" onClick={() => setConfirm('suspend')} disabledReason={self ? 'You can’t suspend yourself' : undefined}>Suspend</Button>
            )}
            <Button
              variant="primary"
              icon="check"
              onClick={save}
              disabledReason={!dirty ? 'No changes yet' : !roles.length ? 'Choose at least one role' : lastOwner ? 'There must always be an active company owner' : undefined}
            >
              {plan.pending.length ? 'Save and request approval' : 'Save access'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="row wrap">
        <Pill tone={STATUS[member.status].tone}>{STATUS[member.status].text}</Pill>
        {isReadOnly(member.roles) ? <Pill tone="neutral" icon="eye">Read only</Pill> : null}
      </div>
      {pending.length ? (
        <Notice tone="warning">
          Waiting for owner approval: {pending.map((a) => a.title).join('; ')}.
        </Notice>
      ) : null}
      <Field label="Roles" hint={manage ? undefined : 'Only the company owner can change roles.'}>
        {() => <RolePicker value={roles} onChange={setRoles} disabled={!manage} isOwner={isOwner} />}
      </Field>
      <Field label="City scope">{() => <CityPicker value={cities} onChange={setCities} disabled={!manage} />}</Field>
      {plan.pending.length && manage ? (
        <Notice tone="info">{plan.pending.map((r) => ROLE_LABELS[r]).join(' and ')} will be requested for approval, not granted now.</Notice>
      ) : null}
      {isOwner && manage && SENSITIVE_ROLES.some((r) => roles.includes(r) && !member.roles.includes(r)) ? (
        <Notice tone="info">As the owner, your grant applies now and is recorded in the audit trail.</Notice>
      ) : null}
      <div>
        <h3 className="strong" style={{ marginBottom: 4 }}>Effective permissions</h3>
        <div className="small muted" style={{ marginBottom: 10 }}>
          {member.status === 'active' ? 'What this person can do with the roles above.' : member.status === 'invited' ? 'Applies once the invite is accepted.' : 'No access while suspended. This is what they would get back.'}
          {dirty ? ' Includes your unsaved changes.' : ''}
        </div>
        {groups.length ? (
          <div className="stack">
            {groups.map(([area, actions]) => (
              <div key={area} className="row wrap" style={{ alignItems: 'flex-start' }}>
                <span className="small strong" style={{ width: 130 }}>{AREA_LABELS[area] ?? label(area)}</span>
                <span className="row wrap" style={{ gap: 6, flex: 1 }}>
                  {actions.map((a) => (
                    <Pill key={a} tone={a === 'view' ? 'neutral' : 'info'} icon={a === 'view' ? 'eye' : 'edit'}>{label(a)}</Pill>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No permissions" icon="lock">Add a role to give access.</Empty>
        )}
      </div>
      {confirm ? (
        <ConfirmDialog
          title={confirm === 'suspend' ? `Suspend ${member.name}?` : `Reactivate ${member.name}?`}
          body={confirm === 'suspend' ? 'They lose all access straight away. Their past actions stay in the audit trail.' : 'Their roles apply again as shown.'}
          confirmLabel={confirm === 'suspend' ? 'Suspend' : 'Reactivate'}
          danger={confirm === 'suspend'}
          requireReason
          onConfirm={setStatus}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </Drawer>
  );
}

function InviteDrawer({ onClose }: { onClose: () => void }) {
  const d = useData();
  const { staff: me } = useSession();
  const act = useAction();
  const isOwner = !!me?.roles.includes('owner');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const errors = validateInvite({ name, email, roles }, d.staff);
  const plan = planRoleChange([], roles, isOwner);

  const send = async () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    const r = await act(
      {
        label: 'Invite staff',
        apply: (draft, ctx) => {
          const e = validateInvite({ name, email, roles }, draft.staff);
          if (Object.keys(e).length) return { ok: false, error: Object.values(e)[0]! };
          const m: StaffMember = { id: `stf-${ctx.now.toString(36)}`, name: name.trim(), email: email.trim().toLowerCase(), roles: plan.applyNow, cities, status: 'invited' };
          draft.staff.push(m);
          if (plan.pending.length) roleApproval(draft, m, plan.pending, { now: ctx.now, actor: ctx.actor });
          return { ok: true };
        },
        audit: (draft) => {
          const m = draft.staff[draft.staff.length - 1]!;
          return {
            action: 'staff.invited',
            target: { type: 'staff', id: m.id, label: m.name },
            summary: `Invited ${m.name} as ${roles.map((r) => ROLE_LABELS[r]).join(' + ')} (${scopeText(cities)})${plan.pending.length ? '; sensitive roles sent for approval' : ''}`,
          };
        },
      },
      'Invite recorded (simulated: no email is sent)',
    );
    if (r.ok) onClose();
  };

  return (
    <Drawer
      title="Invite staff"
      sub="Simulated: the invite is recorded, no email is sent."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="userAdd" onClick={send}>{plan.pending.length ? 'Invite and request approval' : 'Send invite'}</Button>
        </>
      }
    >
      <Field label="Name" error={tried ? errors.name : undefined}>
        {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
      </Field>
      <Field label="Work email" error={tried ? errors.email : undefined}>
        {(id) => <input id={id} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Roles" error={tried ? errors.roles : undefined} hint="Tick every job this person does. Each role adds its own permissions.">
        {() => <RolePicker value={roles} onChange={setRoles} isOwner={isOwner} />}
      </Field>
      <Field label="City scope">{() => <CityPicker value={cities} onChange={setCities} />}</Field>
      {plan.pending.length ? <Notice tone="info">{plan.pending.map((r) => ROLE_LABELS[r]).join(' and ')} will wait for owner approval.</Notice> : null}
    </Drawer>
  );
}
