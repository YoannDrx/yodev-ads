import { describe, expect, it } from 'vitest'
import { optionalProviderReadinessIssues, providerConfigurationHash } from './provider-certification'

const now = new Date('2026-09-07T00:00:00Z')
const env = { NEXT_PUBLIC_APP_URL: 'https://ads.example.test', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), CUSTOM_DOMAINS_ENABLED: '0', BLOB_UPLOADS_ENABLED: '0', SLACK_CONNECTOR_ENABLED: '1', TEAMS_CONNECTOR_ENABLED: '0', SLACK_CLIENT_ID: 'fixture-id', SLACK_CLIENT_SECRET: 'fixture-secret' }
const certificate = { provider: 'slack_connector', outcome: 'passed', target: 'public', release: env.VERCEL_GIT_COMMIT_SHA, origin: env.NEXT_PUBLIC_APP_URL, configurationHash: providerConfigurationHash('slack_connector', env), checkedAt: now.toISOString(), expiresAt: '2026-09-08T00:00:00Z', artifactUrl: 'https://evidence.example.test/run/1' }
const configuration = (patch = {}, envPatch = {}) => ({ ...env, ...envPatch, PROVIDER_CERTIFICATES_JSON: JSON.stringify([{ ...certificate, ...patch }]) })

describe('optional provider promotion certificates', () => {
  it('allows a configured provider with current matching evidence rather than forcing it permanently off', () => {
    expect(optionalProviderReadinessIssues(configuration(), 'public', now)).toEqual([])
    expect(optionalProviderReadinessIssues({ ...env, SLACK_CONNECTOR_ENABLED: '0' }, 'public', now)).toEqual([])
  })
  it('refuses missing, malformed, stale, future or mismatched evidence', () => {
    for (const patch of [
      { release: 'b'.repeat(40) }, { target: 'staging' }, { origin: 'https://other.example.test' }, { configurationHash: 'c'.repeat(64) },
      { expiresAt: '2026-09-06T00:00:00Z' }, { expiresAt: '2026-10-01T00:00:00Z' }, { checkedAt: '2026-09-07T01:00:00Z' },
      { outcome: 'failed' }, { artifactUrl: 'http://evidence.example.test' },
    ]) expect(optionalProviderReadinessIssues(configuration(patch), 'public', now)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'flags.slack_connector' })]))
    for (const value of ['', '{}', 'invalid', '[]']) expect(optionalProviderReadinessIssues({ ...env, PROVIDER_CERTIFICATES_JSON: value }, 'public', now).length).toBeGreaterThan(0)
  })
  it('invalidates a certificate when credentials change and requires the actual secret', () => {
    expect(optionalProviderReadinessIssues(configuration({}, { SLACK_CLIENT_SECRET: 'rotated' }), 'public', now)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'flags.slack_connector' })]))
    const issues = optionalProviderReadinessIssues(configuration({}, { SLACK_CLIENT_SECRET: '' }), 'public', now)
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing.SLACK_CLIENT_SECRET' })]))
    expect(JSON.stringify(issues)).not.toContain('fixture-secret')
  })
})
