import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONTAINER_ENV_KEYS, CONTAINER_ENV_PREFIXES, KEEPALIVE_PATH, LOCATION_HINT, containerEnv } from '../src/workers/api-container/logic';

/** API on Cloudflare Containers (D-065): what reaches the container, and the staging template's shape. */
describe('api-container', () => {
  it('passes only listed string settings into the container, plus the port', () => {
    const env = containerEnv({
      APP_ENV: 'staging',
      DATABASE_URL: 'postgresql://gobye_api.ref:pw@host:6543/postgres',
      ORIGIN_AUTH_SECRET: 's'.repeat(48),
      WHATSAPP_PROVIDER: 'none',
      R2_BUCKET_PREFIX: 'gobye-staging',
      API: { idFromName: () => 'x' }, // the Durable Object binding: never passed
      CLOUDFLARE_API_TOKEN: 'never-passed',
      SOMETHING_ELSE: 'no',
      WORKER_ENABLED: 'true',
    });
    expect(env).toEqual({
      APP_ENV: 'staging',
      DATABASE_URL: 'postgresql://gobye_api.ref:pw@host:6543/postgres',
      ORIGIN_AUTH_SECRET: 's'.repeat(48),
      WHATSAPP_PROVIDER: 'none',
      R2_BUCKET_PREFIX: 'gobye-staging',
      WORKER_ENABLED: 'true',
      PORT: '8080',
      HOST: '0.0.0.0',
    });
  });

  it('keeps the container near the database and pings a dependency-free health path', () => {
    expect(LOCATION_HINT).toBe('weur');
    expect(KEEPALIVE_PATH).toBe('/health/live');
  });

  it('the staging template passes every setting the API reads, and no secret values', () => {
    const toml = readFileSync(new URL('../src/workers/api-container/wrangler.api-container.toml', import.meta.url), 'utf8');
    const vars = toml.slice(toml.indexOf('[env.staging.vars]'));
    const keys = [...vars.matchAll(/^([A-Z0-9_]+) = /gm)].map((m) => m[1]!);
    for (const k of keys) expect((CONTAINER_ENV_KEYS as readonly string[]).includes(k) || CONTAINER_ENV_PREFIXES.some((p) => k.startsWith(p)), k).toBe(true);
    for (const secret of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'DATABASE_CA_CERT', 'ORIGIN_AUTH_SECRET']) expect(keys).not.toContain(secret);
    expect(toml).toMatch(/instance_type = "basic"/);
    expect(toml).toMatch(/new_sqlite_classes = \["GobyeApi"\]/);
    expect(toml).toMatch(/image = "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/apps\/api\/Dockerfile"/);
  });
});
