/**
 * Data platform portability (D-065, docs/DATA_PLATFORM_PORTABILITY.md).
 *
 * GoBye keeps Supabase for the database (PostgreSQL) and sign-in (Supabase Auth). This module records,
 * as reviewed facts, why a later move to another provider stays a configuration and data-copy job rather
 * than a rewrite, which providers could take over, and the steps of a move. The admin "Data platform"
 * page shows it. Nothing here is live status: each check names the file that proves it, and prices carry
 * the date they were read.
 */

export type DataArea = 'database' | 'auth';

export interface DataPlatformComponent {
  area: DataArea;
  label: string;
  provider: string;
  /** Where it runs today, per environment. */
  environments: { name: 'staging' | 'production'; state: string }[];
  /** How the API is pointed at it: what changes in a move. */
  configuredBy: string[];
}

export const DATA_PLATFORM_AS_OF = '2026-11-13';

export const DATA_PLATFORM: DataPlatformComponent[] = [
  {
    area: 'database',
    label: 'Database',
    provider: 'Supabase (PostgreSQL)',
    environments: [
      { name: 'staging', state: 'Staging project created 2026-11-07 in Europe; roles created; migrations next' },
      { name: 'production', state: 'Not created' },
    ],
    configuredBy: ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'DATABASE_SSL', 'DATABASE_CA_CERT'],
  },
  {
    area: 'auth',
    label: 'Sign in',
    provider: 'Supabase Auth',
    environments: [
      { name: 'staging', state: 'Staging project created; sign in settings not configured yet' },
      { name: 'production', state: 'Not created' },
    ],
    configuredBy: ['AUTH_PROVIDER', 'SUPABASE_URL (supabase)', 'AUTH_ISSUER, AUTH_JWKS_URL, AUTH_AUDIENCE (oidc)'],
  },
];

export type CheckStatus = 'ready' | 'attention';

export interface PortabilityCheck {
  id: string;
  area: DataArea;
  label: string;
  status: CheckStatus;
  /** Why, in one line. */
  detail: string;
  /** File or document that shows it. */
  evidence: string;
}

export const PORTABILITY_CHECKS: PortabilityCheck[] = [
  { id: 'standard-sql', area: 'database', label: 'Standard PostgreSQL only', status: 'ready', detail: 'Migrations use plain PostgreSQL 15+ features: no Supabase extensions, Realtime, Edge Functions or Storage.', evidence: 'apps/api/migrations' },
  { id: 'own-schemas', area: 'database', label: 'Our data lives in our own schemas', status: 'ready', detail: 'Everything is in the app and ops schemas. Supabase’s auth, storage and public schemas are not touched.', evidence: 'docs/DATABASE_MIGRATIONS.md' },
  { id: 'own-roles', area: 'database', label: 'Our own database roles', status: 'ready', detail: 'gobye_migrator and gobye_api are created by a script that runs on any PostgreSQL.', evidence: 'apps/api/db/roles.sql' },
  { id: 'url-config', area: 'database', label: 'Connection by configuration', status: 'ready', detail: 'The API reaches the database only through DATABASE_URL; no provider SDK is used.', evidence: 'apps/api/src/database/database.ts' },
  { id: 'pooler-safe', area: 'database', label: 'Works through any connection pooler', status: 'ready', detail: 'No session settings at connection start; tested through PgBouncer in transaction mode.', evidence: 'apps/api/test/pooler.test.ts' },
  { id: 'files-elsewhere', area: 'database', label: 'Files are not in the database provider', status: 'ready', detail: 'Uploads go to Cloudflare R2, so a database move copies no files.', evidence: 'docs/R2_STORAGE_ARCHITECTURE.md' },
  { id: 'jwks', area: 'auth', label: 'Sign in is checked by public keys (JWKS)', status: 'ready', detail: 'The API verifies signed tokens; no Supabase SDK or service key is needed.', evidence: 'apps/api/src/auth/jwt.ts' },
  { id: 'oidc-switch', area: 'auth', label: 'Another sign in provider is a setting', status: 'ready', detail: 'AUTH_PROVIDER=oidc with an issuer, JWKS URL and audience accepts any standard OIDC provider.', evidence: 'apps/api/test/auth-portability.test.ts' },
  { id: 'permissions-in-db', area: 'auth', label: 'Roles and permissions are ours', status: 'ready', detail: 'Staff roles, cities and account status come from our database, never from the sign in provider.', evidence: 'apps/api/src/auth/principal.ts' },
  { id: 'user-ids', area: 'auth', label: 'User ids must move with the users', status: 'attention', detail: 'People are keyed by their Supabase user id (UUID). A new provider must import users with the same ids, or a mapping table is needed.', evidence: 'apps/api/migrations/0002_identity.sql' },
  { id: 'phone-otp', area: 'auth', label: 'Phone codes need a replacement', status: 'attention', detail: 'Phone verification (D-045 / D-062) and staff second factor sign in must exist at the new provider before switching.', evidence: 'docs/AUTHENTICATION_PLAN.md' },
  { id: 'passwords', area: 'auth', label: 'Passwords may not transfer', status: 'attention', detail: 'Whether password hashes can be exported and imported depends on both providers; otherwise users reset or sign in by code once.', evidence: 'docs/DATA_PLATFORM_PORTABILITY.md' },
];

export interface ProviderOption {
  id: string;
  name: string;
  covers: DataArea[];
  freeTier: string;
  cheapestPaid: string;
  notes: string;
  source: string;
}

/** Read 2026-11-13 from a comparison whose prices were checked 2026-11-05 (source on each row). */
export const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'supabase', name: 'Supabase (current)', covers: ['database', 'auth'], freeTier: '2 projects, 500 MB each; pauses after a week idle', cheapestPaid: '$25/month (Pro): backups, no pausing', notes: 'Database and sign in together.', source: 'https://flaviocopes.com/database-hosting-options.md' },
  { id: 'neon', name: 'Neon', covers: ['database'], freeTier: '1 GB, 100 compute hours a month', cheapestPaid: 'Pay as you go, no minimum ($0.106 per compute hour)', notes: 'Real PostgreSQL; scales to zero. Offers its own sign in service, not yet checked.', source: 'https://flaviocopes.com/database-hosting-options.md' },
  { id: 'planetscale', name: 'PlanetScale Postgres', covers: ['database'], freeTier: 'None', cheapestPaid: '$5/month single node, plus disk and backups', notes: 'Needs a separate sign in provider.', source: 'https://flaviocopes.com/database-hosting-options.md' },
  { id: 'railway', name: 'Railway', covers: ['database'], freeTier: '30 day trial, then $1 credit a month', cheapestPaid: '$5/month (Hobby)', notes: 'Needs a separate sign in provider.', source: 'https://flaviocopes.com/database-hosting-options.md' },
  { id: 'prisma', name: 'Prisma Postgres', covers: ['database'], freeTier: '2 GB, 200,000 operations a month', cheapestPaid: '$10/month (Starter)', notes: 'Needs a separate sign in provider.', source: 'https://flaviocopes.com/database-hosting-options.md' },
];

export type MigrationPhase = 'prepare' | 'copy' | 'switch' | 'verify' | 'clean up';

export interface MigrationStep {
  id: string;
  phase: MigrationPhase;
  area: DataArea | 'both';
  title: string;
  detail: string;
  /** Needs the owner's account, a decision or a paid activation. */
  owner: boolean;
}

export const MIGRATION_PHASES: MigrationPhase[] = ['prepare', 'copy', 'switch', 'verify', 'clean up'];

export const MIGRATION_STEPS: MigrationStep[] = [
  { id: 'decide', phase: 'prepare', area: 'both', title: 'Decide the target and approve the cost', detail: 'Pick the provider, region and plan; record the decision.', owner: true },
  { id: 'target', phase: 'prepare', area: 'database', title: 'Create the target database', detail: 'Same PostgreSQL major version or newer, near the API; run roles.sql there.', owner: true },
  { id: 'rehearse', phase: 'prepare', area: 'database', title: 'Rehearse on staging first', detail: 'Do the whole move with staging data; time the copy; fix what breaks.', owner: false },
  { id: 'auth-ready', phase: 'prepare', area: 'auth', title: 'Set up the new sign in provider', detail: 'Phone codes, email sign in, staff second factor, token lifetimes; users imported with the same ids.', owner: true },
  { id: 'freeze', phase: 'copy', area: 'database', title: 'Announce and start a short write freeze', detail: 'Turn off new bookings (the WhatsApp booking switch and maintenance mode at the gateway) so nothing changes during the copy.', owner: true },
  { id: 'dump', phase: 'copy', area: 'database', title: 'Copy the app and ops schemas', detail: 'pg_dump of app and ops from the old database, restore into the new one as gobye_migrator, then grants.sql.', owner: false },
  { id: 'status', phase: 'copy', area: 'database', title: 'Check the migration log', detail: 'migrate.js status on the new database must show every migration applied and no checksum problems.', owner: false },
  { id: 'point', phase: 'switch', area: 'database', title: 'Point the API at the new database', detail: 'Change DATABASE_URL, DATABASE_MIGRATION_URL and the CA certificate in the host’s secret store; redeploy.', owner: false },
  { id: 'auth-switch', phase: 'switch', area: 'auth', title: 'Switch sign in', detail: 'Set AUTH_PROVIDER=oidc with the new issuer, JWKS URL and audience; release app builds that sign in with the new provider.', owner: false },
  { id: 'runtime', phase: 'verify', area: 'database', title: 'Run the runtime check', detail: 'The migrate.js runtime check: role timeouts, TLS, no DDL rights, bypassrls.', owner: false },
  { id: 'smoke', phase: 'verify', area: 'both', title: 'Health and smoke tests', detail: 'The health check script passes with the expected version; a real sign in reaches /v1/me; row counts match the old database.', owner: false },
  { id: 'unfreeze', phase: 'verify', area: 'database', title: 'End the write freeze', detail: 'Turn bookings back on; watch errors for an hour.', owner: true },
  { id: 'keep-old', phase: 'clean up', area: 'both', title: 'Keep the old project read only for 30 days', detail: 'A fallback while confidence builds; then export a final backup and delete it.', owner: true },
  { id: 'rotate', phase: 'clean up', area: 'both', title: 'Retire old credentials', detail: 'Revoke the old database passwords and keys and confirm they no longer work.', owner: true },
];

export function portabilitySummary(checks: PortabilityCheck[] = PORTABILITY_CHECKS): Record<DataArea, { ready: number; attention: number }> {
  const out: Record<DataArea, { ready: number; attention: number }> = { database: { ready: 0, attention: 0 }, auth: { ready: 0, attention: 0 } };
  for (const c of checks) out[c.area][c.status === 'ready' ? 'ready' : 'attention']++;
  return out;
}

/** Steps for one kind of move, in order (a database-only move skips the sign-in steps). */
export function migrationPlan(move: DataArea | 'both', steps: MigrationStep[] = MIGRATION_STEPS): MigrationStep[] {
  return steps
    .filter((s) => move === 'both' || s.area === 'both' || s.area === move)
    .sort((a, b) => MIGRATION_PHASES.indexOf(a.phase) - MIGRATION_PHASES.indexOf(b.phase));
}
