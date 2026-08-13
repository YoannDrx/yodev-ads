import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  enqueueJobs: vi.fn(),
  send: vi.fn(),
  verifiedAuthUserEmail: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jobs')>(),
  enqueueJobs: mocks.enqueueJobs,
}))
vi.mock('@/lib/auth-identities', () => ({ verifiedAuthUserEmail: mocks.verifiedAuthUserEmail }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))

import { deliverSubprocessorChangeNotice, fanOutSubprocessorChangeNotice } from './subprocessor-change-notifications'

const noticeId = '00000000-0000-4000-8000-000000000001'
const workspaceId = '00000000-0000-4000-8000-000000000002'
const secondWorkspaceId = '00000000-0000-4000-8000-000000000003'
const effectiveAt = new Date('2026-09-01T10:00:00.000Z')

function contextDatabase(input: { notice?: unknown; workspace?: unknown; recipients?: unknown[] }) {
  return databaseDouble({
    statementResults: [input.recipients ?? []],
    query: {
      subprocessorChangeNotices: { findFirst: vi.fn(async () => input.notice) },
      workspaces: { findFirst: vi.fn(async () => input.workspace) },
    },
  })
}

describe('subprocessor change notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.databases = []
    mocks.enqueueJobs.mockImplementation(async (items: unknown[]) => ({ requested: items.length, created: items.length }))
    mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    process.env.RESEND_API_KEY = 'test-key'
    process.env.NEXT_PUBLIC_APP_URL = 'https://ads.example.test'
  })

  it('fans out one idempotent job per eligible commercial workspace and marks dispatch complete', async () => {
    const notice = { id: noticeId, status: 'scheduled', notifiedAt: null }
    const context = contextDatabase({ notice, recipients: [{ id: workspaceId }, { id: secondWorkspaceId }] })
    const completion = databaseDouble()
    mocks.databases.push(context.db, completion.db)
    await expect(fanOutSubprocessorChangeNotice(noticeId, new Date('2026-08-13T11:00:00.000Z'))).resolves.toMatchObject({
      requested: 2,
      created: 2,
      alreadyFannedOut: false,
    })
    expect(mocks.enqueueJobs).toHaveBeenCalledWith([
      expect.objectContaining({ workspaceId, type: 'subprocessor.notice_deliver', deduplicationKey: `subprocessor.notice_deliver:${noticeId}:${workspaceId}` }),
      expect.objectContaining({ workspaceId: secondWorkspaceId, type: 'subprocessor.notice_deliver', deduplicationKey: `subprocessor.notice_deliver:${noticeId}:${secondWorkspaceId}` }),
    ])
    expect(completion.capture.sets[0]).toMatchObject({ status: 'completed', notifiedAt: expect.any(Date) })
  })

  it('does not fan out a notice that was already dispatched', async () => {
    mocks.databases.push(contextDatabase({ notice: { id: noticeId, status: 'completed', notifiedAt: new Date() } }).db)
    await expect(fanOutSubprocessorChangeNotice(noticeId)).resolves.toEqual({ requested: 0, created: 0, alreadyFannedOut: true })
    expect(mocks.enqueueJobs).not.toHaveBeenCalled()
  })

  it('rejects a cancelled fan-out without creating tenant jobs', async () => {
    mocks.databases.push(contextDatabase({ notice: { id: noticeId, status: 'cancelled', notifiedAt: null } }).db)
    await expect(fanOutSubprocessorChangeNotice(noticeId)).rejects.toThrow('annulée')
    expect(mocks.enqueueJobs).not.toHaveBeenCalled()
  })

  it('delivers localized content with provider idempotency and tenant audit evidence', async () => {
    const notice = {
      id: noticeId, status: 'completed', vendorName: 'Processor', changeType: 'addition',
      summaryFr: 'Ajout du prestataire pour les emails.', summaryEn: 'Provider addition for transactional email.', effectiveAt,
    }
    const workspace = {
      id: workspaceId, accessState: 'active', billingEmail: 'BILLING@EXAMPLE.COM', ownerUserId: 'owner-1',
      locale: 'en', name: 'Studio', timezone: 'Europe/Paris',
    }
    const audit = databaseDouble()
    mocks.databases.push(contextDatabase({ notice, workspace }).db, audit.db)
    await expect(deliverSubprocessorChangeNotice({ noticeId, workspaceId })).resolves.toEqual({ delivered: true, providerMessageId: 'email-1' })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'billing@example.com',
      subject: expect.stringContaining('Subprocessor change notice'),
      html: expect.stringContaining('Provider addition for transactional email.'),
    }), { idempotencyKey: `subprocessor:${noticeId}:${workspaceId}` })
    expect(audit.capture.values[0]).toMatchObject({
      workspaceId,
      action: 'subprocessor.notice_delivered',
      entityId: noticeId,
      metadata: expect.objectContaining({ providerMessageId: 'email-1' }),
    })
    expect(mocks.verifiedAuthUserEmail).not.toHaveBeenCalled()
  })

  it('fails closed for cancelled notices and unavailable workspaces', async () => {
    mocks.databases.push(
      contextDatabase({ notice: { id: noticeId, status: 'cancelled' }, workspace: { id: workspaceId } }).db,
      contextDatabase({ notice: { id: noticeId, status: 'completed' }, workspace: undefined }).db,
    )
    await expect(deliverSubprocessorChangeNotice({ noticeId, workspaceId })).rejects.toThrow('indisponible')
    await expect(deliverSubprocessorChangeNotice({ noticeId, workspaceId })).rejects.toThrow('destinataire indisponible')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('falls back to a verified owner address when no billing address exists', async () => {
    const notice = {
      id: noticeId, status: 'completed', vendorName: 'Processor', changeType: 'removal',
      summaryFr: 'Retrait du prestataire devenu inutile.', summaryEn: 'Removal of the provider that is no longer used.', effectiveAt,
    }
    const workspace = {
      id: workspaceId, accessState: 'suspended', billingEmail: null, ownerUserId: 'owner-1',
      locale: 'fr', name: 'Atelier', timezone: 'Europe/Paris',
    }
    mocks.verifiedAuthUserEmail.mockResolvedValue('owner@example.com')
    mocks.databases.push(contextDatabase({ notice, workspace }).db, databaseDouble().db)
    await deliverSubprocessorChangeNotice({ noticeId, workspaceId })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.com',
      subject: expect.stringContaining('Notification de changement'),
    }), expect.any(Object))
  })
})
