# Vigieads Web

The Vigieads hosted control plane is a Next.js 16 App Router application using
Clerk Organizations, Neon Postgres, Drizzle ORM, shadcn/ui and the official Google
Ads REST API.

## Commands

```bash
npm run dev          # local Next.js server
npm run check        # lint + types + unit tests + production build
npm run test:e2e     # Playwright public-route smoke tests
npm run db:generate  # generate a reviewed Drizzle migration
npm run db:migrate   # apply committed migrations
```

Copy `.env.example` to `.env.local` outside Vercel. Production, preview and local
development values are managed with `vercel env`.

## Security contract

- Every database query begins with the active Clerk organization workspace.
- Every Server Action and Google Ads route revalidates authentication and role.
- Google refresh tokens are encrypted with a 32-byte envelope key before storage.
- Google Ads writes are first submitted with `validateOnly: true`.
- Validated writes enter an approval queue and execute once, using an atomic claim.
- Sensitive events are written to the organization audit trail.
