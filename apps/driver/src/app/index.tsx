import { Redirect } from 'expo-router';
import { nextOnboardingStep } from '@gobye/core';
import { useDriver } from '@/state/driver';
import { useSession } from '@/state/session';

/** D01 Launch gate: routes by session, registration status and any trip in progress (state recovery). */
export default function LaunchGate() {
  const session = useSession();
  const driver = useDriver();

  if (session.status === 'loading' || !driver.ready) return null;
  if (session.status === 'signed_out') return <Redirect href="/welcome" />;

  const trip = driver.activeTrip;
  if (trip) return <Redirect href={trip.stage === 'completed' ? '/trip-complete' : '/trip'} />;

  switch (driver.verification) {
    case 'approved':
      return <Redirect href="/(tabs)" />;
    case 'pending_review':
    case 'rejected':
      return <Redirect href="/onboarding/status" />;
    default:
      return <Redirect href={nextOnboardingStep(driver.application) === 'personal' ? '/onboarding/personal' : '/onboarding'} />;
  }
}
