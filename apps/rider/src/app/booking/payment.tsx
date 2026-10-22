import { Redirect } from 'expo-router';

/**
 * Retired route (2026-10-21, D-030): the payment-method picker is now a sheet on the Confirm payment
 * screen after the trip. Kept only as a redirect so old links and stale copies of the file don't break.
 */
export default function RetiredPaymentPicker() {
  return <Redirect href="/(tabs)" />;
}
