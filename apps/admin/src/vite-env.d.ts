/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** D-070: show demo only tools (simulate provider events, reset data). Unset in production. */
  readonly VITE_DEMO_TOOLS?: string;
  /** Demo relay (D-049): `npm run demo:relay` writes this to apps/admin/.env.local. */
  readonly VITE_DEMO_RELAY_URL?: string;
  /** Only for a Supabase relay: the project's anon key. */
  readonly VITE_DEMO_RELAY_KEY?: string;
}
