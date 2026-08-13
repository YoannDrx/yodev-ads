import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { encryptSecret, secretEnvelopeKeyId } from '@/lib/crypto'
import { rotateWorkspaceSecrets } from '@/lib/secret-rotation'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const original = {
  legacy: process.env.APP_ENCRYPTION_KEY,
  keys: process.env.APP_ENCRYPTION_KEYS,
  kid: process.env.APP_ENCRYPTION_CURRENT_KID,
}

function restore(name: 'APP_ENCRYPTION_KEY' | 'APP_ENCRYPTION_KEYS' | 'APP_ENCRYPTION_CURRENT_KID', value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function queryDouble(encryptedValue: string, workspace: unknown = { id: workspaceId }) {
  const row = (field: string) => ({ id: `00000000-0000-4000-8000-${field.padStart(12, '0')}`, [field]: encryptedValue })
  return {
    workspaces: { findFirst: vi.fn(async () => workspace) },
    googleAdsConnections: { findMany: vi.fn(async () => [row('encryptedRefreshToken')]) },
    memberNotificationPreferences: { findMany: vi.fn(async () => [row('encryptedEmail')]) },
    secretRevelations: { findMany: vi.fn(async () => [row('encryptedSecret')]) },
    notificationChannels: { findMany: vi.fn(async () => [row('encryptedDestination')]) },
    notificationOAuthSessions: { findMany: vi.fn(async () => [row('encryptedRefreshToken')]) },
    reportSchedules: { findMany: vi.fn(async () => [row('encryptedReportToken')]) },
  }
}

describe('workspace secret rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
    delete process.env.APP_ENCRYPTION_KEYS
    delete process.env.APP_ENCRYPTION_CURRENT_KID
  })

  afterEach(() => {
    restore('APP_ENCRYPTION_KEY', original.legacy)
    restore('APP_ENCRYPTION_KEYS', original.keys)
    restore('APP_ENCRYPTION_CURRENT_KID', original.kid)
  })

  it('optimistically rewraps every tenant secret family and records one redacted audit summary', async () => {
    const legacy = encryptSecret('sensitive-value')
    process.env.APP_ENCRYPTION_KEYS = JSON.stringify({ current: Buffer.alloc(32, 9).toString('base64url') })
    process.env.APP_ENCRYPTION_CURRENT_KID = 'current'
    const database = databaseDouble({
      statementResults: [[{ id: '1' }], [{ id: '2' }], [{ id: '3' }], [{ id: '4' }], [{ id: '5' }], [{ id: '6' }], []],
      query: queryDouble(legacy),
    })
    mocks.database = database.db

    await expect(rotateWorkspaceSecrets(workspaceId)).resolves.toMatchObject({
      workspaceId,
      currentKid: 'current',
      rotated: 6,
      skipped: false,
    })
    expect(database.capture.sets).toHaveLength(6)
    for (const update of database.capture.sets as Array<Record<string, string>>) {
      const value = Object.entries(update).find(([key]) => key.startsWith('encrypted'))?.[1]
      expect(value).toBeDefined()
      expect(secretEnvelopeKeyId(value!)).toBe('current')
    }
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      action: 'workspace.secrets_rotated',
      actorUserId: 'system:secret-rotation',
      metadata: expect.objectContaining({ currentKid: 'current', rotated: 6 }),
    }))
    expect(JSON.stringify(database.capture.values)).not.toContain('sensitive-value')
  })

  it('skips an unknown workspace without querying or writing tenant secrets', async () => {
    process.env.APP_ENCRYPTION_KEYS = JSON.stringify({ current: Buffer.alloc(32, 9).toString('base64url') })
    process.env.APP_ENCRYPTION_CURRENT_KID = 'current'
    const query = queryDouble('unused', null)
    const database = databaseDouble({ query })
    mocks.database = database.db
    await expect(rotateWorkspaceSecrets(workspaceId)).resolves.toEqual({ workspaceId, currentKid: 'current', rotated: 0, skipped: true })
    expect(query.googleAdsConnections.findMany).not.toHaveBeenCalled()
    expect(database.capture.sets).toEqual([])
  })
})
