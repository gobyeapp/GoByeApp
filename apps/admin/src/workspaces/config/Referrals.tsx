import { useMemo } from 'react';
import { versionInForce } from '@gobye/core';
import { count, money, pct, when } from '@/data/format';
import { useSession } from '@/data/session';
import { useData, usePlatform } from '@/data/store';
import { Card, Meter, Notice, PageHead, Stat } from '@/ui/kit';
import { Check, NumberField } from './fields';
import { describeReferrals, nairaText, normalizeReferrals, referralSpend, validateReferrals, versionsOf, type ReferralRules } from './logic';
import { VersionedSettings } from './VersionedSettings';

/** Rewards and referrals (key `referrals`). Spend comes from the ledger, never typed in. */
export default function Referrals() {
  const d = useData();
  const { now } = usePlatform();
  const { can } = useSession();
  const t = now();
  const current = normalizeReferrals(versionInForce(versionsOf(d.configVersions, 'referrals'), t)?.value);
  const spend = useMemo(() => referralSpend(d.ledger), [d.ledger]);
  const spentNaira = spend.spentKobo / 100;
  const showMoney = can('finance.view') || can('ledger.view') || can('referrals.manage') || can('config.publish');
  const remaining = Math.max(0, current.budget - spentNaira);
  const used = current.budget > 0 ? spentNaira / current.budget : 0;

  return (
    <>
      <PageHead title="Rewards and referrals" sub="A passenger earns a wallet reward when a friend they invited completes a first paid trip. Signing up alone earns nothing." />
      {showMoney ? (
        <div className="grid cols-4" style={{ marginBottom: 20 }}>
          <Stat label="Spent" value={money(spend.spentKobo)} sub={`of ${nairaText(current.budget)} budget`} tone={used >= 0.9 ? 'warning' : undefined} />
          <Stat label="Rewards paid" value={count(spend.rewards)} sub={spend.lastAt ? `Last ${when(spend.lastAt, t).toLowerCase()}` : 'None yet'} />
          <Stat label="Budget left" value={nairaText(remaining)} sub={current.reward > 0 ? `About ${count(Math.floor(remaining / current.reward))} more rewards` : undefined} />
          <Card>
            <div className="stack tight">
              <span className="muted small strong">Budget used</span>
              <span className="strong num" style={{ fontSize: 24 }}>{pct(used)}</span>
              <Meter value={used} label="Referral budget used" />
              <span className="muted small">From ledger entries: promotions expense, referral reward</span>
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="info" icon="lock">Spending is shown to finance and marketing roles.</Notice>
        </div>
      )}
      {used >= 1 ? (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="danger">The budget is used up. New referrals won’t earn rewards until the budget is raised in a new version.</Notice>
        </div>
      ) : null}
      <VersionedSettings<ReferralRules>
        configKey="referrals"
        name="Referral rules"
        normalize={normalizeReferrals}
        describe={describeReferrals}
        validate={(v) => validateReferrals(v, spentNaira)}
        editPermissions={['config.edit', 'referrals.manage']}
        effect="Rewards already earned keep their value and expiry. Invites shared before the effective date qualify under the rules in force when the friend’s first paid trip completes."
        renderEditor={({ value, onChange }) => (
          <div className="stack" style={{ gap: 14 }}>
            <Check checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })}>
              Referral programme on
            </Check>
            <Notice tone="info" icon="lock">Qualification is fixed: the friend signs up with the code and completes their first paid trip.</Notice>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              <NumberField label="Reward" prefix="₦" value={value.reward} onChange={(reward) => onChange({ ...value, reward })} hint="Credited to the referrer’s wallet" />
              <NumberField label="Most rewarded referrals" suffix="per person" value={value.maxRewarded} min={1} max={100} onChange={(maxRewarded) => onChange({ ...value, maxRewarded })} />
              <NumberField label="Invite expires after" suffix="days" value={value.inviteExpiryDays} min={1} onChange={(inviteExpiryDays) => onChange({ ...value, inviteExpiryDays })} />
              <NumberField label="Reward expires after" suffix="days" value={value.rewardExpiryDays} min={1} onChange={(rewardExpiryDays) => onChange({ ...value, rewardExpiryDays })} />
              <NumberField label="Campaign budget" prefix="₦" step={1000} value={value.budget} onChange={(budget) => onChange({ ...value, budget })} hint={`Already spent ${nairaText(spentNaira)}`} />
            </div>
          </div>
        )}
      />
    </>
  );
}
