import { createClient } from '@supabase/supabase-js';
import type { SupabaseAuthLike } from './types';

/**
 * The Supabase client for the apps (WP2). Only the public project URL and the publishable / anon key are
 * used (EXPO_PUBLIC_*, public by design). Sessions live in the Keychain / Keystore via `storage`, refresh
 * automatically, and links are not read from the URL (no web redirects in the apps).
 */
export function createSupabaseAuth(o: {
  url: string;
  anonKey: string;
  storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
}): { auth: SupabaseAuthLike; startAutoRefresh(): void; stopAutoRefresh(): void } {
  const client = createClient(o.url, o.anonKey, {
    auth: { storage: o.storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  return {
    auth: client.auth as unknown as SupabaseAuthLike,
    startAutoRefresh: () => void client.auth.startAutoRefresh(),
    stopAutoRefresh: () => void client.auth.stopAutoRefresh(),
  };
}

/** The current access token, refreshed when needed: what the API client sends as the bearer token. */
export async function currentAccessToken(auth: SupabaseAuthLike): Promise<string | null> {
  const r = await auth.getSession();
  return r.data.session?.access_token ?? null;
}
