#!/usr/bin/env node
/**
 * Post-deploy health check for the GoBye API (docs/DEPLOYMENT_STACKSHIFT.md). No dependencies.
 *
 *   node apps/api/scripts/health-check.mjs https://api-staging.gobye.app
 *   node apps/api/scripts/health-check.mjs https://gobye-api.stackshift.app --expect-version 1a2b3c4 --wait 120
 *   node apps/api/scripts/health-check.mjs http://127.0.0.1:8080 --allow-degraded
 *
 * Checks, in order (all must pass; exit 1 otherwise):
 *  1. /health/live answers 200 {status:"ok"} (waits up to --wait seconds for a fresh deploy to start);
 *  2. the deployed version matches --expect-version (when given): no stale instance behind the URL;
 *  3. /health/ready answers 200 with status ok (or degraded with --allow-degraded);
 *  4. request ids are echoed and security headers are present;
 *  5. protected and unknown routes answer with the error envelope, never a stack trace or HTML;
 *  6. response time of /health/live (median of 5) is reported; over --max-ms fails.
 * It never sends credentials and never changes anything.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? '').replace(/\/+$/, '');
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error('Usage: health-check.mjs <base URL, e.g. https://api-staging.gobye.app> [--expect-version SHA] [--wait SECONDS] [--allow-degraded] [--max-ms 1500]');
  process.exit(64);
}
const expectVersion = opt('expect-version');
const waitSeconds = Number(opt('wait', '60'));
const maxMs = Number(opt('max-ms', '1500'));
const allowDegraded = flag('allow-degraded');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function get(path, headers = {}) {
  const t = performance.now();
  const res = await fetch(base + path, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
  const ms = performance.now() - t;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: the checks below report it using `text`.
  }
  return { status: res.status, headers: res.headers, json, text, ms };
}

async function main() {
  // 1. Wait for liveness (a fresh container may still be starting).
  const deadline = Date.now() + waitSeconds * 1000;
  let live = null;
  while (Date.now() < deadline) {
    try {
      live = await get('/health/live');
      if (live.status === 200) break;
    } catch {
      // Not reachable yet: keep waiting until the deadline.
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  check('live: 200 {status:"ok"}', live?.status === 200 && live.json?.status === 'ok', live ? `HTTP ${live.status}` : 'no answer');
  if (!live || live.status !== 200) return finish();

  // 2. Version.
  if (expectVersion) check('version matches the release', live.json.version === expectVersion, `got ${live.json.version}`);
  else check('version reported', typeof live.json.version === 'string' && live.json.version.length > 0, live.json.version);

  // 3. Readiness.
  const ready = await get('/health/ready');
  const okStatus = ready.json?.status === 'ok' || (allowDegraded && ready.json?.status === 'degraded');
  check(`ready: 200 ${allowDegraded ? 'ok/degraded' : 'ok'}`, ready.status === 200 && okStatus, `HTTP ${ready.status} ${ready.json?.status ?? ''}`);
  check('ready leaks no dependency detail', ready.json && Object.keys(ready.json).sort().join(',') === 'status,version', Object.keys(ready.json ?? {}).join(','));

  // 4. Request ids and headers.
  const rid = `deploycheck-${Date.now()}`;
  const echoed = await get('/health/live', { 'x-request-id': rid });
  check('request id echoed', echoed.headers.get('x-request-id') === rid);
  check('nosniff header', echoed.headers.get('x-content-type-options') === 'nosniff');
  check('no-store on responses', (echoed.headers.get('cache-control') ?? '').includes('no-store'));
  check('no x-powered-by', !echoed.headers.get('x-powered-by'));

  // 5. Error envelopes (no HTML, no stack traces).
  const me = await get('/v1/me');
  check('protected route refuses anonymous callers with the envelope', [401, 403].includes(me.status) && typeof me.json?.error?.code === 'string', `HTTP ${me.status} ${me.json?.error?.code ?? ''}`);
  const nf = await get('/v1/__deploy_check_unknown__');
  check('unknown route: envelope, no stack trace', [403, 404].includes(nf.status) && !!nf.json?.error && !/at .+\.js:\d+/.test(nf.text), `HTTP ${nf.status}`);

  // 6. Latency.
  const times = [];
  for (let i = 0; i < 5; i++) times.push((await get('/health/live')).ms);
  const median = times.sort((a, b) => a - b)[2];
  check(`live median latency ≤ ${maxMs} ms`, median <= maxMs, `${Math.round(median)} ms`);
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} check(s) failed for ${base}` : `\nAll ${results.length} checks passed for ${base}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`Health check could not run: ${e.message}`);
  process.exit(1);
});
