import { useState } from 'react';
import { HOSTING_PARTS, hostingCost } from '@gobye/core';
import { when } from '@/data/format';
import { useSession } from '@/data/session';
import { useAction, useData, usePlatform } from '@/data/store';
import { Kpi } from '@/ui/charts';
import { Button, ConfirmDialog, PageHead, Pill } from '@/ui/kit';

/**
 * Hosting (D-072, D-073): what runs where, and the owner's switch for the paid parts. The switch records
 * the approval; Cloudflare's paid plan and the API deploy are the owner's own steps that follow it.
 */
export default function Hosting() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const act = useAction();
  const [asking, setAsking] = useState(false);
  const on = d.paidHosting.enabled;
  const owner = can('staff.manage');
  const free = HOSTING_PARTS.filter((p) => p.tier === 'free');
  const paid = HOSTING_PARTS.filter((p) => p.tier === 'paid');

  const flip = () =>
    act(
      {
        label: on ? 'Turn off paid hosting' : 'Turn on paid hosting',
        apply: (draft, ctx) => {
          draft.paidHosting = { enabled: !on, changedAt: ctx.now, changedBy: ctx.actor.kind === 'staff' ? ctx.actor.name : 'system' };
          return { ok: true };
        },
        audit: () => ({
          action: on ? 'hosting.paid_off' : 'hosting.paid_on',
          target: { type: 'config', id: 'paid-hosting', label: 'Paid hosting' },
          summary: on ? 'Paid hosting turned off' : 'Paid hosting approved',
          diff: [{ field: 'Paid hosting', from: on ? 'On' : 'Off', to: on ? 'Off' : 'On' }],
        }),
      },
      on ? 'Paid hosting turned off' : 'Paid hosting approved',
    );

  return (
    <>
      <PageHead title="Hosting" sub="What runs where, and the switch for the paid parts." />
      <div className="kpi-grid">
        <Kpi label="Monthly hosting" value={`$${hostingCost(HOSTING_PARTS, on)}`} foot={on ? 'Free and paid parts' : 'Free parts only'} />
        <Kpi label="Free parts" value={free.length} foot="Cloudflare and Supabase" />
        <Kpi label="Paid parts" value={on ? 'On' : 'Off'} foot={`$${paid.reduce((s, p) => s + p.monthlyUsd, 0)} a month when on`} />
        <Kpi label="Last change" value={d.paidHosting.changedAt ? when(d.paidHosting.changedAt, now()) : 'Never'} foot={d.paidHosting.changedBy ?? 'Off since setup'} />
      </div>

      <section className="section panel">
        <div className="panel-head">
          <h3>Paid hosting</h3>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Paid hosting"
            className={`switch ${on ? 'on' : ''}`}
            disabled={!owner}
            title={owner ? undefined : 'Only the owner can change this'}
            onClick={() => setAsking(true)}
          >
            <span />
          </button>
        </div>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Provider</th>
              <th className="right">Monthly</th>
              <th>Status</th>
              <th>How</th>
            </tr>
          </thead>
          <tbody>
            {HOSTING_PARTS.map((p) => (
              <tr key={p.id}>
                <td className="strong">{p.label}</td>
                <td>{p.provider}</td>
                <td className="right num">${p.monthlyUsd}</td>
                <td>{p.tier === 'free' ? <Pill tone="success">Free</Pill> : on ? <Pill tone="info">Approved</Pill> : <Pill tone="neutral">Off</Pill>}</td>
                <td className="small muted">{p.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {on ? <p className="small muted">Next: turn on Workers Paid in Cloudflare, then run Deploy API (staging) in GitHub Actions.</p> : null}
      </section>

      {asking ? (
        <ConfirmDialog
          title={on ? 'Turn off paid hosting?' : 'Turn on paid hosting?'}
          body={on ? 'The API servers and file storage should be stopped in Cloudflare after this.' : `About $${paid.reduce((s, p) => s + p.monthlyUsd, 0)} a month. After this, turn on Workers Paid in Cloudflare and run the API deploy.`}
          confirmLabel={on ? 'Turn off' : 'Turn on'}
          danger={on}
          onConfirm={async () => {
            await flip();
            setAsking(false);
          }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
      <div className="section">
        <Button variant="ghost" icon="link" onClick={() => void window.open('https://dash.cloudflare.com/', '_blank', 'noopener')}>Open Cloudflare</Button>
      </div>
    </>
  );
}
