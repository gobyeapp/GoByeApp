import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Website and admin on Cloudflare static hosting (D-065): while Vercel and Cloudflare both exist, the
 * security headers must be identical on both, and the hosting settings must keep what the sites rely on.
 */
const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

/** "/path" → { header: value } from a Cloudflare _headers file. */
function parseHeaders(text: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) rules.set(line.trim(), (current = {}));
    else {
      const i = line.indexOf(':');
      current![line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

function fromVercel(json: string): Map<string, Record<string, string>> {
  const d = JSON.parse(json) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
  return new Map(d.headers.map((h) => [h.source.replace('(.*)', '*'), Object.fromEntries(h.headers.map((x) => [x.key, x.value]))]));
}

describe('static sites on Cloudflare', () => {
  for (const [site, headers] of [
    ['website', 'apps/web/_headers'],
    ['admin', 'apps/admin/public/_headers'],
  ] as const) {
    it(`${site}: the same headers as on Vercel`, () => {
      const vercel = fromVercel(read(headers.replace('_headers', 'vercel.json').replace('public/', '')));
      expect(Object.fromEntries(parseHeaders(read(headers)))).toEqual(Object.fromEntries(vercel));
      const all = parseHeaders(read(headers)).get('/*')!;
      for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options']) expect(all[h], h).toBeTruthy();
    });
  }

  it('website: /open links rewrite to open.html; config files are not published', () => {
    expect(read('apps/web/_redirects')).toMatch(/^\/open\/\* \/open\.html 200$/m);
    const ignore = read('apps/web/.assetsignore');
    for (const f of ['wrangler.toml', 'vercel.json']) expect(ignore).toContain(f);
    expect(read('apps/web/wrangler.toml')).toMatch(/html_handling = "auto-trailing-slash"/);
  });

  it('admin: unknown paths fall back to the app (single-page application)', () => {
    const t = read('apps/admin/wrangler.toml');
    expect(t).toMatch(/directory = "\.\/dist"/);
    expect(t).toMatch(/not_found_handling = "single-page-application"/);
  });
});
