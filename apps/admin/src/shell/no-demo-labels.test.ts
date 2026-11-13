import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-070: the admin shows no "prototype", "test data" or "simulated" wording to users. The same screens
 * go live unchanged. Demo only tools sit behind VITE_DEMO_TOOLS and are labelled "Demo" there.
 * Checks user visible strings in page source: JSX text and quoted strings, not comments or identifiers.
 */
const ROOT = join(__dirname, '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no demo labels in the admin (D-070)', () => {
  it('no page shows prototype, test data or simulated wording', () => {
    const hits: string[] = [];
    for (const f of files(ROOT)) {
      const lines = strip(readFileSync(f, 'utf8')).split('\n');
      lines.forEach((l, i) => {
        const visible = [...l.matchAll(/>([^<>{}]+)</g), ...l.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2] ?? m[1] ?? '');
        if (visible.some((t) => /\b(prototype|test data|simulated|simulation)\b/i.test(t) && !/^[a-z_]+$/.test(t))) hits.push(`${f.slice(ROOT.length)}:${i + 1}: ${l.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
