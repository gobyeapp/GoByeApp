#!/usr/bin/env node
/**
 * GoBye demo relay (D-049). A tiny REST store with the Supabase / PostgREST query shape, so the rider
 * app, the driver app and the admin share the same TEST records on one Wi-Fi network without a backend.
 *
 *   npm run demo:relay            → http://<this computer's LAN IP>:8787
 *
 * On start it writes `.env.local` in apps/rider, apps/driver (EXPO_PUBLIC_DEMO_RELAY_URL) and apps/admin
 * (VITE_DEMO_RELAY_URL), so the next `npx expo start` / `npm run dev` connects. Data is kept in
 * tools/demo-relay/data.json; delete it (or POST /reset) to start again. No auth: demo data only.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const PORT = Number(process.env.PORT || 8787);
const TABLES = ['demo_people', 'demo_driver_applications', 'demo_rides', 'demo_ride_responses', 'demo_events'];
const DATA = process.env.DEMO_RELAY_DATA || join(here, 'data.json');

let db = Object.fromEntries(TABLES.map((t) => [t, []]));
if (existsSync(DATA)) {
  try {
    db = { ...db, ...JSON.parse(readFileSync(DATA, 'utf8')) };
  } catch {
    console.warn('Could not read data.json, starting empty.');
  }
}
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFileSync(DATA, JSON.stringify(db)), 300);
};

/* ---------- PostgREST subset ---------- */
function parseIn(list) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '"' && list[i - 1] !== '\\') q = !q;
    else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else if (!(c === '\\' && list[i + 1] === '"')) cur += c;
  }
  out.push(cur);
  return out;
}
function filterFn(key, expr) {
  const [op, ...rest] = expr.split('.');
  const val = rest.join('.');
  const get = (r) => (r[key] === undefined ? null : r[key]);
  switch (op) {
    case 'eq':
      return (r) => String(get(r)) === val;
    case 'neq':
      return (r) => String(get(r)) !== val;
    case 'gte':
      return (r) => typeof get(r) === 'number' && get(r) >= Number(val);
    case 'gt':
      return (r) => typeof get(r) === 'number' && get(r) > Number(val);
    case 'is':
      return (r) => (val === 'null' ? get(r) === null : String(get(r)) === val);
    case 'not':
      return (r) => get(r) !== null;
    case 'in': {
      const set = new Set(parseIn(val.replace(/^\(|\)$/g, '')));
      return (r) => set.has(String(get(r)));
    }
    default:
      return () => true;
  }
}
function query(rows, params) {
  let out = rows;
  for (const [k, v] of params) if (!['select', 'order', 'limit', 'on_conflict'].includes(k)) out = out.filter(filterFn(k, v));
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  const limit = Number(params.get('limit') || 0);
  return limit ? out.slice(0, limit) : out;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, apikey, Authorization, Prefer',
};
const send = (res, status, body) => {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : null);
      } catch {
        resolve(undefined);
      }
    });
  });

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/health') return send(res, 200, { ok: true, name: 'GoBye demo relay', counts: Object.fromEntries(TABLES.map((t) => [t, db[t].length])) });
  if (url.pathname === '/reset' && req.method === 'POST') {
    db = Object.fromEntries(TABLES.map((t) => [t, []]));
    save();
    console.log('↺ demo data reset');
    return send(res, 200, { ok: true });
  }
  const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (!m || !TABLES.includes(m[1])) return send(res, 404, { message: 'Unknown table' });
  const table = m[1];
  const params = url.searchParams;
  const prefer = String(req.headers.prefer || '');
  if (req.method === 'GET') return send(res, 200, query(db[table], params));
  const body = await readBody(req);
  if (body === undefined) return send(res, 400, { message: 'Invalid JSON' });
  if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const upsert = prefer.includes('merge-duplicates');
    const out = [];
    for (const r of rows) {
      if (!r || typeof r.id !== 'string') return send(res, 400, { message: 'Each row needs a string id' });
      const i = db[table].findIndex((x) => x.id === r.id);
      if (i >= 0 && !upsert) return send(res, 409, { message: 'duplicate key value violates unique constraint' });
      if (i >= 0) db[table][i] = { ...db[table][i], ...r };
      else db[table].push(r);
      out.push(i >= 0 ? db[table][i] : r);
    }
    if (table === 'demo_events') db[table] = db[table].slice(-500);
    save();
    return send(res, 201, prefer.includes('return=representation') ? out : undefined);
  }
  if (req.method === 'PATCH') {
    const hits = query(db[table], params);
    for (const r of hits) Object.assign(r, body);
    if (hits.length) save();
    return send(res, 200, prefer.includes('return=representation') ? hits : undefined);
  }
  return send(res, 405, { message: 'Method not allowed' });
});

function lanIp() {
  for (const list of Object.values(networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address;
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIp();
  const lan = `http://${ip}:${PORT}`;
  if (!process.env.DEMO_RELAY_NO_ENV) {
    const write = (app, line) => {
      const p = join(root, 'apps', app, '.env.local');
      try {
        writeFileSync(p, `# Written by tools/demo-relay (npm run demo:relay). Delete this file to run the app offline.\n${line}\n`);
      } catch {
        /* app folder missing: ignore */
      }
    };
    write('rider', `EXPO_PUBLIC_DEMO_RELAY_URL=${lan}`);
    write('driver', `EXPO_PUBLIC_DEMO_RELAY_URL=${lan}`);
    write('admin', `VITE_DEMO_RELAY_URL=${lan}`);
  }
  console.log(`\nGoBye demo relay running (test data only)\n  This computer:  http://localhost:${PORT}\n  Phones (same Wi-Fi): ${lan}\n\nWrote .env.local for rider, driver and admin. Restart Expo with "npx expo start -c" and the admin with "npm run dev" to connect.\nPress Ctrl+C to stop. Data: ${DATA}\n`);
});
