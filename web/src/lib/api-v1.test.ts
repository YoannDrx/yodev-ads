import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  enabled: true,
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/feature-flags', () => ({
  featureEnabled: () => mocks.enabled,
  privateApiWorkspaceAllowed: () => mocks.enabled,
}))

import { apiData, apiError, ApiV1Error, authenticateApiRequest } from './api-v1'

const credential = {
  key: { id: 'key-1', workspaceId: 'workspace-1', scopes: ['portfolio:read', 'approvals:propose'] },
  workspace: { id: 'workspace-1', plan: 'agency', accessState: 'active' },
}

function request(token = 'ya_live_secret', headers: Record<string, string> = {}) {
  return new Request('https://ads.yodev.fr/api/v1/portfolio?ignored=1', {
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '198.51.100.2, 10.0.0.1', ...headers },
  })
}

describe('API v1 response contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.databases = []
    mocks.enabled = true
    process.env.API_IP_HASH_KEY = 'api-ip-key'
  })

  afterEach(() => delete process.env.API_IP_HASH_KEY)

  it('returns the stable data envelope and request ID', async () => {
    const response = apiData({ ok: true }, 'req-1', 'cursor-2', 201)
    expect(response.status).toBe(201)
    expect(response.headers.get('x-request-id')).toBe('req-1')
    expect(await response.json()).toEqual({ data: { ok: true }, meta: { requestId: 'req-1', nextCursor: 'cursor-2' } })
  })

  it('returns stable known and redacted unknown errors', async () => {
    const known = apiError(new ApiV1Error('BAD_INPUT', 'Nope', 422, { field: 'name' }), 'req-2')
    expect(known.status).toBe(422)
    expect(await known.json()).toEqual({ error: { code: 'BAD_INPUT', message: 'Nope', requestId: 'req-2', details: { field: 'name' } } })
    const unknown = apiError(new Error('secret DB failure'), 'req-3')
    expect(unknown.status).toBe(500)
    expect(await unknown.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'req-3', details: {} } })
  })

  it('returns a safe client error for invalid query parameters', async () => {
    const parsed = z.number().parseAsync('private-value')
    const error = await parsed.catch((value) => value)
    const response = apiError(error, 'req-invalid')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'INVALID_INPUT', message: 'Request parameters are invalid', requestId: 'req-invalid', details: {} } })
  })

  it('authenticates an entitled scoped key, updates evidence and writes audit', async () => {
    const lookup = databaseDouble({ statementResults: [[credential]] })
    const limit = databaseDouble({ statementResults: [[{ count: 1 }]] })
    const usage = databaseDouble()
    const audit = databaseDouble()
    mocks.databases.push(lookup.db, limit.db, usage.db, audit.db)
    const result = await authenticateApiRequest(request(), 'portfolio:read')
    expect(result.key.id).toBe('key-1')
    expect(result.entitlements.capabilities.has('api.read')).toBe(true)
    expect(usage.capture.sets[0]).toEqual(expect.objectContaining({ lastIpHash: expect.not.stringContaining('198.51.100.2') }))
    expect(audit.capture.values[0]).toEqual(expect.objectContaining({
      action: 'api.request', actorUserId: 'api-key:key-1',
      metadata: { method: 'GET', path: '/api/v1/portfolio', scope: 'portfolio:read' },
    }))
  })

  it('rejects disabled API, malformed bearer tokens, missing credentials and invalid workspace state', async () => {
    mocks.enabled = false
    await expect(authenticateApiRequest(request(), 'portfolio:read')).rejects.toMatchObject({ code: 'FEATURE_DISABLED', status: 503 })
    mocks.enabled = true
    await expect(authenticateApiRequest(request('wrong'), 'portfolio:read')).rejects.toMatchObject({ code: 'INVALID_API_KEY', status: 401 })
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(authenticateApiRequest(request(), 'portfolio:read')).rejects.toMatchObject({ code: 'INVALID_API_KEY', status: 401 })
    mocks.databases.push(databaseDouble({ statementResults: [[{ ...credential, workspace: { ...credential.workspace, plan: 'unknown' } }]] }).db)
    await expect(authenticateApiRequest(request(), 'portfolio:read')).rejects.toMatchObject({ code: 'WORKSPACE_SUSPENDED', status: 403 })
    mocks.databases.push(databaseDouble({ statementResults: [[{ ...credential, workspace: { ...credential.workspace, accessState: 'unknown' } }]] }).db)
    await expect(authenticateApiRequest(request(), 'portfolio:read')).rejects.toMatchObject({ code: 'WORKSPACE_SUSPENDED', status: 403 })
  })

  it('enforces capability, scope, rate limit and hashing configuration before audit', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[{ ...credential, workspace: { ...credential.workspace, plan: 'solo' } }]] }).db)
    await expect(authenticateApiRequest(request(), 'portfolio:read')).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })

    mocks.databases.push(databaseDouble({ statementResults: [[credential]] }).db)
    await expect(authenticateApiRequest(request(), 'reports:read')).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' })

    mocks.databases.push(
      databaseDouble({ statementResults: [[credential]] }).db,
      databaseDouble({ statementResults: [[{ count: 121 }]] }).db,
    )
    await expect(authenticateApiRequest(request(), 'portfolio:read')).rejects.toMatchObject({
      code: 'RATE_LIMITED', status: 429, details: { retryAfterSeconds: 60 },
    })

    delete process.env.API_IP_HASH_KEY
    delete process.env.LEGAL_FINGERPRINT_KEY
    delete process.env.APP_ENCRYPTION_KEY
    mocks.databases.push(
      databaseDouble({ statementResults: [[credential]] }).db,
      databaseDouble({ statementResults: [[{ count: 1 }]] }).db,
      databaseDouble().db,
    )
    await expect(authenticateApiRequest(request(), 'portfolio:read')).rejects.toMatchObject({ code: 'SERVER_MISCONFIGURED', status: 503 })
  })
})
