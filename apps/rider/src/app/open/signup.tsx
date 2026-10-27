import { Redirect } from 'expo-router';

/** Deep link from WhatsApp for a number without an account (D-064): the normal start of the app. */
export default function OpenSignup() {
  return <Redirect href="/" />;
}
