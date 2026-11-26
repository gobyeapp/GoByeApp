import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createApiClient, describeConfigProblems, parsePublicConfig, type ApiClient, type PublicConfig, type StaffMember, type StaffRole } from '@gobye/core';

/**
 * Real staff sign-in and the GoBye API (Backend Phase 2, WP4, D-081). On when the build sets
 * VITE_AUTH=supabase with VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_API_BASE_URL.
 * Otherwise the admin keeps its staff picker and its own dataset (the default).
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;
const parsed = parsePublicConfig(
  Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('VITE_') && !k.startsWith('VITE_DEMO_'))),
  'vite',
);
export const liveConfigProblems = parsed.ok ? '' : describeConfigProblems(parsed.error);
const config: PublicConfig | null = parsed.ok && parsed.value.auth === 'supabase' && parsed.value.supabase ? parsed.value : null;

export interface Live {
  supabase: SupabaseClient;
  api: ApiClient;
}

export const LIVE: Live | null = config
  ? (() => {
      const supabase = createClient(config.supabase!.url, config.supabase!.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'gobye.admin.auth' } });
      const api = createApiClient({
        baseUrl: config.apiBaseUrl,
        client: 'admin/0.1.0',
        getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      });
      return { supabase, api };
    })()
  : null;

/** The staff part of GET /v1/me (API_CONTRACTS.md §10). */
interface MeStaff {
  id: string;
  name: string;
  email: string;
  roles: StaffRole[];
  cities: string[];
  status: 'active' | 'suspended' | 'removed';
  mfaRequired: boolean;
}

/** Where sign-in is: password, then a code from the authenticator app (set one up the first time). */
export type SignInStep =
  | { step: 'password' }
  | { step: 'code'; factorId: string }
  | { step: 'enrol'; factorId: string; qr: string; secret: string }
  | { step: 'done'; staff: StaffMember };

const fail = (error: string) => ({ ok: false as const, error });

/** After the password or the code: where the person goes next. */
export async function nextStep(live: Live): Promise<{ ok: true; value: SignInStep } | { ok: false; error: string }> {
  const aal = await live.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.error) return fail('Sign in again.');
  if (aal.data.currentLevel !== 'aal2') {
    const factors = await live.supabase.auth.mfa.listFactors();
    const totp = factors.data?.totp.find((f) => f.status === 'verified');
    if (totp) return { ok: true, value: { step: 'code', factorId: totp.id } };
    // First sign-in: set up an authenticator app. Unfinished set-ups are removed so the name stays free.
    for (const f of factors.data?.all ?? []) if (f.status === 'unverified') await live.supabase.auth.mfa.unenroll({ factorId: f.id });
    const en = await live.supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'GoBye admin' });
    if (en.error) return fail('Two-step sign-in can’t be set up right now. Ask a developer to check Supabase Auth settings.');
    return { ok: true, value: { step: 'enrol', factorId: en.data.id, qr: en.data.totp.qr_code, secret: en.data.totp.secret } };
  }
  const me = await live.api.get<{ staff: MeStaff | null }>('/me');
  if (!me.ok) return fail(me.error.message);
  const s = me.value.staff;
  if (!s || s.status !== 'active') {
    await live.supabase.auth.signOut();
    return fail('This account isn’t a GoBye staff account. Ask an admin to invite you.');
  }
  return { ok: true, value: { step: 'done', staff: { id: s.id, name: s.name, email: s.email, roles: s.roles, cities: s.cities, status: 'active', twoStep: true } } };
}

export async function signInWithPassword(live: Live, email: string, password: string) {
  const r = await live.supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (r.error) return fail(r.error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'That email and password don’t match a staff account.');
  return nextStep(live);
}

export async function verifyCode(live: Live, factorId: string, code: string) {
  const r = await live.supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (r.error) return fail('That code didn’t work. Check the time on your phone and try the newest code.');
  return nextStep(live);
}
