# Vigihat micro-SaaS architecture

## Implemented product boundary

The local CLI remains the trusted operator tool and automation client. The hosted
Vigihat application in `web/` adds a multi-tenant control plane without putting
shared credentials into CLI configuration.

## Tenant model

```text
Organization
  ├── Brand
  ├── Members (owner, admin, analyst, operator, viewer)
  ├── Google Ads connections
  │     ├── OAuth authorization
  │     ├── developer-token reference
  │     └── MCC customer ID
  ├── Client accounts
  │     ├── Google Ads customer ID
  │     ├── currency and timezone
  │     └── approval policy
  └── Audit events
```

Every database row that contains organization-owned data must carry an immutable
`organization_id`. Authorization must apply that boundary before any query or
mutation reaches Google Ads.

## Credentials

- Encrypt OAuth refresh tokens with an envelope-encryption key outside the
  database.
- Keep developer tokens in a managed secret store and reference them by opaque ID.
- Support both a platform-owned developer token and bring-your-own-token mode.
- Never return refresh tokens, client secrets or developer tokens to the browser.
- Record token creation, rotation, revocation and last successful use.

## Approval and safety

- Read operations may run immediately according to role.
- Every write is first executed with Google Ads `validate_only` when supported.
- Organizations choose whether writes require one or two approvers.
- Approval records contain the exact resource, previous value, proposed value,
  actor, approver and expiry time.
- An idempotency key protects every production mutation from retries.
- Audit events are append-only and exportable.

## Services

1. **Web application**: Next.js organization, brand, clients, reports and approvals.
2. **Gateway**: tenant-aware Google Ads REST v24 commands inside the server runtime.
3. **Postgres**: Neon workspaces, clients, encrypted connections, approvals and audit events.
4. **Identity**: Clerk sessions, organizations, membership and roles.
5. **Secret store**: Vercel environment secrets plus encrypted OAuth material in Postgres.

Scheduled monitoring, a durable worker/queue and billing remain commercial-phase work.

The Google Ads gateway in `src/vigie_ads/google_api.py` should remain behind a
small service interface. That prevents Google API version changes from leaking
into the web, CLI and worker layers.

## Product phases

### Phase 1 — operator product

- CLI profiles and white-label branding;
- read-only reports and guarded mutations;
- configuration export that excludes secrets;
- one operator's system keychain and OAuth identity.

### Phase 2 — collaborative control plane (implemented)

- organizations and memberships;
- hosted OAuth callback;
- encrypted credential storage;
- client invitations and role-based access;
- approval queue and audit log.

### Phase 3 — commercial micro-SaaS

- subscriptions and usage metering;
- scheduled monitoring and alerts;
- reusable campaign blueprints;
- agency white label and custom domain;
- customer-facing reports;
- per-tenant data export and deletion workflows.

## Non-negotiable launch gates

- tenant-isolation tests at API and database levels;
- documented Google Ads API permissible-use scope;
- OAuth brand verification and privacy policy;
- encrypted backups and credential rotation runbook;
- immutable mutation audit trail;
- tested account offboarding, data export and deletion.
