# Vigihat

Vigihat is a multi-tenant Google Ads operating system for agencies and independent
media buyers. The repository contains both the hosted product and a safe local CLI.

## Hosted product

The Next.js application in [`web`](web) provides:

- Clerk organizations and organization-scoped roles;
- an isolated workspace, branding and client portfolio for every tenant;
- hosted Google OAuth with AES-256-GCM encryption of refresh tokens;
- MCC account synchronization through the official Google Ads API v24;
- live 30-day campaign performance;
- configurable monitoring agents with manual and daily execution;
- explainable alert incidents and acknowledgement workflows;
- Google `validate_only` checks before every proposed mutation;
- approval and execution flows for campaign status and daily budgets;
- revocable, read-only client reports backed by live Google Ads data;
- one-time agency API keys for Codex and internal tooling;
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
`npm run test:e2e` for the browser smoke suite. Secrets are provisioned through
Vercel and must never be committed.

## Operator CLI

The Python CLI uses Google's official client, Application Default Credentials for
OAuth, and the macOS Keychain for the developer token.

The `vigie` command is read-only by default. Mutations are first sent with
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
vigie --help
```

Create a desktop OAuth client in the Google Cloud project, then let Vigihat
open the consent screen and create private local Application Default Credentials:

```bash
vigie auth login --client-id 123456.apps.googleusercontent.com
```

The OAuth secret is requested with hidden input and is never written to this
repository. The resulting local credentials are stored with `0600` permissions.

### First setup

The manager and customer IDs must be written without dashes.

```bash
vigie setup \
  --manager-id 1234567890 \
  --client-id 4494392373 \
  --name "Mail Certificate"

vigie doctor
vigie accounts list
vigie campaigns list
vigie dashboard --days 30
```

`vigie setup` reuses the developer token from the system keychain, or asks for
it using hidden input when none exists. As an alternative, set
`GOOGLE_ADS_DEVELOPER_TOKEN` in the process environment. Do not commit a token
or OAuth credentials.

### Multi-client profiles

```bash
vigie clients add acme --name "Acme" --customer-id 1112223333
vigie clients list
vigie clients use acme
vigie campaigns list --profile acme
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
vigie brand set \
  --product-name "Campaign Desk" \
  --tagline "One calm place for every account." \
  --logo "◇" \
  --accent magenta \
  --locale en-GB \
  --support-url https://example.com/support

vigie brand show
```

Brand settings never contain OAuth credentials or developer tokens, so they can
later be reused by a hosted web interface, desktop app or customer portal.

### Architecture and security

The hosted and local security boundaries are documented in
[`docs/MICRO_SAAS_ARCHITECTURE.md`](docs/MICRO_SAAS_ARCHITECTURE.md).

### Guarded CLI mutations

Preview and validate a pause without applying it:

```bash
vigie campaigns status 987654321 paused
```

Apply the validated operation explicitly:

```bash
vigie campaigns status 987654321 paused --apply --yes
```

Budget changes follow the same contract:

```bash
vigie campaigns budget 987654321 25.00
vigie campaigns budget 987654321 25.00 --apply --yes
```

### CLI configuration and secrets

- non-secret profiles: platform-specific user configuration directory;
- developer token: macOS Keychain through `keyring`, or environment variable;
- OAuth credentials: Google Cloud Application Default Credentials;
- no secret is stored inside this repository.

Use `vigie config path` to display the exact profile file location.
