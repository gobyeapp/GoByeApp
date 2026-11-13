# Data platform portability (D-065)

**Decision (owner, 2026-11-13):** GoBye **keeps Supabase** for the database (PostgreSQL) and sign-in (Supabase Auth). The system is kept ready for a later move to another provider, so that a move means configuration plus a data copy, not a rewrite.

**Where to see it:** admin → Technical → **Data platform** (`apps/admin/src/workspaces/infrastructure/DataPlatform.tsx`). The page shows:
- the providers in use;
- the readiness checks, with the file that proves each one;
- the move plan;
- the alternatives.

The content is in `packages/core/src/platform/dataPortability.ts`. It is reference material reviewed on 2026-11-13, not live monitoring.

## 1. Why a move stays small

| Check | State | Shown by |
|---|---|---|
| Migrations use standard PostgreSQL only (no Supabase extensions, Realtime, Edge Functions or Storage) | Ready | `apps/api/migrations` |
| All our data is in the `app` and `ops` schemas; Supabase's `auth`, `storage` and `public` are untouched | Ready | `DATABASE_MIGRATIONS.md` |
| Our own roles, created by a script that runs on any PostgreSQL | Ready | `apps/api/db/roles.sql` |
| The API reaches the database only via `DATABASE_URL` (no provider SDK) | Ready | `apps/api/src/database/database.ts` |
| Works through any transaction pooler (no start-up session settings) | Ready | `apps/api/test/pooler.test.ts` |
| Files live in Cloudflare R2, not in the database provider | Ready | `R2_STORAGE_ARCHITECTURE.md` |
| Sign-in is checked by public keys (JWKS); no Supabase SDK or service key | Ready | `apps/api/src/auth/jwt.ts` |
| **Another sign-in provider is a setting:** `AUTH_PROVIDER=oidc` + `AUTH_ISSUER`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE` | Ready (new) | `apps/api/test/auth-portability.test.ts` |
| Roles, cities and account status come from our database, never from the sign-in provider | Ready | `apps/api/src/auth/principal.ts` |
| User ids: people are keyed by their Supabase user id (UUID); a new provider must import users **with the same ids**, or we add a mapping table | **Needs work** | `0002_identity.sql` |
| Phone codes (D-045 / D-062) and staff two-step sign-in must exist at the new provider | **Needs work** | `AUTHENTICATION_PLAN.md` |
| Password hashes may not transfer between providers; otherwise users reset their password or sign in by code once | **Needs work** | — |

**The database can move today. Sign-in needs the three "Needs work" items solved first.**

## 2. Sign-in configuration (API)

| Setting | `supabase` (default) | `oidc` |
|---|---|---|
| Issuer | `${SUPABASE_URL}/auth/v1` | `AUTH_ISSUER` |
| Public keys | `${issuer}/.well-known/jwks.json` | `AUTH_JWKS_URL` (https in staging and production) |
| Audience | `SUPABASE_JWT_AUDIENCE` (`authenticated`) | `AUTH_AUDIENCE` |
| Second factor (staff MFA) | `aal = aal2` | `aal = aal2`, or `amr` containing `mfa`, `otp`, `hwk`, `swk` or `totp` |
| Refused | anonymous users, `role` other than `authenticated`, subject not a UUID | the same; a `role` other than `authenticated`, when present |

## 3. Move plan (database, sign-in, or both)

1. **Prepare**
   - decide the provider and approve its cost (owner);
   - create the target database and run `roles.sql`;
   - rehearse the whole move on staging;
   - set up the new sign-in provider, importing users with the same ids.
2. **Copy**
   - start a short write freeze: turn off WhatsApp booking and put the gateway in maintenance;
   - `pg_dump` the `app` and `ops` schemas, restore them as `gobye_migrator`, then run `grants.sql`;
   - `migrate.js status` must show every migration applied, with no checksum problems.
3. **Switch**
   - change `DATABASE_URL`, `DATABASE_MIGRATION_URL` and the CA certificate in the host's secret store;
   - for sign-in: set `AUTH_PROVIDER=oidc` and its three settings, and release app builds that sign in with the new provider.
4. **Verify**
   - run `migrate.js check-runtime`;
   - run `health-check.mjs` with the expected version;
   - a real sign-in reaches `/v1/me`;
   - row counts match the old database;
   - end the freeze and watch errors for an hour.
5. **Clean up**
   - keep the old project read-only for 30 days, then take a final backup and delete it;
   - revoke the old credentials and confirm they no longer work.

## 4. Alternatives (list prices checked 2026-11-05 by the [comparison source](https://flaviocopes.com/database-hosting-options.md); check again before buying)

| Provider | Covers | Free tier | Cheapest paid |
|---|---|---|---|
| Supabase (current) | Database and sign-in | 2 projects, 500 MB each; pauses after a week idle | $25/month (Pro) |
| Neon | Database (its own sign-in service is not yet checked) | 1 GB, 100 compute-hours a month | Pay as you go, $0.106 per compute-hour |
| PlanetScale Postgres | Database | None | $5/month, plus disk and backups |
| Railway | Database | 30-day trial, then $1 credit a month | $5/month |
| Prisma Postgres | Database | 2 GB, 200,000 operations a month | $10/month |

**Backup choice if Supabase's cost becomes a problem:** Neon for the database. A move also needs a sign-in provider that supports phone codes and keeps the same user ids.
