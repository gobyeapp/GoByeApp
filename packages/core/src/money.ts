import type { Kobo } from './types';

/** Create a Kobo value from an integer number of kobo. Throws on non-integers. */
export function kobo(value: number): Kobo {
  if (!Number.isInteger(value)) {
    throw new Error(`Kobo must be an integer, received ${value}`);
  }
  return value as Kobo;
}

/** Convert whole/fractional naira to kobo, rounding half away from zero to the nearest kobo. */
export function naira(value: number): Kobo {
  return kobo(Math.round(value * 100));
}

export function toNaira(amount: Kobo): number {
  return amount / 100;
}

export function addKobo(...amounts: Kobo[]): Kobo {
  return kobo(amounts.reduce<number>((sum, a) => sum + a, 0));
}

/** Round up to the next multiple of `step` (BR-002). */
export function roundUpTo(amount: Kobo, step: Kobo): Kobo {
  if (step <= 0) return amount;
  return kobo(Math.ceil(amount / step) * step);
}

/** Round down to the previous multiple of `step`. */
export function roundDownTo(amount: Kobo, step: Kobo): Kobo {
  if (step <= 0) return amount;
  return kobo(Math.floor(amount / step) * step);
}

const groupFormatter = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Format kobo as Nigerian naira (BR-003): `₦3,450` or `₦3,450.50`.
 * Implemented without Intl so output is identical on Hermes, iOS and Android.
 */
export function formatNaira(amount: Kobo, options: { signed?: boolean } = {}): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const body = `₦${groupFormatter(whole)}${fraction ? `.${fraction.toString().padStart(2, '0')}` : ''}`;
  if (negative) return `−${body}`;
  return options.signed && amount > 0 ? `+${body}` : body;
}

/** Spoken form for screen readers, e.g. "3,450 naira". */
export function nairaAccessibilityLabel(amount: Kobo): string {
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const sign = amount < 0 ? 'minus ' : '';
  return `${sign}${groupFormatter(whole)} naira${fraction ? ` ${fraction} kobo` : ''}`;
}
