import { router, type Href } from 'expo-router';

/**
 * Replace the whole stack with `href` so Android back can't return to finished flows
 * (sign-in, booking steps, payment).
 */
export function resetTo(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/** Screen that shows a live booking in its current status (used by Home banner and Activity). */
export function liveRoute(status: string) {
  if (status === 'negotiating') return '/booking/negotiate' as const;
  if (status === 'searching' || status === 'no_drivers') return '/booking/searching' as const;
  if (status === 'payment_pending') return '/trip-complete' as const;
  if (status === 'completed') return '/trip-summary' as const; // paid, summary not yet closed
  return '/trip' as const;
}
// End of trip: trip-complete (pay) → trip-paid (success) → trip-summary (rate, receipt).

/**
 * Banner wording for a live booking (Home and Activities). Separates "pay now" from "already paying":
 * a payment being confirmed or a transfer the passenger says they sent must not read as unpaid.
 */
export function liveBannerCopy(b: { status: string; paymentStatus?: string; paymentNotice?: string }, inTrip = 'Current ride') {
  if (b.status === 'completed') return { title: 'Trip paid', action: 'View' };
  if (b.status === 'payment_pending') {
    if (b.paymentStatus === 'processing') return { title: 'Confirming payment', action: 'Open' };
    if (b.paymentStatus === 'pending' && b.paymentNotice) return { title: 'Payment pending', action: 'Check' };
    return { title: 'Payment outstanding', action: 'Pay now' };
  }
  return { title: inTrip, action: 'Open' };
}
