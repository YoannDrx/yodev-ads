import 'server-only'

import { z } from 'zod'

const serverEnvSchema = z.object({
  APP_ENCRYPTION_KEY: z.string().min(43),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(8),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(8),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(8),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_ADS_API_VERSION: z.string().regex(/^v\d+$/).default('v25'),
})

export function getServerEnv() {
  return serverEnvSchema.parse(process.env)
}

export function hasGoogleConfiguration() {
  return serverEnvSchema.safeParse(process.env).success
}
