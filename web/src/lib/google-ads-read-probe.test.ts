import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const mocks = vi.hoisted(() => ({
  db: {} as unknown, transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.db)), gateway: vi.fn(),
}))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/google-ads', () => ({
  GoogleAdsError: class extends Error {},
  GoogleAdsGateway: class { constructor(context: unknown) { mocks.gateway(context); throw new Error('stop before provider access') } },
}))
import { runGoogleAdsReadProbe } from './google-ads-read-drill'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
function contextDatabase(connections: unknown[], advertisers: unknown[]) {
  const results = [connections, advertisers]
  const predicates: Array<{ sql: string; params: unknown[] }> = []
  const dialect = new PgDialect()
  mocks.db = { select: () => {
    const statement = {
      from: () => statement, innerJoin: () => statement, orderBy: () => statement,
      where: (sql: SQL) => { predicates.push(dialect.sqlToQuery(sql)); return statement },
      limit: async () => results.shift(),
    }
    return statement
  } }
  return predicates
}
describe('commercial Google probe account selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('GOOGLE_ADS_VERIFICATION_WORKSPACE_ID', workspaceId)
    vi.stubEnv('GOOGLE_ADS_VERIFICATION_CLIENT_ID', clientId)
  })
  afterEach(() => vi.unstubAllEnvs())
  it('requires explicit valid identifiers before any database or provider access', async () => {
    vi.stubEnv('GOOGLE_ADS_VERIFICATION_CLIENT_ID', '')
    await expect(runGoogleAdsReadProbe()).rejects.toMatchObject({ code: 'verification_account_not_configured' })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.gateway).not.toHaveBeenCalled()
  })
  it('refuses absent or ambiguous internal connections', async () => {
    const predicates = contextDatabase([], [])
    await expect(runGoogleAdsReadProbe()).rejects.toMatchObject({ code: 'connection_missing' })
    expect(predicates[0].params).toEqual(['internal', 'active', workspaceId])
    contextDatabase([{}, {}], [])
    await expect(runGoogleAdsReadProbe()).rejects.toMatchObject({ code: 'connection_ambiguous' })
    expect(mocks.gateway).not.toHaveBeenCalled()
  })
  it('cannot fall back to another client or workspace when the selected advertiser is unavailable', async () => {
    const predicates = contextDatabase([{ workspaceId, encryptedRefreshToken: 'encrypted', managerCustomerId: '111' }], [])
    await expect(runGoogleAdsReadProbe()).rejects.toMatchObject({ code: 'advertiser_missing' })
    expect(predicates[1].sql).toContain('"clients"."workspace_id"')
    expect(predicates[1].params).toEqual([workspaceId, true, false, clientId])
    expect(mocks.gateway).not.toHaveBeenCalled()
  })
})
