import { createHash } from 'node:crypto'
import { z } from 'zod'

export const optionalProviders = {
  custom_domains: { flag: 'CUSTOM_DOMAINS_ENABLED', required: ['VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID'], optional: ['VERCEL_TEAM_ID'] },
  blob_uploads: { flag: 'BLOB_UPLOADS_ENABLED', required: ['BLOB_READ_WRITE_TOKEN'], optional: [] },
  slack_connector: { flag: 'SLACK_CONNECTOR_ENABLED', required: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'], optional: [] },
  teams_connector: { flag: 'TEAMS_CONNECTOR_ENABLED', required: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'], optional: [] },
} as const
export type OptionalProvider = keyof typeof optionalProviders
type Environment = Record<string, string | undefined>

const certificateSchema = z.object({
  provider: z.enum(['custom_domains', 'blob_uploads', 'slack_connector', 'teams_connector']),
  outcome: z.literal('passed'),
  target: z.enum(['staging', 'private_beta', 'public']),
  release: z.string().regex(/^[a-f0-9]{40}$/),
  origin: z.string().url(),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  artifactUrl: z.string().url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password }),
})

export function providerConfigurationHash(provider: OptionalProvider, env: Environment) {
  const config = optionalProviders[provider]
  const values = Object.fromEntries([...config.required, ...config.optional].map((name) => [name, env[name] ?? '']))
  // The digest is exported; credentials and the certificate payload are never logged.
  return createHash('sha256').update(JSON.stringify({ version: 1, provider, origin: env.NEXT_PUBLIC_APP_URL, values })).digest('hex')
}

export function optionalProviderReadinessIssues(env: Environment, target: string, now = new Date()) {
  let certificates: z.infer<typeof certificateSchema>[] = []
  try {
    const parsed = z.array(certificateSchema).max(50).safeParse(JSON.parse(env.PROVIDER_CERTIFICATES_JSON ?? '[]'))
    if (parsed.success) certificates = parsed.data
  } catch { /* Malformed evidence cannot authorize a provider. */ }
  const issues: Array<{ code: string; message: string }> = []
  for (const [provider, config] of Object.entries(optionalProviders)) {
    if (env[config.flag] === '0') continue
    if (env[config.flag] !== '1') {
      issues.push({ code: `flags.${provider}`, message: `${config.flag} must explicitly be 0 or 1` })
      continue
    }
    for (const name of config.required) if (!env[name]?.trim()) issues.push({ code: `missing.${name}`, message: `${name} is required when ${config.flag}=1` })
    const hash = providerConfigurationHash(provider as OptionalProvider, env)
    const certificate = certificates.find((item) => {
      const checkedAt = new Date(item.checkedAt).getTime()
      const expiresAt = new Date(item.expiresAt).getTime()
      return item.provider === provider && item.target === target && item.origin === env.NEXT_PUBLIC_APP_URL &&
        item.release === (env.VERCEL_GIT_COMMIT_SHA ?? env.NEXT_PUBLIC_RELEASE_SHA) && item.configurationHash === hash &&
        checkedAt <= now.getTime() + 60_000 && checkedAt <= expiresAt && expiresAt > now.getTime() &&
        expiresAt - checkedAt <= 7 * 24 * 3_600_000
    })
    if (!certificate) issues.push({ code: `flags.${provider}`, message: `${config.flag} requires a current provider certificate matching this target, URL, commit and configuration` })
  }
  return issues
}
