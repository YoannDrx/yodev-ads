# Ads by Yodev — operational runbooks

Last reviewed: 2026-08-17. These procedures are mandatory before private beta and
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
| Any Google read or quota risk | `GOOGLE_READS_ENABLED=0` |
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

1. Disable the affected connector and scheduler. For Google Ads, also set
   `GOOGLE_READS_ENABLED=0` and force read-only.
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

1. Set `GOOGLE_READS_ENABLED=0`, `FORCE_READ_ONLY=1`,
   `GOOGLE_MUTATIONS_ENABLED=0` and `SCHEDULER_ENABLED=0`.
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
   Set `GOOGLE_READS_ENABLED=0` when reads themselves must be contained.
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

## YoDevMail outage, ambiguity or deliverability incident

1. Keep `NOTIFICATIONS_ENABLED=0` if the incident can duplicate messages, expose a
   recipient or trigger a delivery storm. Authentication emails are also YoDevMail
   traffic: publish the user-facing impact immediately if login or password reset is
   affected.
2. Inspect the local `transactional_email_deliveries` row by business key or YoDevMail
   message UUID. Never search logs by raw recipient address.
3. A timeout, network rupture or malformed 2xx is `ambiguous`. Retry only with the exact
   same idempotency key and unchanged content. A manual retry after a definitive failure
   requires a new `:manual-retry:N` generation and an audit record.
4. Retry 429/5xx with the durable job backoff. Do not retry 400/401/403/404/409/422,
   suppressions, hard bounces or complaints automatically.
5. Correlate queued/sent/delivered/failed/bounce/complaint webhooks. A complaint or hard
   bounce supersedes a previous delivered state. Investigate every orphan message ID.
6. If YoDevMail is unavailable beyond the authentication recovery objective, keep the
   product in private beta and provide a documented operator-assisted recovery channel;
   never enable a direct Postmark, Resend or SES fallback inside YoDevAds.

Exit requires a successful same-key ambiguity replay with one delivered message, a
drained retry queue, zero orphan event and confirmation that terminal recipients cannot
be retried automatically.

## Failed migration or Vercel rollback

1. Stop Checkout, scheduler, notifications and mutations; set maintenance and forced
   read-only before touching the database.
2. Record the deployment ID, migration number, target Neon branch and row counts. Do not
   edit Drizzle history or manually mark a failed migration as applied.
3. If the migration is forward-fixable without data loss, prepare and test a new
   migration on a clone. Otherwise restore the verified pre-cutover backup to a new
   branch and repoint only after RLS, constraints, auth and tombstones pass.
4. Roll Vercel back to the artifact compatible with the restored schema. Never deploy
   an old binary against a schema whose compatibility has not been proven.
5. Smoke-test health, Better Auth, one tenant-isolation denial, Stripe webhook receipt,
   YoDevMail submission and a read-only Google request before lifting maintenance.

## Refund and billing repair

1. Verify workspace, Stripe customer, subscription, invoice and charge IDs in the
   restricted operations console. Do not infer the customer from an email address.
2. Obtain the approval required by the refund policy and record amount, currency,
   reason and approver.
3. Issue the refund in Stripe. Do not change workspace access merely because a charge
   is refunded; access follows the authoritative subscription lifecycle.
4. Confirm `charge.refunded`, immutable audit evidence, lifecycle email and daily
   reconciliation. Partial and full refunds must be distinguishable.
5. If local state diverges, enqueue the audited reconciliation action. Checkout remains
   blocked for that workspace until the divergence is resolved.

## RGPD request and urgent deletion

1. Verify requester authority proportionately and record the legal basis, scope and
   deadline in the restricted support record.
2. Export before deletion when required. Never include secrets, raw OAuth tokens or
   internal support notes in the customer archive.
3. Standard deletion revokes access immediately and purges product data at J+30. Legal,
   accounting and refund evidence follows the approved retention schedule.
4. An urgent purge requires legal/security approval, a fresh backup reference and an
   operator independent of the requester. Never bypass the atomic purge claim or remove
   tombstones.
5. Confirm provider revocation, Blob/domain cleanup, Better Auth organization deletion,
   workspace absence and tombstone presence. A purged workspace cannot be restored.

## Scheduler, retention and missed execution

1. The authenticated Vercel cron runs every five minutes and seeds deterministic jobs.
   Inspect structured `scheduler.run.completed` logs, processed counts, duration and
   dead-letter count.
2. Two missed passages are an incident. Check Vercel cron delivery, `CRON_SECRET`, the
   scheduler flag, database availability and lease backlog before a manual invocation.
3. Never run multiple ad-hoc loops. One authenticated invocation is safe because job
   claims and deduplication are atomic.
4. Retention must complete at least every 48 hours. Review deleted counts per category,
   duration, errors and `nextRunAt`; pending, ambiguous and dead-letter jobs must remain.
5. After recovery, verify reports, digests, lifecycle mail, Stripe reconciliation,
   mutation observations and retention independently rather than relying on a single
   global success response.

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

Evidence consolidated on 2026-08-17:

- environment: isolated `yodev-ads-staging` Vercel project and EU Neon PostgreSQL 17 project `snowy-king-69942334` in AWS Frankfurt;
- deployed artifact: `dpl_Gay5erHLEULCSfvxC2WEdz29aYCE`, returned to maintenance with explicit fail-closed flags after controlled drills; migrations through `0041`;
- database boundary: 46 RLS/FORCE RLS tables, four restricted no-`BYPASSRLS` runtime roles, 33 validated composite constraints and 15 tenant/auth invariants;
- concurrency: single winners for quota consumption, approval execution claim, job lease, Stripe webhook claim and purge claim;
- load fixture: 100 workspaces, 149 advertiser accounts, 200 monitors, 10,000 notification deliveries, 100 approvals and 1,000 report reads; the database pool peaked at 10/10, the burst completed in 8,254 ms with p95 7,853 ms, rate limiting stopped at 60 and scheduler discovery produced 543 jobs; fixtures were purged afterward;
- restore: the pre-migration branch `backup-pre-0041-20260817` (`br-wandering-firefly-b2brmy7p`) retains the staging state before `0035`–`0041`; 35 migrations and table counts matched before the controlled migration;
- external reads: an older real Google Ads API v25 inventory request returned three accessible customers; the current runtime drill reached OAuth but classified the refresh token as revoked/expired. A controlled Chrome window then proved that the staging owner has no active YoDevAds session and that Google Sign-In is not exposed, so a fresh owner session is required before the Google Ads consent;
- billing: the active sandbox catalogue is one `Ads by Yodev` product and three EUR monthly Prices; a real drill completed Solo activation, paid immediate Studio upgrade, end-of-period Solo downgrade scheduling and schedule cancellation. The two legacy sandbox webhook endpoints were disabled, leaving only the complete staging endpoint active. The available Stripe account is test/US and not live-enabled;
- email infrastructure: read-only AWS inventory found healthy protected YoDevMail prod/dev/foundation stacks, four enabled SQS consumers and empty queues/DLQs, with Postmark active behind YoDevMail. Database migration, project-key provisioning and delivery canaries remain unproven;
- HTTP: six public Playwright tests plus five isolated authenticated owner/admin/strategist/analyst/client page-authorisation scenarios passed against the staging alias; all temporary identities, sessions and credentials were removed;
- repository evidence on 2026-08-17: lint, types, data-boundary and transaction verifiers, 682 Vitest tests across 116 files, 6 public Playwright scenarios and the 52-route Next.js production build passed; a fresh PostgreSQL 17 applied migrations through `0041` and passed RLS, tenant constraints/invariants, concurrency and targeted load protocols.

Repository stabilization evidence on 2026-08-18 is separate from the historical
staging proof: `npm run check` passed with 797 tests across 120 files and coverage above every configured
threshold, the runtime audit and web SBOM passed, 15 Python tests/Ruff/`pip-audit`
passed, and a fresh PostgreSQL 17 repeated migrations, RLS, constraints, invariants,
concurrency and load with a 10/10 observed pool peak. A new Stripe sandbox drill again
proved Solo activation, immediate paid Studio upgrade, end-of-period Solo downgrade
and schedule cancellation. The six public E2E pass locally; eleven authenticated page,
direct Server Action and direct-export API tests remain intentionally skipped outside the
release workflow. The Server Action test captures the runtime action request, copies only
the Next.js protocol headers and body (never the owner cookie), and replays it with every
role session. The current remote staging
deployment remains in maintenance and is therefore not counted as a fresh open-app
acceptance run.

The deletion concurrency verifier now calls the production lifecycle functions rather
than reproducing their SQL. On a fresh disposable PostgreSQL 17, a cancellation before
the deadline won against purge, restored active access, cleared both deletion timestamps
and wrote its audit. A second fixture past the deadline rejected cancellation, purged the
workspace and child client, and retained the expected completed-cleanup tombstone. The
container and all fixtures were removed after the run. This is not a substitute for the
still-pending authenticated FR/EN staging UI and backup-restore drill.

The current candidate is deployed separately as
`dpl_FEqPCv2Pzy4N7K7tosWuWpFu8PLw` (`4037913`). Its health endpoint returns HTTP 503
with `status=maintenance` and a connected database, while scheduler and retention both
have recent successful non-overdue runs. The scheduler was first triggered under
maintenance through Vercel, then repeated automatically on its five-minute cadence. Its
controlled run requested three jobs, created one, processed four and produced zero dead
letters; database evidence shows only retention and secret-rotation attempts, with zero
new Google or notification jobs. Thirteen historical provider jobs were explicitly
cancelled without deletion, retaining their attempts/errors plus an auditable cancellation
reason; the live queue then contained zero due jobs and zero dead letters.

The authenticated runtime probe now also fails closed on unresolved durable work, failed
Stripe webhooks, billing reconciliations, problematic email deliveries and ambiguous or
failed Google mutations. Manual GitHub Actions run `32140448381` passed the web,
PostgreSQL, Python/CLI and secrets jobs on commit `4037913`, then returned exactly fourteen
remaining external/configuration issues: two Better Auth Google, four YoDevMail, five
Sentry, Google reads, notifications and maintenance. Optional Slack, Teams, Blob uploads
and custom domains remain independently fail-closed. No queue, scheduler, retention,
Stripe, email or mutation-health issue remained.

This is functional staging evidence, not yet the formal RPO/RTO or 30-day SLO record. Transactional email delivery, Sentry delivery, direct role action/API coverage, fresh Google reads and controlled mutations, provider outage drills, deletion-tombstone restoration and professional legal/tax approval remain open rehearsal gates.

## Runtime release-readiness probe

Vercel variables marked Sensitive cannot be exported as release evidence. Configure a
unique `RELEASE_VERIFICATION_TOKEN` of at least 32 characters in the target Vercel
project and in the matching GitHub Environment. The manual release workflow calls
`/api/internal/release-readiness` with that bearer token. The endpoint remains reachable
during maintenance, sets `Cache-Control: no-store`, compares the credential in constant
time and returns only readiness issue codes, target, release SHA and timestamp.

Never reuse this token between staging and production. Rotate it after an operator
departure or suspected disclosure. A 401 is an authentication failure; a 503 is a valid
negative readiness proof and must be resolved before removing maintenance.
