# GoBye API (`apps/api`)

NestJS 12 on Fastify 5, Node 22, Supabase PostgreSQL and Auth. Phase 1 foundation: built and tested locally, **not deployed**.

Design and status: [`docs/BACKEND_ARCHITECTURE.md`](../../docs/BACKEND_ARCHITECTURE.md). Endpoints: [`docs/API_CONTRACTS.md`](../../docs/API_CONTRACTS.md) §10.

## Run locally

You need Node 22 and PostgreSQL 15+ (local install, or `docker compose up db` in this folder).

```bash
# from the repository root
npm install
cp apps/api/env/development.env.example apps/api/.env   # then edit DATABASE_URL etc.
npm run build -w apps/api
npm run migrate -w apps/api -- up        # create the schema
npm run start -w apps/api                # http://localhost:8080/health/ready
```

With a Supabase **development** project, set `SUPABASE_URL` and sign in from an app or the Supabase dashboard to get a token. Then try:

```bash
curl -H "Authorization: Bearer <token>" localhost:8080/v1/me
```

## Test

```bash
npm test -w apps/api
```

- The tests compile to `dist-test/` and run with `node:test`.
- Database tests create and drop a throwaway database on `TEST_DATABASE_ADMIN_URL`. The default is `postgres://gobye:gobye_local_only@127.0.0.1:5432/postgres`; the role needs `CREATEDB`.
- Without Postgres, those tests are skipped with the reason printed.

## Build the image

From the **repository root** (the API compiles `packages/core` into itself):

```bash
docker build -f apps/api/Dockerfile --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t gobye-api .
```

One image, three commands:

| Command | What it runs |
|---|---|
| Default | The API, listening on `$PORT` (8080) |
| `node apps/api/dist/apps/api/src/worker.js` | The job worker |
| `node apps/api/dist/apps/api/src/migrate.js status\|up [--confirm-production]` | Migrations |

## After a deploy

```bash
node apps/api/scripts/health-check.mjs https://api-staging.gobye.app --expect-version <sha>
```

## Rules

- Never commit `.env` files or secrets. Staging and production values live in the host's secret store.
- No real money: no wallet, ledger, payouts or webhooks until the reviews in `BACKEND_ARCHITECTURE.md` §9 are done.
- Migrations are forward-only and are never edited after they are applied (`docs/DATABASE_MIGRATIONS.md`).
- Business rules come from `@gobye/core`. Don't re-implement them here.
