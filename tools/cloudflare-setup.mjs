#!/usr/bin/env node
/**
 * GoBye Cloudflare setup (D-051). Run on your own computer, from the GOBYE folder:
 *
 *   Windows PowerShell:  $env:CLOUDFLARE_API_TOKEN="<token>"; node tools/cloudflare-setup.mjs            (look only)
 *                        $env:CLOUDFLARE_API_TOKEN="<token>"; node tools/cloudflare-setup.mjs --apply    (make the changes)
 *   macOS / Linux:       CLOUDFLARE_API_TOKEN=<token> node tools/cloudflare-setup.mjs [--apply]
 *
 * What --apply does, in order, and only what is missing (safe to run again):
 *   1. Checks the token, finds your account and the gobye.app zone, and saves a backup of every DNS record
 *      to cloudflare-dns-backup-<time>.json (in this folder, not uploaded anywhere).
 *   2. Creates the 8 R2 buckets (staging + production; public-media and private ones). r2.dev stays off.
 *   3. Sets CORS on the uploads and public-media buckets (gobye.app hosts only, no wildcard).
 *   4. Deploys the API gateway (api-staging.gobye.app, api.gobye.app) and the public media Worker
 *      (media-staging.gobye.app, media.gobye.app) as Worker custom domains, and stores a fresh random
 *      ORIGIN_AUTH_SECRET in Cloudflare (never printed, never written to a file).
 *   5. Checks the new addresses answer.
 * It never changes gobye.app or www (the website stays on Vercel) and skips any hostname that already has
 * a DNS record. The upload signer is not deployed yet: it needs a separate R2 key (see the end of the run).
 *
 * The token is read from CLOUDFLARE_API_TOKEN only and is never printed or saved. At the end a summary is
 * written to cloudflare-setup-report.json (no secrets): send that file (or the printed summary) back.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const ZONE = 'gobye.app';
const API = 'https://api.cloudflare.com/client/v4';
const report = { ranAt: new Date().toISOString(), mode: APPLY ? 'apply' : 'look-only', steps: [] };
const step = (name, status, detail = '') => {
  report.steps.push({ name, status, detail });
  const mark = { ok: '✓', made: '＋', skip: '·', plan: '→', fail: '✗', warn: '!' }[status] || '-';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
};

const BUCKETS = ['staging', 'prod'].flatMap((env) =>
  ['public-media', 'private-documents', 'private-evidence', 'private-uploads'].map((role) => ({ name: `gobye-${env}-${role}`, env, role })),
);
const CORS = { staging: 'infra/cloudflare/r2/cors.staging.json', prod: 'infra/cloudflare/r2/cors.production.json' };
const WORKERS = [
  { label: 'API gateway', config: 'infra/cloudflare/src/workers/api-gateway/wrangler.api-gateway.toml', secrets: ['ORIGIN_AUTH_SECRET'], hosts: { staging: 'api-staging.gobye.app', production: 'api.gobye.app' }, check: '/health/live' },
  { label: 'Public media', config: 'infra/cloudflare/r2/wrangler.media-gateway.toml', secrets: [], hosts: { staging: 'media-staging.gobye.app', production: 'media.gobye.app' }, check: '/' },
];

async function cf(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

function wrangler(args, input, accountId) {
  const r = spawnSync('npx', ['--yes', 'wrangler@4', ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_SEND_METRICS: 'false' },
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`.replaceAll(TOKEN, '[token]');
  return { ok: r.status === 0, out };
}

/** CORS file (S3 style) → Cloudflare R2 API shape. */
function corsRules(file) {
  const j = JSON.parse(readFileSync(join(root, file), 'utf8'));
  return (j.rules || []).map((r) => ({
    allowed: { origins: r.AllowedOrigins, methods: r.AllowedMethods, headers: r.AllowedHeaders },
    exposeHeaders: r.ExposeHeaders || [],
    maxAgeSeconds: r.MaxAgeSeconds || 3600,
  }));
}

async function main() {
  console.log(`\nGoBye Cloudflare setup (${APPLY ? 'APPLY: making changes' : 'LOOK ONLY: no changes; add --apply to make them'})\n`);
  if (!TOKEN) {
    step('Token', 'fail', 'Set CLOUDFLARE_API_TOKEN first (see the top of this file).');
    return;
  }

  // 1. Token, account, zone, DNS backup
  try {
    const v = await cf('GET', '/user/tokens/verify');
    step('Token', 'ok', `status ${v.result.status}${v.result.expires_on ? `, expires ${v.result.expires_on}` : ''}`);
  } catch (e) {
    step('Token', 'fail', e.message);
    return;
  }
  const zones = (await cf('GET', `/zones?name=${ZONE}`)).result;
  const zone = zones[0] || null;
  let accountId;
  let dns = [];
  if (!zone) {
    // Tell apart "gobye.app isn't on Cloudflare" from "the token can't see it".
    const visible = (await cf('GET', '/zones?per_page=50').catch(() => ({ result: [] }))).result.map((z) => `${z.name} (${z.status})`);
    const accounts = (await cf('GET', '/accounts').catch(() => ({ result: [] }))).result;
    report.visibleZones = visible;
    report.accounts = accounts.map((a) => a.name);
    step(
      'Zone gobye.app',
      'warn',
      visible.length
        ? `not visible to this token. Zones it can see: ${visible.join(', ')}. Edit the token: Zone Resources → Include → Specific zone → gobye.app.`
        : 'this token sees no zones at all: either gobye.app has not been added to Cloudflare yet (Add a site), or the token has no Zone Resources. Buckets will still be made; the api/media addresses wait for the zone.',
    );
    if (!accounts.length) {
      step('Account', 'fail', 'the token can\'t read the account either. Add Account Settings: Read and pick your account under Account Resources.');
      return finish();
    }
    accountId = accounts[0].id;
    report.account = accounts[0].name;
    step('Account', 'ok', `${accounts[0].name}${accounts.length > 1 ? ` (first of ${accounts.length}; using this one)` : ''}`);
  } else {
    accountId = zone.account.id;
    report.account = zone.account.name;
    step('Zone gobye.app', 'ok', `status ${zone.status}, plan ${zone.plan?.name || 'unknown'}, nameservers ${(zone.name_servers || []).join(', ')}`);
    if (zone.status !== 'active') step('Zone status', 'warn', 'The zone is not active yet: point your registrar to the nameservers above. Custom domains will wait until it is active.');
    dns = (await cf('GET', `/zones/${zone.id}/dns_records?per_page=1000`)).result;
    const backup = `cloudflare-dns-backup-${report.ranAt.replace(/[:.]/g, '-')}.json`;
    writeFileSync(join(root, backup), JSON.stringify(dns, null, 2));
    step('DNS backup', 'ok', `${dns.length} records saved to ${backup}`);
    report.dns = dns.map((r) => ({ name: r.name, type: r.type, proxied: r.proxied })); // names/types only
    const web = dns.filter((r) => r.name === ZONE || r.name === `www.${ZONE}`);
    step('Website records (untouched)', 'ok', web.map((r) => `${r.name} ${r.type} ${r.proxied ? 'proxied' : 'DNS only'}`).join('; ') || 'none found');
    if (web.some((r) => r.proxied)) step('Website proxy', 'warn', 'gobye.app/www are proxied (orange cloud). Vercel recommends DNS only. Not changed by this script.');
  }

  // 2 + 3. Buckets and CORS
  let existing = [];
  try {
    existing = ((await cf('GET', `/accounts/${accountId}/r2/buckets?per_page=1000`)).result.buckets || []).map((b) => b.name);
  } catch (e) {
    step('R2', 'fail', `${e.message}. If R2 isn't enabled yet: Cloudflare dashboard → R2 → Get started (free tier, a card may be required), then run again.`);
    return finish();
  }
  for (const b of BUCKETS) {
    if (existing.includes(b.name)) step(`Bucket ${b.name}`, 'skip', 'already exists');
    else if (!APPLY) step(`Bucket ${b.name}`, 'plan', 'would create (private, r2.dev off)');
    else {
      try {
        await cf('POST', `/accounts/${accountId}/r2/buckets`, { name: b.name, locationHint: 'weur' });
        step(`Bucket ${b.name}`, 'made', 'created (private, r2.dev off)');
      } catch (e) {
        step(`Bucket ${b.name}`, 'fail', e.message);
      }
    }
    if (b.role === 'private-uploads' || b.role === 'public-media') {
      if (!APPLY) step(`CORS ${b.name}`, 'plan', `would apply ${CORS[b.env]}`);
      else {
        try {
          await cf('PUT', `/accounts/${accountId}/r2/buckets/${b.name}/cors`, { rules: corsRules(CORS[b.env]) });
          step(`CORS ${b.name}`, 'made', `applied ${CORS[b.env]}`);
        } catch (e) {
          step(`CORS ${b.name}`, 'fail', e.message);
        }
      }
    }
  }

  // 4. Workers on custom domains (only once gobye.app is in this account)
  if (!zone) {
    step('Workers on api/media addresses', 'skip', 'waiting for gobye.app to be added to Cloudflare and visible to the token');
    return finish();
  }
  let bound = [];
  try {
    bound = (await cf('GET', `/accounts/${accountId}/workers/domains`)).result || [];
  } catch {
    /* no custom domains yet, or not visible to this token */
  }
  for (const w of WORKERS) {
    for (const env of ['staging', 'production']) {
      const host = w.hosts[env];
      const ours = bound.find((d) => d.hostname === host);
      const clash = !ours && dns.find((r) => r.name === host);
      if (clash) {
        step(`${w.label} (${env})`, 'skip', `${host} already has a ${clash.type} record; left alone. Remove it in Cloudflare if it's unused, then run again.`);
        continue;
      }
      if (!APPLY) {
        step(`${w.label} (${env})`, 'plan', ours ? `already on https://${host}; would redeploy the latest code` : `would deploy and attach https://${host}`);
        continue;
      }
      const d = wrangler(['deploy', '-c', w.config, '--env', env]);
      if (!d.ok) {
        step(`${w.label} (${env})`, 'fail', d.out.split('\n').filter((l) => /error|✘/i.test(l)).slice(0, 4).join(' | ') || 'wrangler deploy failed');
        continue;
      }
      step(`${w.label} (${env})`, 'made', `deployed, https://${host}`);
      for (const name of w.secrets) {
        const s = wrangler(['secret', 'put', name, '-c', w.config, '--env', env], randomBytes(32).toString('base64url'));
        step(`  secret ${name} (${env})`, s.ok ? 'made' : 'fail', s.ok ? 'stored in Cloudflare (random, not shown)' : 'could not store');
      }
    }
  }

  // 5. Check the addresses
  if (APPLY) {
    await new Promise((r) => setTimeout(r, 8000));
    for (const w of WORKERS) {
      for (const env of ['staging', 'production']) {
        const url = `https://${w.hosts[env]}${w.check}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          step(`Check ${url}`, res.status < 500 || w.check === '/health/live' ? 'ok' : 'warn', `HTTP ${res.status}`);
        } catch (e) {
          step(`Check ${url}`, 'warn', `not answering yet (${e.cause?.code || e.message}); new certificates can take a few minutes`);
        }
      }
    }
  }
  return finish();
}

function finish() {
  report.next = [
    'Upload signer: create an R2 API token (R2 → Manage R2 API tokens → Object Read & Write, only the 8 gobye buckets) and send the Access Key ID and Secret to Claude — or set them yourself with "npx wrangler secret put R2_ACCESS_KEY_ID -c infra/cloudflare/r2/wrangler.upload-signer.toml --env staging".',
    'Delete the setup API token in Cloudflare (My Profile → API Tokens) when Claude is done.',
  ];
  writeFileSync(join(root, 'cloudflare-setup-report.json'), JSON.stringify(report, null, 2));
  console.log('\nSummary saved to cloudflare-setup-report.json (no secrets). Send it back to Claude.\n');
}

main().catch((e) => {
  step('Unexpected error', 'fail', String(e?.message || e).replaceAll(TOKEN, '[token]'));
  finish();
  process.exitCode = 1;
});
