import { Redirect } from 'expo-router';
import { useDriver } from '@/state/driver';
import { useSession } from '@/state/session';

/**
 * D01 Launch gate: routes by session and any trip in progress (state recovery). Every signed-in driver
 * lands on the dashboard; until they're approved, a card there shows the stage they're at, what's left
 * to register and anything holding up review (D-049). Registration stays one tap away (/onboarding).
 */
export default function LaunchGate() {
  const session = useSession();
  const driver = useDriver();

  if (session.status === 'loading' || !driver.ready) return null;
  if (session.status === 'signed_out') return <Redirect href="/welcome" />;

  const trip = driver.activeTrip;
  if (trip) return <Redirect href={trip.stage === 'completed' ? '/trip-complete' : '/trip'} />;
  return <Redirect href="/(tabs)" />;
}
