import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createTestDb, makeApp, makeKeys, NO_DB_REASON, postgresAvailable, type TestApp, type TestDb } from './helpers';

const run = promisify(execFile);
const SCRIPT = join(__dirname, '..', '..', '..', '..', 'scripts', 'health-check.mjs');

async function check(url: string, ...extra: string[]): Promise<{ code: number; out: string }> {
  try {
    const r = await run(process.execPath, [SCRIPT, url, '--wait', '3', ...extra]);
    return { code: 0, out: r.stdout };
  } catch (e) {
    const err = e as { code: number; stdout: string };
    return { code: err.code, out: err.stdout };
  }
}

/** scripts/health-check.mjs against a real listening server (what runs after every deploy). */
describe('deployment health check script', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  let healthy: TestApp;
  let broken: TestApp;
  let healthyUrl = '';
  let brokenUrl = '';
  before(async () => {
    if (skip) return;
    tdb = await createTestDb();
    healthy = await makeApp({ db: tdb.db, keys: await makeKeys(), config: { APP_VERSION: 'rel-123' } });
    await healthy.app.listen({ port: 0, host: '127.0.0.1' });
    healthyUrl = await healthy.app.getUrl();
    broken = await makeApp({ config: { APP_VERSION: 'rel-123' } }); // no database: not ready
    await broken.app.listen({ port: 0, host: '127.0.0.1' });
    brokenUrl = await broken.app.getUrl();
  });
  after(async () => {
    if (skip) return;
    await healthy.app.close();
    await broken.app.close();
    await tdb.drop();
  });

  test('passes against a healthy instance of the expected release', { skip }, async () => {
    const r = await check(healthyUrl.replace('[::1]', '127.0.0.1'), '--expect-version', 'rel-123');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /All \d+ checks passed/);
  });

  test('fails on a stale release', { skip }, async () => {
    const r = await check(healthyUrl.replace('[::1]', '127.0.0.1'), '--expect-version', 'rel-999');
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL {2}version matches the release/);
  });

  test('fails when the instance is up but not ready (no database)', { skip }, async () => {
    const r = await check(brokenUrl.replace('[::1]', '127.0.0.1'));
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL {2}ready/);
  });
});
