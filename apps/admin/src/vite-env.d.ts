/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Demo relay (D-049): `npm run demo:relay` writes this to apps/admin/.env.local. */
  readonly VITE_DEMO_RELAY_URL?: string;
  /** Only for a Supabase relay: the project's anon key. */
  readonly VITE_DEMO_RELAY_KEY?: string;
}
