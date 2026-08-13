# Better Auth cutover runbook

This runbook is intentionally fail-closed. Do not point a Better Auth deployment at
the current production database until every preflight item passes. Keep all Google
mutations, Checkout, notifications, scheduler and public beta disabled throughout the
identity cutover.

## Preconditions

1. Use a separate Vercel staging project and a separate Neon branch or project.
2. Provision independent 32-byte-or-longer `BETTER_AUTH_SECRET` values per environment.
3. Create a dedicated Google OAuth web client for Better Auth. Register
   `/api/auth/callback/google` on the exact staging and production origins.
4. Verify the Resend sending domain and configure `AUTH_FROM_EMAIL`.
5. Provision four restricted database login credentials whose memberships are
   respectively `yodev_app`, `yodev_system`, `yodev_purge` and `yodev_auth`; store
   their URLs only as `DATABASE_AUTHENTICATED_URL`, `DATABASE_SYSTEM_URL`,
   `DATABASE_PURGE_URL` and `DATABASE_AUTH_URL`.
6. Export a fresh Neon restore point and record the branch ID and migration ledger.

## Staging migration

```bash
cd web
npm ci
npm run db:migrate
npm run db:seed-rls-fixtures
npm run db:verify-tenants
npm run db:validate-tenant-constraints
npm run db:verify-rls
npm run db:verify-concurrency
```

The migration ledger must contain every migration through
`0031_better_auth_expansion.sql`. The RLS verifier must report four runtime roles and
the tenant verifier must report zero violations for every identity invariant.

## Identity import

The importer is a dry-run unless both safeguards are set. The confirmation value must
be the exact target database host, which prevents an accidental import into another
Neon branch.

```bash
npm run auth:migrate-clerk

BETTER_AUTH_MIGRATION_APPLY=1 \
BETTER_AUTH_MIGRATION_CONFIRM_HOST='<exact-target-host>' \
npm run auth:migrate-clerk

npm run db:verify-tenants
npm run db:verify-rls
```

Only Clerk users with a verified e-mail are imported. Legacy organization IDs that no
longer exist are resolved by an exact, unique organization slug; ambiguous mappings
abort the whole transaction. Password hashes are not imported. Existing users enter
through Google or the password-reset flow, and can then register a passkey.

## Authenticated acceptance matrix

Before production cutover, exercise in both French and English:

- registration, mandatory e-mail verification and one-time trial;
- Google login, password reset, passkey registration and session revocation;
- organization switching and invitation acceptance;
- owner, admin, operator, analyst and viewer permissions through direct Server Actions;
- member quota under concurrent invitations;
- revocation, ownership transfer and workspace deletion;
- suspended/grace/deletion lifecycle access;
- CSP on sign-in, sign-up, reset and invitation routes.

## Production sequence

1. Enter maintenance/read-only mode and stop scheduler and notification workers.
2. Create a fresh restore point, then apply migrations through `0031`.
3. Run the importer dry-run, compare counts, then run the guarded apply once.
4. Run tenant, constraint and RLS verifiers against production.
5. Deploy Better Auth secrets and restricted DB URLs, then deploy the new application.
6. Smoke-test the internal Yodev account and both migrated workspaces.
7. Keep the legacy Clerk secret for rollback export only; remove it after the agreed
   rollback window. Remove the Clerk Vercel integration and obsolete routing variables
   only after successful acceptance.
8. Re-enable read jobs first. Re-enable notifications, Checkout and Google mutations
   separately only after their own provider gates pass.

## Rollback

If failure occurs before any new Better Auth identity activity, redeploy the previous
Clerk build and restore the pre-cutover database branch. If Better Auth has accepted
new users, invitations or credentials, do not overwrite those records blindly: keep
the application in maintenance mode, export the delta, and perform a reviewed forward
repair. Database restoration must reapply deletion tombstones before tenant access is
enabled.
