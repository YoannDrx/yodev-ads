# Ads by Yodev Web

The Ads by Yodev hosted control plane is a Next.js 16 App Router application using
Better Auth organizations/passkeys, Neon Postgres, Drizzle ORM, shadcn/ui and the official Google
Ads REST API.

## Commands

```bash
npm run dev          # local Next.js server
npm run check        # CI-equivalent lint, types, coverage, build and runtime audit
npm run test:e2e     # Playwright public-route smoke tests
npm run release:verify # full code/config/authenticated promotion gate
npm run db:generate  # generate a reviewed Drizzle migration
npm run db:migrate   # apply committed migrations
npm run db:verify-rls # verify RLS, runtime roles and cross-tenant isolation
npm run db:verify-concurrency # verify quota/claim/lease/idempotence/purge races
npm run db:verify-load # verify target database volumes, scheduler races and pool bounds
npm run auth:migrate-clerk # dry-run the one-time Clerk -> Better Auth identity import
```

Copy `.env.example` to `.env.local` outside Vercel. Production, preview and local
development values are managed with `vercel env`.

All commercial or externally mutating capabilities fail closed. Enable their
documented environment flags deliberately per environment; `FORCE_READ_ONLY=1`
overrides Google Ads writes immediately. Checkout also requires an explicit
`STRIPE_TAX_MODE` and approved B2B legal-document versions. No consumer Checkout is
available. Stripe Tax remains blocked until its validation flag is set.

## Security contract

- Application routes use transaction-scoped workspace/user context through the
  tenant-aware repository/service layer. A CI boundary rejects direct Drizzle,
  schema and transaction imports from every App Router file, with no migration
  allowlist. Member, workspace-setting, MCC inventory, monitoring/alerts, tasks,
  billing, support/status operations, Google approval/execution, API-key,
  notification-channel, dead-letter retry, safety-policy, report-template and
  scheduled/public-report, OTP, feedback and global subprocessor-change workflows use
  dedicated tested services. Subprocessor notices are system-role-only and fan out
  idempotent tenant delivery jobs with per-workspace audit evidence.
  Custom-domain DNS/Vercel state transitions and their failure recording use the same
  boundary, as do export requests and deletion/purge lifecycle claims. Tenant tables
  are independently protected by Postgres RLS and composite tenant foreign keys; the
  application role must not have `BYPASSRLS`.
- Better Auth uses its own least-privilege `yodev_auth` role and credential. The
  tenant application role cannot read authentication tables, while the auth role can
  read only the workspace organization mapping and plan required by session callbacks.
- Jobs, webhooks, retention and purge use explicit system transactions and a separate
  database role. Cached pools are bounded by `DATABASE_POOL_MAX`, and CI rejects
  concurrent query batches inside one transaction callback. The application role
  cannot update or delete audit events.
- Every Server Action and Google Ads route revalidates authentication and role.
- Google refresh tokens are encrypted with a 32-byte envelope key before storage.
- Google Ads, Slack and Teams callbacks use signed, expiring, provider/tenant/actor-bound
  OAuth state. Teams additionally uses PKCE and never persists Microsoft access tokens.
- Slack provisions a workspace-selected incoming webhook through OAuth. Teams posts with
  delegated Microsoft Graph permissions; refresh tokens and webhook destinations remain
  encrypted, rotate optimistically and are destroyed locally when a channel is disabled.
- Google Ads writes are first submitted with `validateOnly: true`.
- Validated writes enter an approval queue and execute once, using an atomic claim.
- Sensitive events are written to the organization audit trail.
- The request proxy emits a nonce-based strict CSP and Next.js emits restrictive browser headers.
- Public reports bind custom hosts to the owning workspace and never place bearer
  tokens in internal query strings or application logs.
- Generic webhooks are DNS-validated and their HTTPS sockets are pinned to those
  public addresses, closing the validation-to-connection DNS rebinding window.

Committed migrations are not applied automatically. Rehearse them on a staging clone,
run the tenant/RLS verification scripts and test rollback before any production
cutover. The detailed and deliberately conservative readiness ledger is
[`docs/IMPLEMENTATION_STATUS.md`](../docs/IMPLEMENTATION_STATUS.md).
The exact identity migration and rollback sequence is documented in
[`docs/BETTER_AUTH_CUTOVER.md`](../docs/BETTER_AUTH_CUTOVER.md).

CI also migrates a disposable PostgreSQL 17 database, seeds two isolated tenants,
and executes the RLS, role, composite-constraint and tenant-invariant verifiers.
It also exercises concurrent quota enforcement, approval claim, job lease, Stripe
event idempotence and deletion claim/cascade behavior against real PostgreSQL.
The database load verifier adds 100 workspaces, a 50-account Agency, 200 monitors,
10,000 deliveries, 1,000 report reads and 100 simultaneous approvals; it checks
stable cursor pagination, concurrent scheduler deduplication and the configured pool
ceiling. All fixtures are deterministic and removed after the run.
Production keeps the Neon transaction driver; `DATABASE_DRIVER=node-postgres` is an
explicit integration-test adapter and never inferred from the connection URL.

## Native notification connectors

Slack requires `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` for an app whose redirect
URL is `/api/connectors/slack/callback` and whose only requested scope is
`incoming-webhook`. Microsoft Teams requires `MICROSOFT_CLIENT_ID` and
`MICROSOFT_CLIENT_SECRET`; register `/api/connectors/teams/callback` and grant the
delegated scopes `ChannelMessage.Send`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`
plus `offline_access`. Set a distinct `OAUTH_STATE_KEY` of at least 32 characters in
each environment. Keep `NOTIFICATIONS_ENABLED=0` until both staging flows and their
revocation behavior have been exercised.
