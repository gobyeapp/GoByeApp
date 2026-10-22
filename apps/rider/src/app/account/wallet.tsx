import { Redirect } from 'expo-router';

/** Retired route (2026-10-21, D-032): Wallet is its own tab. Redirect kept for old links. */
export default function RetiredAccountWallet() {
  return <Redirect href="/(tabs)/wallet" />;
}
