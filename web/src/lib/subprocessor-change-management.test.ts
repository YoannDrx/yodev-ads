import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { getPublishedSubprocessorChangeNotices, scheduleSubprocessorChangeNotice } from './subprocessor-change-management'

const internalWorkspaceId = '00000000-0000-4000-8000-000000000001'
const noticeId = '00000000-0000-4000-8000-000000000002'
const now = new Date('2026-08-13T10:00:00.000Z')

describe('subprocessor change management', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the bilingual notice and its internal audit evidence atomically', async () => {
    const database = databaseDouble({ statementResults: [[{ id: noticeId }]] })
    mocks.database = database.db
    await expect(scheduleSubprocessorChangeNotice({
      internalWorkspaceId,
      actorUserId: 'user-1',
      vendorName: 'New Processor',
      changeType: 'addition',
      summaryFr: 'Nouveau prestataire pour la distribution des emails.',
      summaryEn: 'New provider used to deliver transactional emails.',
      effectiveAt: new Date('2026-08-28T10:00:00.000Z'),
      now,
    })).resolves.toEqual({ id: noticeId })
    expect(database.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ vendorName: 'New Processor', changeType: 'addition', createdAt: now }),
      expect.objectContaining({
        workspaceId: internalWorkspaceId,
        action: 'subprocessor.notice_scheduled',
        entityId: noticeId,
      }),
    ]))
  })

  it('fails before opening a transaction when the legal notice period is too short', () => {
    expect(() => scheduleSubprocessorChangeNotice({
      internalWorkspaceId,
      actorUserId: 'user-1',
      vendorName: 'New Processor',
      changeType: 'addition',
      summaryFr: 'Résumé français suffisamment long.',
      summaryEn: 'English summary that is long enough.',
      effectiveAt: new Date('2026-08-20T10:00:00.000Z'),
      now,
    })).toThrow('15 jours')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('lists only notices exposed by the system repository contract', async () => {
    const notices = [{ id: noticeId, status: 'scheduled' }]
    mocks.database = databaseDouble({
      query: { subprocessorChangeNotices: { findMany: vi.fn(async () => notices) } },
    }).db
    await expect(getPublishedSubprocessorChangeNotices()).resolves.toEqual(notices)
  })
})
