#!/usr/bin/env node
// Removes every installed package that the API does not need at run time (Docker prod-deps stage).
//
// Why: in an npm workspace, `npm ci --workspace apps/api --omit=dev` decides "dev" from the WHOLE
// lock file. A package that is a dev dependency of the API but a production dependency of another
// workspace (e.g. typescript, micromatch/braces via the Expo apps) is kept. This walks the real
// dependency graph from apps/api/package.json `dependencies` (plus installed optional and peer
// dependencies of those packages), resolving each name the way Node does, and deletes the rest.
//
//   node apps/api/scripts/prune-to-runtime.mjs [--dry-run]     (run from the repository root)
// It DELETES packages: run it only inside the Docker build (the Dockerfile's prod-deps stage), never
// in a development checkout. Workspace links (symlinks) are unlinked, never followed.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const apiDir = join(root, 'apps', 'api');
const dryRun = process.argv.includes('--dry-run');
const readPkg = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

/** Node's lookup: <from>/node_modules/<name>, then each parent directory up to the root. */
function locate(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (resolve(dir) === resolve(root)) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const keep = new Set();
const missing = [];
const queue = [];
const api = readPkg(apiDir);
for (const name of Object.keys(api.dependencies ?? {})) queue.push([name, apiDir, true]);
while (queue.length) {
  const [name, from, required] = queue.shift();
  const dir = locate(name, from);
  if (!dir) {
    if (required) missing.push(`${name} (needed by ${relative(root, from) || '.'})`);
    continue;
  }
  if (keep.has(dir)) continue;
  keep.add(dir);
  const p = readPkg(dir);
  for (const n of Object.keys(p.dependencies ?? {})) queue.push([n, dir, true]);
  for (const n of Object.keys(p.optionalDependencies ?? {})) queue.push([n, dir, false]);
  for (const n of Object.keys(p.peerDependencies ?? {})) queue.push([n, dir, !(p.peerDependenciesMeta?.[n]?.optional)]);
}
if (missing.length) {
  console.error(`Runtime dependencies not installed:\n- ${missing.join('\n- ')}`);
  process.exit(1);
}

/** Every package directory under a node_modules folder (scoped packages included), outermost first. */
function packagesIn(nm) {
  if (!existsSync(nm)) return [];
  const out = [];
  for (const entry of readdirSync(nm)) {
    if (entry.startsWith('.')) continue;
    const full = join(nm, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // broken link
    }
    if (!st.isDirectory()) continue;
    if (entry.startsWith('@')) for (const s of readdirSync(full)) out.push(join(full, s));
    else out.push(full);
  }
  return out;
}

let removed = 0;
const visit = (nm) => {
  for (const dir of packagesIn(nm)) {
    const link = lstatSync(dir).isSymbolicLink();
    if (!keep.has(dir)) {
      if (!dryRun) {
        if (link) unlinkSync(dir);
        else rmSync(dir, { recursive: true, force: true });
      }
      removed++;
    } else if (!link) visit(join(dir, 'node_modules'));
  }
};
visit(join(root, 'node_modules'));
visit(join(apiDir, 'node_modules'));
if (process.env.PRUNE_LIST) console.log([...keep].map((d) => relative(root, d)).sort().join('\n'));
console.log(`${dryRun ? 'Would keep' : 'Kept'} ${keep.size} runtime packages; ${dryRun ? 'would remove' : 'removed'} ${removed}.`);
