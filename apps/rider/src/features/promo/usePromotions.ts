import { formatNaira, promotionsFor, type Promotion, type PromotionPlacement } from '@gobye/core';
import { useServiceConfig } from '@/state/config';

/**
 * Promotions for a placement, from admin config. The referral card follows the live referral programme:
 * hidden when it's switched off, and its amount always matches the configured reward.
 */
export function usePromotions(placement: PromotionPlacement): Promotion[] {
  const config = useServiceConfig();
  return promotionsFor(config, placement)
    .filter((p) => p.id !== 'referral' || config.referral.enabled)
    .map((p) =>
      p.id === 'referral'
        ? {
            ...p,
            title: `Earn ${formatNaira(config.referral.referrerReward)} per friend`,
            details: [
              'Share your code with a friend.',
              'They sign up and take their first paid trip.',
              `You get ${formatNaira(config.referral.referrerReward)} in your wallet. Up to ${config.referral.maxRewardedReferrals} friends.`,
            ],
          }
        : p,
    );
}

export function usePromotion(id: string): Promotion | undefined {
  const all = [...usePromotions('home'), ...usePromotions('wallet')];
  return all.find((p) => p.id === id);
}
