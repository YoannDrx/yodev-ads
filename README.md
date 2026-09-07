# Ads by Yodev

Ads by Yodev is a multi-tenant Google Ads operating system for agencies and independent
media buyers. The repository contains both the hosted product and a safe local CLI.

## Hosted product

The Next.js application in [`web`](web) implements the following capabilities.
Availability depends on the workspace plan, lifecycle, enabled integrations and
release evidence. The current branch is still undergoing production-readiness
work; local verification does not certify a deployed commercial service. See the
[current feature register and remaining gates](docs/IMPLEMENTATION_STATUS.md).

- self-hosted Better Auth sessions, passkeys, organizations and organization-scoped roles;
- an isolated workspace, branding and client portfolio for every tenant;
- hosted Google OAuth with AES-256-GCM encryption of refresh tokens;
- MCC account synchronization through the official Google Ads API v25;
- stored campaign collections with explicit dates, freshness and source coverage;
- durable daily performance history in Neon;
- a 360° analysis of stored search terms, keyword quality, responsive search ads and conversion tracking;
- configurable monitoring agents with manual and daily execution;
- ten explainable monitoring templates, including wasted queries, Quality Score, ad strength, tracking gaps, pacing and forecast;
- explainable alert incidents and acknowledgement workflows;
- Google `validate_only` checks before every proposed mutation;
- approval and execution flows for campaign status/budgets, keywords, ads and paused
  responsive-search-ad drafts;
- revocable, read-only client reports with immutable editions backed by qualified daily history;
- 7/30/90-day and calendar/custom reporting periods, with explicit refusal when history is incomplete;
- downloadable, visually verified PDF reports and consultative client approvals;
- encrypted email, OAuth-provisioned Slack, native Microsoft Graph Teams and SSRF-safe generic webhook notifications;
- weekly performance digests and deduplicated incident delivery;
- workspace budget/spend guardrails enforced before Google validation;
- Stripe subscription checkout, billing portal and signed webhook handling;
- FR/EN legal, consent and commercial-readiness gates;
- public subprocessor register with enforced 15-day bilingual, durable change notices;
- scoped API v1 restricted to the private allowlist, asynchronous private exports and J+30 deletion workflows;
- Agency custom report domains with DNS and Vercel verification;
- consent-gated Vercel Web Analytics and Speed Insights;
- one-time API-key revelation for eligible agencies in the private API program;
- an append-only operational audit trail;
- Neon Postgres persistence and a Vercel deployment target.

```bash
cd web
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Use `npm run check` for lint, TypeScript, unit tests and a production build, then
`npm run test:e2e` for the browser smoke suite.

The latest application check is in [lot 28](docs/audits/prod-ready-lot-28/README.md):
1,328 application tests and seven script tests. Nine focused public/authentication
journeys passed in [lot 27](docs/audits/prod-ready-lot-27/README.md); the full 53-journey browser matrix passed in [lot 25](docs/audits/prod-ready-lot-25/README.md).
These dated results must be rerun on the final release candidate.

For a fully local authenticated regression run, provision a disposable PostgreSQL 17
instance named `yodev_test` on loopback, then run `npm run db:verify-local` and
`npm run test:e2e:local` from `web`. The default database is
`postgresql://postgres@127.0.0.1:55438/yodev_test`; override it with
`YODEV_TEST_DATABASE_URL`. Both runners refuse remote databases. They apply the
committed migrations, verify tenant boundaries and real concurrency, then create
five verified fixture identities, sign them in through Better Auth and run the
browser matrix without missing-session skips. Provider switches are disabled;
no real Google, payment or email action is performed. The browser runner owns port
3017, stops its server and removes its fixture identities, workspaces and temporary
sessions after the run. These checks complement the deployed provider and
authenticated release gates.

Worker transactions require PostgreSQL 17 or newer. See [worker deadlines and fair scheduling](docs/WORKER_EXECUTION.md) for the runtime budgets, migration and rollback procedure.

Secrets are provisioned through Vercel and must never be committed.

## Operator CLI

The Python CLI uses Google's official client, Application Default Credentials for
OAuth, and the macOS Keychain for the developer token.

The `yads` command is read-only by default. Mutations are first sent with
`validate_only`; an actual change requires both `--apply` and `--yes`.

### What is included

- a multi-client profile registry;
- OAuth and developer-token diagnostics;
- accessible-account discovery;
- campaign inventory and 30-day performance reports;
- a compact account dashboard;
- guarded campaign pause/enable and budget updates;
- JSON output for automation and Codex workflows.
- a white-label identity (name, tagline, glyph, accent, locale and support URL);
- schema-versioned configuration with automatic migration from the first format.

### Local installation

Python 3.11 to 3.14 is supported by this package.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
yads --help
```

Create a desktop OAuth client in the Google Cloud project, then let Ads by Yodev
open the consent screen and create private local Application Default Credentials:

```bash
yads auth login --client-id 123456.apps.googleusercontent.com
```

The OAuth secret is requested with hidden input and is never written to this
repository. The resulting local credentials are stored with `0600` permissions.

### First setup

The manager and customer IDs must be written without dashes.

```bash
yads setup \
  --manager-id 1234567890 \
  --client-id 4494392373 \
  --name "Mail Certificate"

yads doctor
yads accounts list
yads campaigns list
yads dashboard --days 30
```

`yads setup` reuses the developer token from the system keychain, or asks for
it using hidden input when none exists. As an alternative, set
`GOOGLE_ADS_DEVELOPER_TOKEN` in the process environment. Do not commit a token
or OAuth credentials.

### Multi-client profiles

```bash
yads clients add acme --name "Acme" --customer-id 1112223333
yads clients list
yads clients use acme
yads campaigns list --profile acme
```

Each profile can override the manager ID with `--manager-id`, which supports
accounts accessed through different MCCs while keeping a single interface.

Each operating-system user gets an isolated configuration and keychain. This
means another consultant or agency can install the same package, apply their own
brand and connect their own MCC without inheriting another operator's clients or
secrets.

### White-label customization

The terminal identity is data, not hard-coded UI:

```bash
yads brand set \
  --product-name "Campaign Desk" \
  --tagline "One calm place for every account." \
  --logo "◇" \
  --accent magenta \
  --locale en-GB \
  --support-url https://example.com/support

yads brand show
```

Brand settings never contain OAuth credentials or developer tokens, so they can
later be reused by a hosted web interface, desktop app or customer portal.

### Architecture and security

The hosted and local security boundaries are documented in
[`docs/MICRO_SAAS_ARCHITECTURE.md`](docs/MICRO_SAAS_ARCHITECTURE.md).
The current implementation and external launch gates are tracked separately in
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). The hosted product
must remain internal until the staging, legal, provider, restore, load and private-beta
evidence listed there has been completed.

### Guarded CLI mutations

Preview and validate a pause without applying it:

```bash
yads campaigns status 987654321 paused
```

Apply the validated operation explicitly:

```bash
yads campaigns status 987654321 paused --apply --yes
```

Budget changes follow the same contract:

```bash
yads campaigns budget 987654321 25.00
yads campaigns budget 987654321 25.00 --apply --yes
```

### CLI configuration and secrets

- non-secret profiles: platform-specific user configuration directory;
- developer token: macOS Keychain through `keyring`, or environment variable;
- OAuth credentials: Google Cloud Application Default Credentials;
- no secret is stored inside this repository.

Use `yads config path` to display the exact profile file location.

The rebrand is a hard cutover: existing local configuration and Keychain entries are
not imported automatically. Run `yads setup` and `yads auth token-set` once after
installing the renamed package.

During the production cutover, rotate legacy API and share credentials with an
absolute, pre-agreed output path outside the repository and CI logs:

```bash
cd web
YODEV_ADS_ROTATION_OUTPUT=/secure/path/yodev-ads-rotation.json npm run rebrand:rotate-credentials
```

The command creates the file exclusively with mode `0600`, never prints secret
values, and fails if the destination already exists.
