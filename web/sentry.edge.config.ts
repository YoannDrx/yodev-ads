import * as Sentry from '@sentry/nextjs'
import { redactSentryEvent } from './src/lib/sentry-redaction'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
  beforeSend: (event) => redactSentryEvent(event),
  beforeSendTransaction: (event) => redactSentryEvent(event),
})
