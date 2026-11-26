/**
 * The parts of Supabase Auth (`supabase.auth`) this package uses, typed structurally so tests can pass a
 * fake and the app passes the real client. Matches @supabase/supabase-js v2.
 */
export interface SbError {
  message: string;
  code?: string;
  status?: number;
}

export interface SbUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at: string;
  user_metadata?: Record<string, unknown>;
}

export interface SbSession {
  access_token: string;
  user: SbUser;
}

type Res<T> = Promise<{ data: T; error: SbError | null }>;

export interface SupabaseAuthLike {
  signUp(c: { phone: string; password: string; options?: { data?: Record<string, unknown> } }): Res<{ user: SbUser | null; session: SbSession | null }>;
  signInWithPassword(c: { email: string; password: string } | { phone: string; password: string }): Res<{ user: SbUser | null; session: SbSession | null }>;
  signInWithOtp(c: { phone: string; options?: { shouldCreateUser?: boolean } }): Res<unknown>;
  resend(c: { type: 'sms'; phone: string }): Res<unknown>;
  verifyOtp(c: { phone: string; token: string; type: 'sms' } | { email: string; token: string; type: 'recovery' }): Res<{ user: SbUser | null; session: SbSession | null }>;
  resetPasswordForEmail(email: string): Res<unknown>;
  updateUser(c: { email?: string; password?: string; data?: Record<string, unknown> }): Res<{ user: SbUser | null }>;
  getSession(): Res<{ session: SbSession | null }>;
  signOut(o?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: SbError | null }>;
}

/** Key-value storage with the expo-secure-store method names. */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
