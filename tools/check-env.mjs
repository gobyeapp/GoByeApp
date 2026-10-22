#!/usr/bin/env node
/**
 * GoBye env-file check (D-051). Fails when a public variable (bundled into an app or a web page) looks
 * like a server secret, or when a required variable is missing. It never prints values.
 *
 *   node tools/check-env.mjs apps/rider/.env.local
 *   node tools/check-env.mjs apps/admin/.env.production --require VITE_API_BASE_URL
 *   npm run check:env -- apps/driver/.env.local
 *
 * Public prefixes: EXPO_PUBLIC_ (Expo), VITE_ (admin), NEXT_PUBLIC_. Anything with these prefixes ships
 * to every user's device or browser.
 */
import { readFileSync } from 'node:fs';

const PUBLIC = /^(EXPO_PUBLIC_|VITE_|NEXT_PUBLIC_)/;
const SECRET_NAME = /(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|PASSWD|ACCESS_KEY_ID|SECRET_ACCESS_KEY|DATABASE_URL|DB_URL|R2_ACCESS|SIGNING|ORIGIN_AUTH|WEBHOOK_SECRET|PAYSTACK_SECRET|FLW_SECRET|_TOKEN$)/i;
const SECRET_VALUE = [
  [/^sk_(live|test)_/, 'payment secret key'],
  [/^github_pat_|^gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/^AKIA[0-9A-Z]{16}$/, 'AWS-style access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/^postgres(ql)?:\/\/[^:]+:[^@]+@/, 'database URL with password'],
];

function jwtRole(v) {
  const parts = v.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export function checkEnv(vars, required = []) {
  const problems = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!PUBLIC.test(name)) continue;
    if (SECRET_NAME.test(name)) problems.push(`${name}: public variable named like a secret. Public variables ship to every device; keep secrets server-side.`);
    for (const [re, what] of SECRET_VALUE) if (re.test(value)) problems.push(`${name}: value looks like a ${what}. Never put it in a public variable.`);
    if (jwtRole(value) === 'service_role') problems.push(`${name}: a Supabase service_role key. Use the anon key in apps; rotate this key.`);
  }
  for (const r of required) if (!vars[r]) problems.push(`${r}: required but missing or empty.`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--require'));
  const reqIdx = args.indexOf('--require');
  const required = reqIdx >= 0 ? (args[reqIdx + 1] ?? '').split(',').filter(Boolean) : [];
  if (!files.length) {
    console.error('Usage: node tools/check-env.mjs <env file> [more files] [--require NAME,NAME]');
    process.exit(2);
  }
  let failed = false;
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      console.error(`✗ ${f}: can't read`);
      failed = true;
      continue;
    }
    const problems = checkEnv(parseEnv(text), required);
    if (problems.length) {
      failed = true;
      console.error(`✗ ${f}`);
      for (const p of problems) console.error(`  - ${p}`);
    } else console.log(`✓ ${f}: no secrets in public variables${required.length ? '; required variables present' : ''}`);
  }
  process.exit(failed ? 1 : 0);
}
