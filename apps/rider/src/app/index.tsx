import { Redirect } from 'expo-router';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useSession } from '@/state/session';

/** R01 — Launch gate: routes by session and restores any active booking (state recovery). */
export default function LaunchGate() {
  const session = useSession();
  const { booking, hydrated } = useBooking();
  const account = useAccount();

  if (session.status === 'loading' || !hydrated || !account.ready) return null;
  if (!session.onboardingSeen) return <Redirect href="/onboarding" />;
  // Signed out: the welcome (Create account / Sign in).
  if (session.status === 'signed_out') return <Redirect href="/onboarding" />;
  if (session.status === 'needs_profile') return <Redirect href="/auth/name" />;

  switch (booking?.status) {
    case 'searching':
    case 'no_drivers':
      return <Redirect href="/booking/searching" />;
    case 'negotiating':
      return <Redirect href="/booking/negotiate" />;
    case 'matched':
    case 'driver_en_route':
    case 'driver_arrived':
    case 'in_progress':
      return <Redirect href="/trip" />;
    case 'payment_pending':
      // Completion and payment are separate (D-030): the completion screen is where the trip is paid.
      return <Redirect href="/trip-complete" />;
    case 'completed':
      return <Redirect href="/trip-summary" />;
    default:
      return <Redirect href="/(tabs)" />;
  }
}
