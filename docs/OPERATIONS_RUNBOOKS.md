# Ads by Yodev — operational runbooks

Last reviewed: 2026-08-13. These procedures are mandatory before private beta and
must be rehearsed in staging. They complement, but do not replace, provider incident
procedures and professional legal advice.

## Operating contract

- Initial SLO: 99.5% monthly availability.
- Daily collection SLO: 99% of scans complete before 09:00 in the workspace timezone.
- Server error objective: less than 1% of handled requests.
- Critical queue objective: no critical dead-letter without an operations alert.
- RPO: 15 minutes.
- RTO: 4 hours.
- Production changes require an incident commander, an operator and a written event
  log. One person may fill both roles before beta, but every action remains timestamped.
- Preserve request IDs, pseudonymized workspace IDs, job IDs, Google request IDs and
  Stripe event IDs. Never copy refresh tokens, API keys, report tokens, webhook URLs or
  personal data into tickets, chat or screenshots.

## Universal first response

1. Record detection time, reporter, affected environment and the first request/job ID.
2. Classify severity:
   - SEV-1: suspected tenant leak, secret leak, unauthorized Google mutation, deletion
     failure exposing data, or broad outage;
   - SEV-2: a tenant-blocking provider failure, repeated ambiguous mutations, billing
     lifecycle corruption or critical queue backlog;
   - SEV-3: degraded non-critical feature with a safe workaround.
3. For SEV-1, immediately set `FORCE_READ_ONLY=1` and disable the relevant global flag.
   If tenant isolation is suspected, also set `SCHEDULER_ENABLED=0`,
   `NOTIFICATIONS_ENABLED=0`, `PUBLIC_API_ENABLED=0` and `STRIPE_CHECKOUT_ENABLED=0`.
4. Do not delete evidence. Preserve redacted logs, deployment ID, migration version,
   relevant configuration hashes and provider incident links.
5. Publish a status update that describes user impact without revealing tenant or
   security details. Update at least every 30 minutes for SEV-1 and hourly for SEV-2.
6. Restore service only after the exit criteria for the relevant runbook are met.
7. Within two business days, write a blameless incident review with timeline, root
   cause, detection gap, corrective work, owner and due date.

## Kill-switch reference

| Risk | Immediate switch |
| --- | --- |
| Any Google write risk | `FORCE_READ_ONLY=1`, `GOOGLE_MUTATIONS_ENABLED=0` |
| One write family | corresponding `GOOGLE_MUTATION_*_ENABLED=0` |
| Scheduler amplification | `SCHEDULER_ENABLED=0` |
| Notification leak or storm | `NOTIFICATIONS_ENABLED=0` |
| Billing or fiscal uncertainty | `STRIPE_CHECKOUT_ENABLED=0` |
| Public API abuse | `PUBLIC_API_ENABLED=0` |
| Domain-routing ambiguity | `CUSTOM_DOMAINS_ENABLED=0` |
| Uncontrolled signup | `PUBLIC_BETA_ENABLED=0` |

Every switch change must record the actor, timestamp, reason, previous value and
verification result. Production remains fail-closed when a required value is absent.

## Suspected multi-tenant isolation incident

1. Apply the SEV-1 switches from the universal response and enable maintenance mode if
   any cross-tenant response is reproducible.
2. Identify the exact route, Server Action, API scope, database role and workspace IDs.
   Work only with pseudonymized IDs outside the restricted incident record.
3. Capture the deployed commit, migrations, RLS metadata and role attributes. Run the
   RLS verifier against an isolated clone, never against altered production evidence:

   ```bash
   cd web
   npm run db:verify-rls
   npm run db:validate-tenant-constraints
   npm run db:verify-tenants
   npm run db:verify-concurrency
   npm run db:verify-load
   ```

4. Search request/audit evidence for every affected entity and determine the earliest
   possible exposure. Do not infer impact only from application logs.
5. Rotate any secret whose tenant boundary may have been crossed. Revoke public report
   links and API keys for impacted workspaces.
6. Notify the data-protection and legal contacts promptly so statutory notification
   deadlines can be assessed.

Exit requires a reproduced root cause, a regression test at the database and route
boundary, a clean clone verification, reviewed impact scope and explicit incident-
commander approval. Resume one internal tenant before broader access.

## OAuth refresh-token leak

1. Disable the affected connector and scheduler. For Google Ads, also force read-only.
2. Revoke the affected grant at the provider. Delete the encrypted local connection or
   notification channel; disabling a notification channel destroys its local secret.
3. If logs or monitoring may contain the value, rotate the logging/Sentry access and
   purge the secret under the provider's documented process without copying it again.
4. Search by connection/channel ID and key identifier (`kid`), never by plaintext token.
5. Require a new consent flow. Confirm the previous credential can no longer obtain an
   access token before marking containment complete.

If the encryption key itself is suspected, follow the key-rotation runbook and treat
every envelope readable by that key as exposed.

## Yodev Google Ads developer-token leak

1. Set `FORCE_READ_ONLY=1`, `GOOGLE_MUTATIONS_ENABLED=0` and `SCHEDULER_ENABLED=0`.
2. Remove the compromised secret from every Vercel environment and local operator
   store. Never put the replacement in Postgres.
3. Contact Google Ads API support and follow the current token-compromise procedure;
   request revocation/rotation and document the case ID.
4. Review Google request IDs and audit events from the possible exposure interval.
5. Provision the replacement only in the managed deployment secret store, redeploy and
   validate read-only requests against the controlled staging MCC.
6. Re-enable reads tenant by tenant. Writes remain disabled until approval, drift,
   `validateOnly`, submission and reconciliation are all proven with the new token.

## Google Ads outage or quota exhaustion

1. Keep stored-data views available; do not turn provider failures into empty metrics.
2. Disable mutations if Google reports elevated mutation errors or timeouts. A mutation
   timeout after submission is `ambiguous` and must never be retried automatically.
3. Allow retry/backoff only for reads, HTTP 429 and 5xx according to the bounded job
   policy. Watch quota headers/request IDs and the dead-letter queue.
4. Pause scheduler fan-out if retries threaten to amplify the outage.
5. Reconcile ambiguous writes by reading the live resource. Return to pending only when
   non-application is proven.

Exit requires stable provider health, normal quota consumption, drained critical jobs
and zero unexplained ambiguous mutation.

## Stripe outage or billing inconsistency

1. Set `STRIPE_CHECKOUT_ENABLED=0`; retain account access from the last authoritative
   subscription state. Never suspend a customer merely because Stripe is unreachable.
2. Preserve each Stripe event ID and delivery timestamp. Replays are safe through the
   unique event claim; do not edit processed event rows.
3. Compare the workspace state with the authoritative subscription before applying an
   old invoice or subscription event.
4. Resume failed event processing through provider replay after recovery. Verify grace,
   `current_period_end`, cancellation and refund audits.
5. If fiscal configuration is uncertain, keep Checkout disabled until accounting/legal
   approval is restored.

Exit requires no failed Stripe webhook, no duplicate subscription, a reconciled sample
of all affected workspaces and a successful Test Clock lifecycle replay in staging.

## Incorrect or unauthorized Google mutation

1. Force read-only and disable the specific mutation family.
2. Record approval ID, mutation execution ID, Google request ID, resource name, expected
   hash, proposed state and reconciled live state.
3. Do not issue a compensating write automatically. Present the reversible correction
   as a new proposal with current-state read, safety evaluation, `validateOnly` and
   human approval.
4. Check shared budgets, account-level lists and batch atomicity before correction.
5. Determine whether the cause was authorization, stale state, policy, UI wording,
   provider ambiguity or an idempotency defect. Add a regression scenario at that exact
   layer.

Exit requires confirmed Google state, customer/operator communication where relevant,
no remaining ambiguous execution and explicit re-enablement per workspace.

## Database restore and deletion tombstones

Quarterly, restore a recent Neon backup into an isolated staging project. Never point a
restore drill at production provider credentials.

1. Record backup timestamp and verify it satisfies the 15-minute RPO target.
2. Apply every committed migration after the backup point.
3. Reapply the retained deletion-tombstone registry before enabling application access.
   A workspace represented by a live tombstone must not be resurrected.
4. Run all database verifiers and compare row counts for workspaces, approvals, daily
   metrics, audit events, jobs and tombstones.
5. Use staging-only Better Auth/provider identities to validate authentication, one report and
   one read-only Google synchronization.
6. Record time to usable service; it must remain below the four-hour RTO.
7. Destroy the isolated restore and its credentials after evidence is approved.

Production restoration requires two-person confirmation of the backup, tombstone
reapplication and target project. Provider jobs, notifications, Checkout and mutations
remain off until verification completes.

## `APP_ENCRYPTION_KEY` / envelope-key rotation

1. Generate a new independent 32-byte key in the managed secret store. Assign a new,
   date-based `kid`; never reuse or overwrite an existing `kid`.
2. Add it to `APP_ENCRYPTION_KEYS`, set `APP_ENCRYPTION_CURRENT_KID`, retain the legacy
   key and deploy with all external actions disabled.
3. Confirm dual-read and single-write using staging fixtures, then let the durable
   `secrets.rotate` jobs rewrap each eligible workspace. Rotation uses optimistic
   concurrency and count-only audit evidence.
4. Verify no envelope references the retired `kid`, including Google connections,
   notification channels/OAuth sessions, member emails, report schedules and one-shot
   revelations.
5. Remove the retired key only after backups containing it have expired or their access
   is separately controlled and the rotation evidence has been approved.

If any rewrap fails, keep both keys available, stop retirement and retry only the
failed durable jobs. Never bulk-decrypt secrets into a file.

## Notification connector incident

1. Set `NOTIFICATIONS_ENABLED=0` for a leak, storm or destination ambiguity.
2. Disable the affected channel to destroy its local encrypted destination. For Teams,
   purge temporary OAuth sessions through the system role; application users can only
   access their own temporary session.
3. Validate Slack webhook hosts through the SSRF guard and Teams destinations through
   Graph membership/channel lookup. Redirects remain forbidden.
4. Re-enable one staging channel, then one internal production channel, before tenant
   rollout. Confirm delivery evidence and absence of retries/dead-letter.

## Evidence template

Every rehearsal or incident record must contain:

- incident/rehearsal ID and severity;
- start, detection, containment, recovery and close timestamps;
- affected environments and pseudonymized workspaces;
- deployed commit and migration number;
- switches changed and by whom;
- request/job/provider IDs;
- data-access and mutation impact assessment;
- commands/checks run with redacted output;
- RPO/RTO/SLO result;
- follow-up owner, deadline and verification method.

## Latest staging rehearsal evidence

Evidence recorded on 2026-08-13:

- environment: isolated `yodev-ads-staging` Vercel project and EU Neon PostgreSQL 17 project `snowy-king-69942334` in AWS Frankfurt;
- deployed artifact: `dpl_Fm6VoKPCvBcU8J36JM5oGvK7rXgN`, migrations through `0034`;
- database boundary: 46 RLS/FORCE RLS tables, four restricted no-`BYPASSRLS` runtime roles, 33 validated composite constraints and 15 tenant/auth invariants;
- concurrency: single winners for quota consumption, approval execution claim, job lease, Stripe webhook claim and purge claim;
- load fixture: 100 workspaces, 149 advertiser accounts, 200 monitors, 10,000 notification deliveries, 100 approvals and 1,000 report reads; fixtures were purged afterward;
- restore: a temporary Neon restore branch recovered two workspaces, one Better Auth user, the then-current migration history and zero unprocessed Stripe events, then was deleted;
- external reads: one real Google Ads API v25 inventory request returned three accessible customers with a request ID;
- billing: a Stripe sandbox Test Clock completed activation, payment failure, seven-day grace, recovery, cancellation scheduling, cancellation reversal and final cancellation with no unprocessed webhook;
- HTTP: six public Playwright tests, one ephemeral Better Auth credential journey and one separately consumed real Postmark magic link passed through sign-in, dashboard, advertiser accounts and billing on the live staging alias; all temporary credentials and sessions were removed;
- repository: lint, types, data-boundary and transaction verifiers, 636 Vitest tests across 109 files and the 52-route Next.js production build passed.

This is functional staging evidence, not yet the formal RPO/RTO or 30-day SLO record. Transactional email, Sentry delivery, the five-role authenticated matrix, controlled Google mutations, provider outage drills, deletion-tombstone restoration and professional legal/tax approval remain open rehearsal gates.
