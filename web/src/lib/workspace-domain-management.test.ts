import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  hash: vi.fn((value: string) => `hashed:${value}`),
  verifyDns: vi.fn(),
  addVercel: vi.fn(),
  reaches: vi.fn(),
  removeVercel: vi.fn(),
  dnsRecord: vi.fn((hostname: string, token: string) => ({ type: 'TXT', name: `_yodev-ads.${hostname}`, value: `verify=${token}` })),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: mocks.encrypt }))
vi.mock('@/lib/tokens', () => ({ hashToken: mocks.hash }))
vi.mock('@/lib/vercel-domains', () => ({
  verifyDomainDnsOwnership: mocks.verifyDns,
  addOrVerifyVercelProjectDomain: mocks.addVercel,
  domainReachesApplication: mocks.reaches,
  removeVercelProjectDomain: mocks.removeVercel,
  domainDnsRecord: mocks.dnsRecord,
}))

import {
  createWorkspaceCustomDomain,
  revokeWorkspaceCustomDomain,
  verifyWorkspaceCustomDomain,
} from './workspace-domain-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const domainId = '00000000-0000-4000-8000-000000000002'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')
const domain = {
  id: domainId,
  workspaceId,
  hostname: 'reports.example.test',
  dnsTokenHash: 'expected-hash',
  vercelStatus: 'not_submitted',
  revokedAt: null,
}

function domainDatabase(input: { statementResults?: unknown[]; domain?: unknown } = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: {
      workspaceDomains: { findFirst: vi.fn(async () => input.domain) },
      workspaces: { findFirst: vi.fn(async () => ({ accessState: 'active', plan: 'agency' })) },
    },
  })
}

describe('workspace custom-domain management', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.verifyDns.mockResolvedValue(true)
    mocks.addVercel.mockResolvedValue({ verified: true, configuration: { misconfigured: false } })
    mocks.reaches.mockResolvedValue(true)
    mocks.removeVercel.mockResolvedValue({})
  })

  it('creates one live domain and a ten-minute one-shot DNS revelation', async () => {
    const database = domainDatabase({
      statementResults: [[], [], [{ id: domainId }], [{ id: 'revelation-1' }]],
    })
    mocks.databases.push(database.db)
    await createWorkspaceCustomDomain({ workspaceId, actorUserId, hostname: domain.hostname, token: 'dns-secret', now })
    expect(database.capture.values[0]).toMatchObject({ hostname: domain.hostname, dnsTokenHash: 'hashed:dns-secret' })
    expect(database.capture.values[1]).toMatchObject({
      kind: 'domain_dns',
      encryptedSecret: `encrypted:${JSON.stringify({ type: 'TXT', name: `_yodev-ads.${domain.hostname}`, value: 'verify=dns-secret' })}`,
      expiresAt: new Date('2026-08-12T08:10:00.000Z'),
    })
    expect(database.capture.values[2]).toMatchObject({ action: 'workspace_domain.created', entityId: domainId })
  })

  it('rejects a second live domain and fails closed on missing inserts', async () => {
    mocks.databases.push(
      domainDatabase({ statementResults: [[], []], domain }).db,
      domainDatabase({ statementResults: [[], [], []] }).db,
      domainDatabase({ statementResults: [[], [], [{ id: domainId }], []] }).db,
    )
    const input = { workspaceId, actorUserId, hostname: domain.hostname, token: 'secret', now }
    await expect(createWorkspaceCustomDomain(input)).rejects.toThrow('Révoquez le domaine existant')
    await expect(createWorkspaceCustomDomain(input)).rejects.toThrow('création du domaine')
    await expect(createWorkspaceCustomDomain(input)).rejects.toThrow('révélation one-shot')
  })

  it('activates a DNS-owned, configured and reachable domain', async () => {
    const read = domainDatabase({ domain })
    const update = domainDatabase({ statementResults: [[{ id: domainId }]] })
    mocks.databases.push(read.db, update.db)
    await expect(verifyWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now }))
      .resolves.toMatchObject({ active: true, configured: true, reachable: true })
    expect(mocks.addVercel).toHaveBeenCalledWith(domain.hostname, false)
    expect(update.capture.sets[0]).toMatchObject({
      verificationStatus: 'active', vercelStatus: 'active', activatedAt: now, lastError: null,
    })
    expect(update.capture.values[0]).toMatchObject({ action: 'workspace_domain.activated' })
  })

  it.each([
    {
      vercel: { verified: false, configuration: { misconfigured: true } },
      expectedStatus: 'ownership_pending',
    },
    {
      vercel: { verified: true, configuration: { misconfigured: true } },
      expectedStatus: 'configuration_pending',
    },
  ])('persists partial provider progress as $expectedStatus', async ({ vercel, expectedStatus }) => {
    mocks.addVercel.mockResolvedValue(vercel)
    const read = domainDatabase({ domain: { ...domain, vercelStatus: 'ownership_pending' } })
    const update = domainDatabase({ statementResults: [[{ id: domainId }]] })
    mocks.databases.push(read.db, update.db)
    const result = await verifyWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })
    expect(result.active).toBe(false)
    expect(mocks.addVercel).toHaveBeenCalledWith(domain.hostname, true)
    expect(mocks.reaches).not.toHaveBeenCalled()
    expect(update.capture.sets[0]).toMatchObject({ verificationStatus: 'dns_verified', vercelStatus: expectedStatus })
    expect(update.capture.values[0]).toMatchObject({ action: 'workspace_domain.verification_progressed' })
  })

  it('keeps a configured but unreachable domain inactive', async () => {
    mocks.reaches.mockResolvedValue(false)
    const read = domainDatabase({ domain })
    const update = domainDatabase({ statementResults: [[{ id: domainId }]] })
    mocks.databases.push(read.db, update.db)
    const result = await verifyWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })
    expect(result).toMatchObject({ active: false, configured: true, reachable: false })
    expect(update.capture.sets[0]).toMatchObject({ verificationStatus: 'dns_verified', vercelStatus: 'configuration_pending' })
  })

  it('records DNS/provider failures without overwriting a revoked domain', async () => {
    mocks.verifyDns.mockResolvedValue(false)
    const read = domainDatabase({ domain })
    const failure = domainDatabase()
    mocks.databases.push(read.db, failure.db)
    await expect(verifyWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now }))
      .rejects.toThrow(`TXT _yodev-ads.${domain.hostname}`)
    expect(failure.capture.sets[0]).toMatchObject({ lastError: expect.stringContaining('TXT'), updatedAt: now })
  })

  it('rejects a missing domain and a concurrent revoke during verification', async () => {
    const missing = domainDatabase()
    const missingFailure = domainDatabase()
    const read = domainDatabase({ domain })
    const racedUpdate = domainDatabase({ statementResults: [[]] })
    const racedFailure = domainDatabase()
    mocks.databases.push(missing.db, missingFailure.db, read.db, racedUpdate.db, racedFailure.db)
    await expect(verifyWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })).rejects.toThrow('Domaine introuvable')
    await expect(verifyWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })).rejects.toThrow('révoqué pendant')
  })

  it('removes the provider domain then atomically revokes it', async () => {
    const read = domainDatabase({ domain })
    const update = domainDatabase({ statementResults: [[{ id: domainId }]] })
    mocks.databases.push(read.db, update.db)
    await revokeWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })
    expect(mocks.removeVercel).toHaveBeenCalledWith(domain.hostname)
    expect(update.capture.sets[0]).toMatchObject({
      verificationStatus: 'revoked', vercelStatus: 'removed', revokedAt: now, activatedAt: null,
    })
    expect(update.capture.values[0]).toMatchObject({ action: 'workspace_domain.revoked' })
  })

  it('treats provider 404 as already removed', async () => {
    mocks.removeVercel.mockRejectedValue(new Error('Vercel domain API: HTTP 404 not found'))
    const read = domainDatabase({ domain })
    const update = domainDatabase({ statementResults: [[{ id: domainId }]] })
    mocks.databases.push(read.db, update.db)
    await expect(revokeWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })).resolves.toEqual({ id: domainId })
  })

  it('records provider removal failures and rejects concurrent double revocation', async () => {
    mocks.removeVercel.mockRejectedValueOnce(new Error('provider unavailable'))
    const readFailure = domainDatabase({ domain })
    const failureAudit = domainDatabase()
    const readRace = domainDatabase({ domain })
    const updateRace = domainDatabase({ statementResults: [[]] })
    mocks.databases.push(readFailure.db, failureAudit.db, readRace.db, updateRace.db)
    await expect(revokeWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })).rejects.toThrow('provider unavailable')
    await expect(revokeWorkspaceCustomDomain({ workspaceId, actorUserId, domainId, now })).rejects.toThrow('déjà été révoqué')
  })
})
