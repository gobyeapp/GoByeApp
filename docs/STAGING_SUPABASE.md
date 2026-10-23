# Supabase staging project: design and owner steps (Phase 1.5)

**Status (2026-10-23):** designed, **not created**. No Supabase project, role, key or setting was created or changed by this work. Creating the project and handling its credentials is an **owner action** (steps in §4). Staging is **not ready** until §6 passes against a deployed API.

**Rules:**
- A **new, dedicated** project. Never the website project `morqitxqsfiprefczduo`, which holds the waitlist and the demo tables (`anon` can write to the demo tables). Nothing moves from it.
- **No paid plan without written approval.** The design below fits the **Free** plan.
- Secrets go only into the password manager and the host's encrypted variables. Never into git, chat, logs, screenshots or verification reports.

## 1. Plan: Free, upgrade only on approval

| Need | Free plan (supabase.com/pricing, read 2026-10-23) | Fits staging? |
|---|---|---|
| Projects | 2 active projects per account | **Yes, if** the waitlist project is the only other active one. Otherwise the owner must pause one or approve Pro. |
| Database | 500 MB, shared compute | Yes (staging data is synthetic) |
| Auth | 50,000 MAU | Yes |
| Egress | 5 GB | Yes for team testing |
| Backups | None | Acceptable for staging only. Production needs Pro with daily backups (A-7). |
| Logs | 1 day retention | Acceptable. API logs are kept by the host. |
| Pausing | Paused after **1 week without activity** | A paused project fails `/health/ready` (503). Resume it from the dashboard. Do not script fake traffic to dodge the rule. |
| Phone MFA add-on | Paid add-on, **not enabled** (D-062 proposed) | Not needed |
| Spend cap | Pro has a spend cap on by default | If Pro is approved later, keep the spend cap **on** |

## 2. Connections

| Use | Mode | Host and port | Database user | Variable |
|---|---|---|---|---|
| API and worker (runtime) | Supavisor **transaction** | `aws-0-<region>.pooler.supabase.com:6543` | `gobye_api.<ref>` | `DATABASE_URL` |
| Migrations, `roles.sql`, `grants.sql` | Supavisor **session** (5432 on the pooler) or the direct host `db.<ref>.supabase.co:5432` (IPv6 only unless the IPv4 add-on is bought; do not buy it) | as left | `gobye_migrator.<ref>` (pooler) or `gobye_migrator` (direct); admin steps as `postgres` | `DATABASE_MIGRATION_URL` |
| TLS | `DATABASE_SSL=verify-full` with the project's root certificate | | | `DATABASE_CA_CERT` |

**C-1 (fixed in Phase 1.5):** the API sends **no session settings at connection start**. In transaction mode a session setting is not preserved between transactions, and PgBouncer refuses a `statement_timeout` start-up parameter outright. Timeouts now come from:
- the role (`apps/api/db/roles.sql`: `statement_timeout 5s`, `lock_timeout 3s`, `idle_in_transaction_session_timeout 30s`);
- `SET LOCAL` in every transaction;
- a client-side `query_timeout` on every query.

The regression tests (`apps/api/test/pooler.test.ts`) pass through **PgBouncer** in transaction mode. **PgBouncer is not Supavisor.** Compatibility with Supavisor is proven only by `migrate.js check-runtime` and the smoke tests in §6, run against the staging project.

**Not yet verified on Supabase:**
- that `postgres` may run `alter role gobye_api bypassrls` (it has `BYPASSRLS` itself; locally the same grant works from a non-superuser with `CREATEROLE` + `BYPASSRLS`);
- that Supavisor accepts the `application_name` start-up parameter (PgBouncer does);
- that role settings apply to Supavisor's server connections (they do on PgBouncer, which opens server connections as the role).

If `bypassrls` is refused, add a migration with `using (true)` policies for `gobye_api` on each `app` and `ops` table (`DATABASE_MIGRATIONS.md`).

## 3. Variables (names only; values go to the host's secret store)

**API and worker** (`apps/api/env/staging.env.example`; ★ = secret):

| Variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `DATABASE_URL` ★ | transaction-pooler URL, user `gobye_api.<ref>` |
| `DATABASE_MIGRATION_URL` ★ | session-pooler or direct URL, user `gobye_migrator` |
| `DATABASE_SSL` / `DATABASE_CA_CERT` | `verify-full` / the project's root certificate (newlines as `\n`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co`. Tokens are verified with the project's JWKS. **No JWT secret and no service-role key** is needed or accepted (`config.ts` refuses the legacy secret in staging). |
| `STAFF_REQUIRE_MFA` | `true` (enforced) |
| `ORIGIN_AUTH_REQUIRED` / `ORIGIN_AUTH_SECRET` ★ | `true` / 32+ random characters, equal to the staging gateway Worker's secret |
| `CORS_ORIGINS` | `https://admin-staging.gobye.app` (https origins only, no wildcard; enforced) |
| Providers | `PAYMENTS_PROVIDER=simulated`, `MAPS_PROVIDER=fake`, `NOTIFICATIONS_PROVIDER=log`, `STORAGE_PROVIDER=none` |

**Apps and admin (Phase 2, not read yet):** `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`, placeholders in each `.env.example`. Only the **publishable** key (or legacy anon key) is public. `npm run check:env` refuses secrets in public variables.

**Never used anywhere in GoBye code:** the project's secret / `service_role` key and the legacy JWT secret. If a future job needs admin access to Auth, it gets its own key in the worker's secret store, decided then.

## 4. Owner steps (in order; each one needs the owner's account)

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | Confirm the Free plan (or approve Pro in writing), and the region (Q-076: the region closest to Lagos that Supabase offers, e.g. `eu-west-2` London or `eu-central-1` Frankfurt; confirm latency in N2) | Owner | Decision recorded in OPEN_QUESTIONS Q-076 |
| 2 | Create project `gobye-staging` in a **new** organisation or the existing one. Generate the database password in the password manager; never type it into chat. | Owner | Project ref noted (the ref is not secret) |
| 3 | Settings → JWT signing keys: create an **asymmetric (ECC P-256)** key, make it current. Move to the new API keys (publishable / secret) and **disable the legacy JWT-based keys** for this project. | Owner | JWKS endpoint lists an ES256 key |
| 4 | Settings → Database → SSL: download the root certificate; turn on **Enforce SSL**. | Owner | Certificate stored in the password manager |
| 5 | Run `apps/api/db/roles.sql` as `postgres` over a **session** connection, passwords from the password manager via `psql -v` (the file's header has the command). | Owner (or engineering on a call, with the owner typing secrets) | `roles.sql` completes; no password appears in shell history (use `read -s`) |
| 6 | Set the staging variables on the host (§3), then run the release step `migrate.js up`, then `grants.sql` as `gobye_migrator`. | Owner sets secrets; engineering runs the commands from the host's shell or CI | `migrate.js status` → `Pending: none` |
| 7 | `node apps/api/dist/apps/api/src/migrate.js check-runtime` with the **transaction-pooler** `DATABASE_URL` | Engineering | Prints `Runtime connection OK` (role timeouts 5s/3s/30s, `bypassrls: true`, cannot create, no secret printed) |
| 8 | Auth: email + password on; phone sign-up verification with the SMS provider or Send SMS hook (A-4; **no Advanced MFA Phone add-on**); TOTP MFA on for staff; access-token lifetime 15 min (A-6); refresh-token rotation and reuse detection on; redirect URLs for the apps' deep links only. | Owner | Settings screenshot without keys, or a written list |
| 9 | Network restrictions: allow database connections only from the host's egress addresses, if the host publishes fixed ones. | Owner | Recorded |

**Do not:** reuse or migrate the waitlist project; enable paid add-ons (phone MFA, IPv4, PITR, custom domain) without approval; expose the database publicly beyond Supabase's own TLS endpoints.

## 5. What staging must never hold

Real riders' or drivers' personal data, real documents, real payments, or production keys. Staging uses synthetic people and test-mode providers.

## 6. Staging is ready only when all of these pass against the deployed API

- [ ] `migrate.js status`: `Pending: none` on the staging project
- [ ] `migrate.js check-runtime` through the **transaction pooler**: OK (C-1 proven on Supavisor)
- [ ] `node apps/api/scripts/health-check.mjs https://<origin> --expect-version <sha>`: all pass, `ready` = `ok` (not degraded: JWKS reachable)
- [ ] The same through the gateway: `https://api-staging.gobye.app`
- [ ] A real staging sign-in token → `GET /v1/me` 200; a token from another project → 401 (AUTHENTICATION_PLAN §5)
- [ ] Origin without the gateway signature → `403` on `/v1/*` (S1)
- [ ] Restart the API during a request burst: no 5xx beyond the restart window; the worker resumes leased jobs

Until every box is ticked, the verification report says **staging not ready**.
