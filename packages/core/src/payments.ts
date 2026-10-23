import { kobo, naira } from './money';
import type {
  DriverAccessPackage,
  DriverSubscription,
  Kobo,
  PaymentCharge,
  PaymentMethod,
  PaymentMethodType,
  PaymentsConfig,
} from './types';

/**
 * MOCK PAYMENTS CONFIGURATION.
 * - Launch methods (Q-001): GoBye Wallet + bank transfer. Cash is an open decision → disabled.
 * - Processing fees are PLACEHOLDERS (provider not chosen). Bank transfers go straight to the driver's
 *   account (0% commission), so GoBye adds no fee; the passenger's own bank may charge for the transfer.
 *   The separate-disclosure machinery stays for any provider fee approved later.
 */
export const MOCK_PAYMENTS_CONFIG: PaymentsConfig = {
  enabledMethods: { wallet: true, bank_transfer: true, cash: false },
  processingFees: {
    wallet: { fixed: kobo(0), percent: 0, bearer: 'platform' },
    bank_transfer: { fixed: kobo(0), percent: 0, bearer: 'passenger' },
    cash: { fixed: kobo(0), percent: 0, bearer: 'platform' },
  },
};

/**
 * Driver access packages. CONFIRMED by the owner (2026-10-23): daily ₦2,000 for 24 hours from successful
 * activation, monthly ₦60,000 for 30 consecutive days. Trip commission stays 0% (BR-060).
 */
export const DRIVER_ACCESS_PACKAGES: readonly DriverAccessPackage[] = [
  { id: 'daily', name: 'Daily access', price: naira(2000), durationDays: 1, provisional: false },
  { id: 'monthly', name: 'Monthly access', price: naira(60000), durationDays: 30, provisional: false },
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  wallet: 'GoBye Wallet',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
};

export function isMethodEnabled(type: PaymentMethodType, config: PaymentsConfig = MOCK_PAYMENTS_CONFIG): boolean {
  return config.enabledMethods[type];
}

export function enabledMethods(methods: PaymentMethod[], config: PaymentsConfig = MOCK_PAYMENTS_CONFIG): PaymentMethod[] {
  return methods.filter((m) => isMethodEnabled(m.type, config));
}

/** Processing fee for a fare, rounded to the nearest kobo and capped. */
export function processingFee(fare: Kobo, type: PaymentMethodType, config: PaymentsConfig = MOCK_PAYMENTS_CONFIG): Kobo {
  const rule = config.processingFees[type];
  const raw = rule.fixed + Math.round(fare * rule.percent);
  return kobo(rule.cap !== undefined ? Math.min(raw, rule.cap) : raw);
}

/**
 * What the passenger is charged. The fare is never changed by the payment method; only a
 * passenger-borne processing fee is added, and it is reported separately for disclosure.
 */
export function paymentCharge(fare: Kobo, type: PaymentMethodType, config: PaymentsConfig = MOCK_PAYMENTS_CONFIG): PaymentCharge {
  const fee = processingFee(fare, type, config);
  const passengerFee = config.processingFees[type].bearer === 'passenger' ? fee : kobo(0);
  return { fare, processingFee: passengerFee, total: kobo(fare + passengerFee) };
}

/** Wallet must cover the full charge before a wallet booking is submitted. */
export function walletCovers(balance: Kobo, charge: PaymentCharge): boolean {
  return balance >= charge.total;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function subscribe(pkg: DriverAccessPackage, now: number, current?: DriverSubscription | null): DriverSubscription {
  // Buying while active extends from the current expiry rather than overlapping.
  const startsAt = current && current.expiresAt > now ? current.expiresAt : now;
  return { packageId: pkg.id, startsAt, expiresAt: startsAt + pkg.durationDays * DAY_MS };
}

/** A driver can go online only with active access (BR-072). */
export function hasActiveAccess(sub: DriverSubscription | null | undefined, now: number): boolean {
  return !!sub && sub.startsAt <= now && sub.expiresAt > now;
}
