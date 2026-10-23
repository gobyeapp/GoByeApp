import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script in tools/, no type declarations (D-051).
import { checkEnv, parseEnv } from '../../../tools/check-env.mjs';

/** tools/check-env.mjs: public variables must never carry server secrets (D-051). */
describe('check-env', () => {
  it('passes a clean public env file and reads quotes, comments and export', () => {
    const vars = parseEnv('# app\nexport EXPO_PUBLIC_ENV="staging"\nEXPO_PUBLIC_API_BASE_URL=https://api-staging.gobye.app/v1\n');
    expect(vars).toEqual({ EXPO_PUBLIC_ENV: 'staging', EXPO_PUBLIC_API_BASE_URL: 'https://api-staging.gobye.app/v1' });
    expect(checkEnv(vars, ['EXPO_PUBLIC_API_BASE_URL'])).toEqual([]);
  });

  it('flags secret-looking names and values in public variables without echoing the value', () => {
    const fake = 'sk_live_' + 'x'.repeat(20);
    const problems: string[] = checkEnv({ VITE_R2_SECRET_ACCESS_KEY: 'abc', EXPO_PUBLIC_PAY_KEY: fake, SERVER_ONLY_SECRET: 'fine-server-side' });
    expect(problems.some((p) => p.startsWith('VITE_R2_SECRET_ACCESS_KEY'))).toBe(true);
    expect(problems.some((p) => p.startsWith('EXPO_PUBLIC_PAY_KEY') && p.includes('payment secret key'))).toBe(true);
    expect(problems.some((p) => p.startsWith('SERVER_ONLY_SECRET'))).toBe(false);
    expect(problems.join(' ')).not.toContain(fake);
  });

  it('flags a Supabase service_role JWT and missing required names', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '');
    const problems: string[] = checkEnv({ VITE_DEMO_RELAY_KEY: `h.${payload}.s` }, ['VITE_API_BASE_URL']);
    expect(problems.some((p) => p.includes('service_role'))).toBe(true);
    expect(problems.some((p) => p.startsWith('VITE_API_BASE_URL: required'))).toBe(true);
  });
});
