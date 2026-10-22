import { naira } from './money';
import type { CategoryConfig, ServiceConfig, VehicleCategoryId } from './types';

/**
 * MOCK ADMIN SERVICE CONFIGURATION (brief §5, §12).
 * Launch: cars only, ONE enabled car category. Keke and other categories exist but are disabled;
 * the admin dashboard enables and configures them later. Referral values are placeholders.
 */
export const MOCK_SERVICE_CONFIG: ServiceConfig = {
  categories: [
    { id: 'go', enabled: true, name: 'GoBye Car', seats: 4, description: 'Comfortable everyday car rides', image: 'sedan', sortOrder: 1 },
    { id: 'comfort', enabled: false, name: 'GoBye Comfort', seats: 4, description: 'Newer cars, top rated drivers', image: 'sedan', sortOrder: 2 },
    { id: 'xl', enabled: false, name: 'GoBye XL', seats: 6, description: 'Room for groups and luggage', image: 'sedan', sortOrder: 3 },
    { id: 'keke', enabled: false, name: 'GoBye Keke', seats: 3, description: 'Tricycle for short hops', image: 'sedan', sortOrder: 4 },
  ],
  referral: {
    enabled: true,
    qualifyingRule: 'first_completed_paid_trip',
    qualifyingDescription: 'Your friend signs up with your code and completes their first paid trip.',
    referrerReward: naira(500),
    maxRewardedReferrals: 10,
    inviteExpiryDays: 30,
    rewardExpiryDays: 90,
    link: 'https://gobye.app/invite',
  },
  pickupPin: { enabled: true, digits: 4 },
  // Genuine product campaigns only (no invented discounts). Copy and order are admin managed.
  promotions: {
    autoAdvanceSeconds: 6,
    items: [
      {
        id: 'referral',
        enabled: true,
        placements: ['home', 'wallet'],
        title: 'Earn ₦500 per friend',
        body: 'When a friend takes their first paid trip.',
        art: 'gift',
        details: ['Share your code with a friend.', 'They sign up and take their first paid trip.', 'You get ₦500 in your wallet. Up to 10 friends.'],
        action: { label: 'Invite friends', route: '/account/rewards' },
        sortOrder: 1,
      },
      {
        id: 'wallet-topup',
        enabled: true,
        placements: ['home', 'wallet'],
        title: 'Pay in one tap',
        body: 'Add money to your wallet before your ride.',
        art: 'wallet',
        details: ['Add money by bank transfer.', 'It’s added once the transfer is confirmed.', 'Pay for trips from your wallet in one tap.'],
        action: { label: 'Add money', route: '/(tabs)/wallet?add=1' },
        sortOrder: 2,
      },
      {
        id: 'book-for-others',
        enabled: true,
        placements: ['home'],
        title: 'Book for someone else',
        body: 'Get a ride for family or a friend.',
        art: 'sedan',
        details: ['Tap “For me” on Home and choose Someone else.', 'Add their name and phone number.', 'Share the pickup PIN with them.'],
        action: { label: 'Book a ride', route: '/(tabs)' },
        sortOrder: 3,
      },
    ],
  },
  isSimulated: true,
};

export function promotionsFor(config: ServiceConfig, placement: 'home' | 'wallet') {
  return config.promotions.items.filter((p) => p.enabled && p.placements.includes(placement)).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function enabledCategories(config: ServiceConfig): CategoryConfig[] {
  return config.categories.filter((c) => c.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function categoryName(config: ServiceConfig, id: VehicleCategoryId): string {
  return config.categories.find((c) => c.id === id)?.name ?? id;
}

/** Random numeric PIN of the configured length. */
export function generatePickupPin(digits: number, random: () => number = Math.random): string {
  let pin = '';
  for (let i = 0; i < digits; i++) pin += Math.floor(random() * 10).toString();
  return pin;
}

/** Wallet figures: reserved = pending debits; available = settled balance − reserved. */
export function walletSummary(transactions: { amount: number; status: string }[]) {
  const settled = transactions.filter((t) => t.status === 'successful').reduce((s, t) => s + t.amount, 0);
  const reserved = -transactions.filter((t) => t.status === 'pending' && t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const pendingIn = transactions.filter((t) => t.status === 'pending' && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  return { settled, reserved, available: settled - reserved, pendingIn };
}
