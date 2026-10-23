# Authentication integration plan: Supabase Auth + GoBye API (D-061)

**Status:**
- Server-side verification and permissions are built and tested with locally generated keys (`apps/api/test/auth.test.ts`).
- No real Supabase project is connected yet.
- The apps still use simulated sign-in (D-045, D-048).

## 1. Who does what

| Concern | Supabase Auth | GoBye API |
|---|---|---|
| Accounts, passwords, Apple/Google, email codes, phone OTP | ✓ (rate limits, hashing, OTP expiry) | — |
| Sessions: short access token + rotating refresh token, sign-out, revocation | ✓ | — |
| Staff second factor (TOTP) → `aal2` | ✓ | Requires `aal2` for staff permissions |
| Verifying a token on every request | — | ✓ JWKS, issuer, audience, expiry, role |
| Who the person is in GoBye (rider, driver, staff, status) | — | ✓ from `app.*` tables |
| What they may do (permissions, city scope, ownership) | — | ✓ |
| Account deletion | Deletes the auth user | Soft-deletes `app.users`, keeps legally required records (SECURITY_PRIVACY §9) |

Token claims such as `user_metadata` and `app_metadata` grant nothing. `user_metadata` is editable by the user. Roles live only in `app.staff_members`.

## 2. Token verification (built, `apps/api/src/auth/jwt.ts`)

- **Keys:** `GET {SUPABASE_URL}/auth/v1/.well-known/jwks.json`, through jose `createRemoteJWKSet`.
  - Cached for at most 10 minutes, matching Supabase's own edge cache.
  - An unknown `kid` triggers a refetch, rate limited to once per 30 seconds.
  - Fetch timeout is 3 seconds; if keys can't be fetched, sign-in checks fail with `503 service_unavailable`.
- **Algorithms:** ES256 and RS256. HS256 (the legacy shared secret) only when `SUPABASE_ALLOW_HS256=true`, which config refuses in staging and production.
- **Claims:**
  - `iss = {SUPABASE_URL}/auth/v1` and `aud = authenticated`;
  - `exp`/`nbf` with 5 seconds of leeway;
  - `sub` must be a UUID;
  - `role` must be `authenticated`.
- **Refused:** `role = anon`, `role = service_role` (a leaked service key must not act as a user), `is_anonymous = true`, `alg: none`, and keys outside the JWKS.
- **Used claims:**
  - `sub` → user id;
  - `aal` → MFA level;
  - `session_id`, `email` and `phone` (informational only).
- **Errors:**
  - missing or invalid token → `401 unauthenticated`;
  - expired → `401 TOKEN_EXPIRED` (the app refreshes and retries once);
  - suspended → `403 ACCOUNT_SUSPENDED`;
  - staff without a second factor → `403 MFA_REQUIRED`.

**Revocation:** access tokens are valid until expiry. Keep Supabase's access-token lifetime short (proposed 15 minutes; **owner to confirm**). Suspension in `app.users` and `app.staff_members` takes effect on the next request, because principals are read from the database on every request.

## 3. Principal and permissions (built, `apps/api/src/auth/principal.ts`, `guards.ts`)

- **One query per request:** `app.users` ⟕ `riders` ⟕ `drivers` ⟕ `staff_members`. It adds about 1 ms locally. Caching is deferred until measured.
- **Staff permissions:** `permissionsOf(roles)` from `packages/core/src/platform/permissions.ts`, the same table the admin UI uses.
- **Route rules:** routes declare `@RequirePermission('costs.manage')`, and every listed permission is needed.
- **Inside handlers:** ownership ("my ride", "my timeline") and city scope (`assertCityScope`) are checked in the handler.
- **No hints:** a caller without access to someone else's resource gets `404`, not `403`.

## 4. Steps to connect a real Supabase project (owner + engineering)

1. **Separate projects:** create separate Supabase projects for **staging** and **production** (region: Q-076).
2. **Signing keys:** Settings → JWT signing keys. Create an asymmetric (ECC P-256) key, make it current, and revoke the legacy secret once nothing uses it.
3. **Sign-in methods:** enable email + password, phone (SMS provider via Supabase, Q-065), Apple and Google, matching D-045 and D-048.
4. **Staff MFA:** enable MFA (TOTP) and require it for staff in the admin's sign-in flow.
5. **Token lifetime:** set the access-token lifetime (15 minutes proposed) and refresh-token reuse detection.
6. **API config:** set `SUPABASE_URL` on the API (staging first). No secret is needed for verification.
7. **Apps:** replace the mock `AuthService` with `@supabase/supabase-js` behind a feature switch. Keep the session in `expo-secure-store`. Send `Authorization: Bearer <access_token>` through `createApiClient`.
8. **Profile:** after sign-up, the app calls `POST /v1/me/profile` (Phase 2) to create `app.users` and `app.riders` / `app.drivers`. Until then `/v1/me` reports `signupComplete: false`.
9. **Staff records:** admin staff are created by an owner through `staff.manage` (Phase 2). The first owner row is inserted once by hand with the migrator role, and that insert is recorded in the audit log.

## 5. Tests that must pass against the real staging project

- [ ] A token from a real staging sign-in → `GET /v1/me` 200
- [ ] Rotate the signing key; old tokens keep working until expiry; new tokens verify without an API restart
- [ ] A token from the **production** project is refused by staging, and the reverse (different issuer)
- [ ] The staff session without TOTP gets `MFA_REQUIRED`; with TOTP it gets its role permissions
- [ ] A suspended person is refused on their next request
- [ ] Phone OTP rate limits and Apple/Google sign-in work in the apps (manual)

## 6. Rider and driver verification: PROPOSED change to D-045 / D-048 (D-062, not approved)

**Status:** proposal only. D-045 ("every sign-in ends with a phone code") stays the recorded decision until the owner approves D-062 and `DECISIONS.md` is updated.

| Moment | D-045 / D-048 as written | D-062 proposal |
|---|---|---|
| Sign-up | Phone code | Phone code (unchanged): the number must be proven before booking or driving |
| Sign-in, trusted device | Phone code every time | Password, Apple or Google only |
| Sign-in, new or untrusted device | Phone code | Phone code, then the device is remembered (revocable) |
| Change phone, email, password; payout or bank details; withdrawals; account deletion | Not specified | Fresh phone code (≤ 5 min) as a step-up; notice to the old phone and email; 24-hour hold on payout changes after a phone change |
| Sessions | 15 min proposed (A-6) | 15 min access token; refresh rotation with reuse detection; sign-out revokes |
| Staff | TOTP (`aal2`) | Unchanged |
| Supabase add-on | Advanced MFA (Phone): $75/month for the first project and $10 for each additional, if done with Supabase MFA | **None.** Phone verification through the SMS provider or Send SMS hook (A-4). The add-on is **not** enabled without explicit approval. |

**Abuse controls:**
- OTP rate limits per number, per device and per IP;
- Nigerian numbers only at launch;
- Turnstile CAPTCHA before OTP on web;
- SMS spend alerts;
- an audit row for each verification and step-up.

**Phase 2 work if approved:**
- `app.user_devices` table;
- `POST /v1/me/devices/verify`;
- the `@RequireRecentVerification()` guard;
- app screens for device verification and step-up;
- tests.
