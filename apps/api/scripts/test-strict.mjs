#!/usr/bin/env node
// Runs the compiled API tests and fails on anything that is not a clean pass (Phase 1.5, CI).
//
// Why a wrapper: on Node 22 a suite (describe) that throws while being set up is reported as
// "not ok" but counted in neither `fail` nor the exit code. And a skipped database test is not a
// failure to node:test, while CI must actually run them. So this script reads the TAP stream and fails if:
//   - the test process exits non-zero;
//   - any line is "not ok" (at any depth), or fail/cancelled > 0;
//   - any test is skipped or todo while STRICT_NO_SKIPS=1 (CI sets it with REQUIRE_DATABASE_TESTS=1).
// The human-readable spec report still goes to stdout.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tapFile = join(mkdtempSync(join(tmpdir(), 'gobye-tap-')), 'api.tap');
const r = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', `--test-reporter-destination=${tapFile}`, 'dist-test/apps/api/test/**/*.test.js'],
  { stdio: 'inherit', env: process.env },
);
const tap = readFileSync(tapFile, 'utf8');
const count = (k) => Number(new RegExp(`^# ${k} (\\d+)$`, 'm').exec(tap)?.[1] ?? NaN);
const notOk = tap.split('\n').filter((l) => /^\s*not ok \d+/.test(l)).map((l) => l.trim());
const skipped = tap.split('\n').filter((l) => /^\s*ok \d+ .*# (SKIP|TODO)/i.test(l)).map((l) => l.trim());
const summary = { tests: count('tests'), pass: count('pass'), fail: count('fail'), cancelled: count('cancelled'), skipped: count('skipped'), todo: count('todo') };
const problems = [];
if (r.status !== 0) problems.push(`test process exited with ${r.status ?? r.signal}`);
if (notOk.length) problems.push(`${notOk.length} "not ok" result(s):\n    ${notOk.join('\n    ')}`);
if (summary.fail > 0 || summary.cancelled > 0) problems.push(`fail=${summary.fail} cancelled=${summary.cancelled}`);
if (Number.isNaN(summary.tests) || summary.tests === 0) problems.push('no tests ran');
if (process.env.STRICT_NO_SKIPS === '1' && (summary.skipped > 0 || summary.todo > 0 || skipped.length))
  problems.push(`skipped/todo tests are not allowed here:\n    ${skipped.join('\n    ')}`);
process.stdout.write(`\nStrict summary: ${JSON.stringify(summary)}\n`);
if (problems.length) {
  process.stderr.write(`\nTEST RUN NOT CLEAN:\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('Clean run: every test executed and passed.\n');
