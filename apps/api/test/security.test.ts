import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_CONSENTS } from '@gobye/core';
import { addStaff, bearer, createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type Keys, type TestApp, type TestDb } from './helpers';

const consents = [
  { document: 'terms', version: CURRENT_CONSENTS.terms },
  { document: 'privacy', version: CURRENT_CONSENTS.privacy },
];
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Every route the server has, read from the server itself (so a new route can't dodge these checks). */
function routesOf(t: TestApp): { method: Method; path: string }[] {
  const tree = (t.app.getHttpAdapter().getInstance() as { printRoutes(o: object): string }).printRoutes({ commonPrefix: false });
  const out: { method: Method; path: string }[] = [];
  const stack: string[] = [];
  for (const line of tree.split('\n')) {
    const m = /^((?:│ {3}| {4})*)[├└]── (\S+) \(([A-Z, ]+)\)$/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack.push(m[2]!);
    for (const method of m[3]!.split(', ')) if (method !== 'HEAD' && method !== 'OPTIONS') out.push({ method: method as Method, path: stack.join('') });
  }
  return out;
}
const fill = (path: string) => path.replace(/:step/g, 'personal').replace(/:provider/g, 'simulated').replace(/:reference/g, 'gbw-0000000000000000').replace(/:[A-Za-z]+/g, randomUUID());
const PUBLIC = (p: string) => p.startsWith('/health/') || p.startsWith('/v1/webhooks/');
const STAFF = (p: string) => p.startsWith('/v1/costs/') || p.startsWith('/v1/ops/') || p.startsWith('/v1/staff/') || /^\/v1\/drivers\/applications|\/v1\/drivers\/:driverId\/(request-changes|decision)|^\/v1\/drivers\/:driverId$/.test(p);

/** Security review, 2026-11-27 (docs/SECURITY_REVIEW.md): properties that must hold for EVERY route. */
describe('security: every route', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let keys: Keys;
  let t: TestApp;
  let routes: { method: Method; path: string }[] = [];
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    keys = await makeKeys();
    // Everything switched on, so the routes that are normally "not connected" are really exercised.
    t = await makeApp({ db: tdb.db, keys, config: { MAPS_PROVIDER: 'fake', PAYMENTS_PROVIDER: 'simulated', WALLET_ENABLED: 'true', NOTIFICATIONS_PROVIDER: 'log', STORAGE_PROVIDER: 'memory' } });
    routes = routesOf(t);
  });
  after(async () => {
    if (skip) return;
    await t.app.close();
    await tdb.drop();
  });
  const send = (r: { method: Method; path: string }, headers: Record<string, string> = {}, payload: object = {}) => t.inject({ method: r.method, url: fill(r.path), headers, ...(r.method === 'GET' ? {} : { payload }) });

  test('the list of routes was read', { skip }, () => {
    assert.ok(routes.length >= 70, `only ${routes.length} routes found: the parser is broken`);
    for (const must of ['/v1/rides', '/v1/wallet/deposits', '/v1/ops/finance/refunds', '/v1/drivers/me/withdrawals', '/v1/webhooks/payments/:provider']) assert.ok(routes.some((r) => r.path === must), must);
  });

  test('no route answers without a valid sign-in, except health checks and signed webhooks', { skip }, async () => {
    const expired = await keys.token({ sub: randomUUID() }, { expiresIn: '-1m' });
    const forged = `${(await keys.token({ sub: randomUUID() })).split('.').slice(0, 2).join('.')}.AAAA`;
    const otherIssuer = await keys.token({ sub: randomUUID() }, { issuer: 'https://evil.example/auth/v1' });
    for (const r of routes) {
      if (PUBLIC(r.path)) continue;
      for (const [why, headers] of [['no token', {}], ['an expired token', bearer(expired)], ['a forged signature', bearer(forged)], ['another issuer', bearer(otherIssuer)], ['"none"', { authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' }]] as const) {
        const res = await send(r, { ...headers, 'idempotency-key': randomUUID() });
        assert.equal(res.statusCode, 401, `${r.method} ${r.path} with ${why} answered ${res.statusCode}`);
      }
    }
  });

  test('webhooks refuse anything unsigned and never run as a signed-in person', { skip }, async () => {
    const rider = await keys.token({ sub: randomUUID() });
    for (const r of routes.filter((x) => x.path.startsWith('/v1/webhooks/'))) {
      for (const headers of [{} as Record<string, string>, bearer(rider) as Record<string, string>, { 'x-paystack-signature': 'aa', 'x-simulated-signature': 'aa', 'x-hub-signature-256': 'sha256=aa', 'webhook-id': '1', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,aaaa' }]) {
        const res = await send(r, headers, { event: 'charge.success', data: { reference: 'x' } });
        assert.ok([401, 403, 404].includes(res.statusCode), `${r.method} ${r.path} answered ${res.statusCode}: ${res.body}`);
      }
    }
  });

  test('staff routes refuse riders, drivers, suspended or removed staff, and staff without a second factor', { skip }, async () => {
    const sub = randomUUID();
    const tok = await keys.token({ sub, phone: '2348031112222' });
    assert.equal((await t.inject({ method: 'POST', url: '/v1/me/profile', headers: { ...bearer(tok), 'idempotency-key': randomUUID() }, payload: { role: 'rider', fullName: 'Ada Obi', consents } })).statusCode, 201);
    const owner = await addStaff(tdb.db, { roles: ['owner'] });
    const suspended = await addStaff(tdb.db, { roles: ['owner'], status: 'suspended' });
    const staffRoutes = routes.filter((r) => STAFF(r.path));
    assert.ok(staffRoutes.length >= 12);
    for (const r of staffRoutes) {
      const cases: [string, string][] = [
        ['a rider', tok],
        ['staff without a second factor', await keys.token({ sub: owner.authUserId, aal: 'aal1' })],
        ['suspended staff', await keys.token({ sub: suspended.authUserId, aal: 'aal2' })],
        // A token that merely CLAIMS to be staff: roles come from our database, never from the token.
        ['a self-declared admin', await keys.token({ sub: randomUUID(), aal: 'aal2', role: 'service_role', app_metadata: { roles: ['owner'], is_admin: true }, user_metadata: { staff: true } })],
      ];
      for (const [who, token] of cases) {
        const res = await send(r, { ...bearer(token), 'idempotency-key': randomUUID() });
        assert.ok([401, 403, 404].includes(res.statusCode), `${r.method} ${r.path} as ${who} answered ${res.statusCode}`);
      }
    }
  });

  test('errors never show how the server is built, whatever is sent', { skip }, async () => {
    const sub = randomUUID();
    const tok = await keys.token({ sub, phone: '2348031113333' });
    await t.inject({ method: 'POST', url: '/v1/me/profile', headers: { ...bearer(tok), 'idempotency-key': randomUUID() }, payload: { role: 'rider', fullName: 'Ada Obi', consents } });
    const nasty = ["' or 1=1 --", '"; drop table app.rides; --', '../../etc/passwd', '%00', '{{7*7}}', '<script>alert(1)</script>', 'a'.repeat(5000)];
    const bodies: unknown[] = [{ __proto__: { admin: true }, constructor: { prototype: { admin: true } } }, { quoteId: nasty[0], mode: nasty[1] }, { amountKobo: 1e308 }, { amountKobo: -1 }, { amountKobo: '100' }, [1, 2, 3], 'text', null];
    for (const r of routes.filter((x) => !PUBLIC(x.path))) {
      const url = fill(r.path).replace(/[0-9a-f-]{36}$/, encodeURIComponent(nasty[0]!));
      const tries = [t.inject({ method: r.method, url: `${url}?limit=${encodeURIComponent(nasty[1]!)}&status=${encodeURIComponent(nasty[0]!)}`, headers: { ...bearer(tok), 'idempotency-key': randomUUID() }, ...(r.method === 'GET' ? {} : { payload: {} }) })];
      if (r.method !== 'GET') for (const b of bodies) tries.push(t.inject({ method: r.method, url: fill(r.path), headers: { ...bearer(tok), 'idempotency-key': randomUUID(), 'content-type': 'application/json' }, payload: JSON.stringify(b) }));
      if (r.method !== 'GET') tries.push(t.inject({ method: r.method, url: fill(r.path), headers: { ...bearer(tok), 'idempotency-key': randomUUID(), 'content-type': 'application/json' }, payload: '{"broken": ' }));
      for (const res of await Promise.all(tries)) {
        assert.ok(res.statusCode < 500 || res.statusCode === 503, `${r.method} ${r.path} answered ${res.statusCode}: ${res.body.slice(0, 200)}`);
        assert.doesNotMatch(res.body, /\bselect\b|\binsert into\b|syntax error|\bat .*\.(js|ts):\d+|node_modules|postgres:\/\/|app\.[a-z_]+\b.*violates|ECONN|password/i, `${r.method} ${r.path} leaked: ${res.body.slice(0, 300)}`);
      }
    }
    assert.equal((await tdb.db.query(`select to_regclass('app.rides') as t`)).rows[0]!.t, 'app.rides', 'still there');
    assert.equal(({} as { admin?: boolean }).admin, undefined, 'no prototype pollution');
  });

  test('the route list on file is up to date (the gateway checks itself against that file)', { skip }, () => {
    const file = join(__dirname, '..', '..', '..', '..', 'routes.snapshot.json');
    const now = routes.map((r) => ({ ...r, public: PUBLIC(r.path) })).sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
    if (process.env.UPDATE_ROUTES === '1' || !existsSync(file)) writeFileSync(file, `${JSON.stringify(now, null, 1)}\n`);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), now, 'routes changed: run UPDATE_ROUTES=1 npm test -w apps/api, then check infra/cloudflare still routes them');
  });
});

describe('security: the code', () => {
  const src = join(__dirname, '..', '..', '..', '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));
  const all = files(src).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, 'utf8') }));

  test('every route that changes something takes an Idempotency-Key (two documented exceptions)', () => {
    assert.ok(all.length > 40);
    // Overwrite-one-row PUTs that are safe to repeat (D-100), and provider callbacks (de-duplicated by event id).
    const exempt = new Set(["Put('presence')", "Put('location')", "Post('webhooks/payments/:provider')", "Post('webhooks/auth/send-sms')", 'Post()@whatsapp/whatsapp.controller.ts']);
    let seen = 0;
    for (const { f, text } of all.filter((x) => x.f.endsWith('.controller.ts'))) {
      const re = /@(Post|Put|Patch|Delete)\(([^)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        seen += 1;
        const name = `${m[1]}(${m[2]})`;
        if (exempt.has(name) || exempt.has(`${name}@${f}`)) continue;
        const signature = text.slice(m.index, text.indexOf(') {', m.index) + 3);
        assert.match(signature, /@Headers\('idempotency-key'\)/, `${f}: @${name} has no Idempotency-Key`);
      }
    }
    assert.ok(seen >= 40, `only ${seen} write routes found`);
  });

  test('SQL is never built from request text', () => {
    for (const { f, text } of all) {
      // A template literal passed to query() may only interpolate fixed fragments, never body/query/params.
      const re = /\.query(?:<[^>]*>)?\(\s*`([^`]*)`/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        for (const hole of m[1]!.match(/\$\{[^}]*\}/g) ?? []) {
          assert.doesNotMatch(hole, /\b(body|params|query|req|q\.|raw|payload|input)\b/, `${f}: SQL interpolates ${hole}`);
        }
      }
    }
  });

  test('no secret or sign-in code is written to logs, audit rows or job payloads', () => {
    for (const { f, text } of all) {
      for (const line of text.split('\n')) {
        if (!/log\(|logger\.|console\.|audit_events|enqueue\(/.test(line)) continue;
        assert.doesNotMatch(line, /secretKey|SECRET_KEY|apiKey|API_KEY|accessToken|\botp\b|pickup_pin|password|authorization/i, `${f}: ${line.trim().slice(0, 140)}`);
      }
    }
  });
});
