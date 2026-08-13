import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  hashToken: vi.fn((value: string) => `hashed:${value}`),
  hashOtp: vi.fn((id: string, otp: string) => `otp:${id}:${otp}`),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: mocks.encrypt }))
vi.mock('@/lib/tokens', () => ({ hashToken: mocks.hashToken, hashOtp: mocks.hashOtp }))

import { entitlementContext } from './entitlements'
import {
  createWorkspacePublicReport,
  issuePublicReportOtp,
  revokeWorkspacePublicReport,
  submitPublicReportFeedback,
  verifyPublicReportOtp,
} from './public-report-workflows'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const shareId = '00000000-0000-4000-8000-000000000002'
const recipientId = '00000000-0000-4000-8000-000000000003'
const approvalId = '00000000-0000-4000-8000-000000000004'
const clientId = '00000000-0000-4000-8000-000000000005'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function publicReportDatabase(input: {
  statementResults?: unknown[]
  domain?: unknown
  schedule?: unknown
  recipient?: unknown
  approval?: unknown
  workspace?: unknown
} = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: {
      workspaceDomains: { findFirst: vi.fn(async () => input.domain) },
      reportSchedules: { findFirst: vi.fn(async () => input.schedule) },
      reportRecipients: { findFirst: vi.fn(async () => input.recipient) },
      approvalRequests: { findFirst: vi.fn(async () => input.approval) },
      workspaces: { findFirst: vi.fn(async () => input.workspace ?? { accessState: 'active', plan: 'agency' }) },
    },
  })
}

describe('public report workflows', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('creates a quota-guarded report with an Agency domain and one-shot URL', async () => {
    const database = publicReportDatabase({
      statementResults: [[], [], [{ count: 2 }], [{ id: shareId }], [], [], [{ id: 'revelation-1' }]],
      domain: { hostname: 'reports.example.test' },
    })
    mocks.databases.push(database.db)
    await createWorkspacePublicReport({
      workspaceId, actorUserId, clientId, label: 'Rapport', locale: 'fr', periodDays: 30,
      token: 'public-report-token', entitlements: entitlementContext('active', 'agency'),
      fallbackOrigin: 'https://ads.yodev.fr', now,
    })
    expect(database.capture.values[0]).toMatchObject({
      tokenHash: 'hashed:public-report-token', expiresAt: new Date('2026-11-10T08:00:00.000Z'),
    })
    expect(database.capture.values.at(-1)).toMatchObject({
      encryptedSecret: 'encrypted:https://reports.example.test/r/public-report-token',
    })
    expect(database.capture.values).toContainEqual(expect.objectContaining({ action: 'report.link_created' }))
    expect(database.capture.values).toContainEqual(expect.objectContaining({ milestone: 'first_report' }))
  })

  it('falls back to the Yodev origin when custom domains are not entitled', async () => {
    const database = publicReportDatabase({
      statementResults: [[], [], [{ count: 0 }], [{ id: shareId }], [], [], [{ id: 'revelation-1' }]],
      domain: { hostname: 'ignored.example.test' },
      workspace: { accessState: 'active', plan: 'solo' },
    })
    mocks.databases.push(database.db)
    await createWorkspacePublicReport({
      workspaceId, actorUserId, clientId, label: 'Rapport', locale: 'en', periodDays: 7,
      token: 'token', entitlements: entitlementContext('active', 'solo'),
      fallbackOrigin: 'https://ads.yodev.fr', now,
    })
    expect(database.capture.values.at(-1)).toMatchObject({ encryptedSecret: 'encrypted:https://ads.yodev.fr/r/token' })
  })

  it('fails closed on quota, missing share or missing revelation', async () => {
    mocks.databases.push(
      publicReportDatabase({ statementResults: [[], [], [{ count: 3 }]], workspace: { accessState: 'active', plan: 'solo' } }).db,
      publicReportDatabase({ statementResults: [[], [], [{ count: 0 }], []], workspace: { accessState: 'active', plan: 'solo' } }).db,
      publicReportDatabase({ statementResults: [[], [], [{ count: 0 }], [{ id: shareId }], [], [], []], workspace: { accessState: 'active', plan: 'solo' } }).db,
    )
    const input = {
      workspaceId, actorUserId, clientId, label: 'Rapport', locale: 'fr' as const, periodDays: 30,
      token: 'token', entitlements: entitlementContext('active', 'solo'), fallbackOrigin: 'https://ads.yodev.fr', now,
    }
    await expect(createWorkspacePublicReport(input)).rejects.toThrow('Quota exceeded')
    await expect(createWorkspacePublicReport(input)).rejects.toThrow('création du rapport')
    await expect(createWorkspacePublicReport(input)).rejects.toThrow('révélation one-shot')
  })

  it('revokes a report and its schedule atomically', async () => {
    const database = publicReportDatabase({
      statementResults: [[{ id: shareId }]], schedule: { id: 'schedule-1', deliveryLeaseUntil: null },
    })
    mocks.databases.push(database.db)
    await revokeWorkspacePublicReport({ workspaceId, actorUserId, shareId, now })
    expect(database.capture.sets[0]).toEqual({ active: false, expiresAt: now, updatedAt: now })
    expect(database.capture.sets[1]).toEqual({ enabled: false, updatedAt: now })
    expect(database.capture.values[0]).toMatchObject({ action: 'report.link_revoked', entityId: shareId })
  })

  it('rejects revocation while delivery is leased or when the link is absent', async () => {
    mocks.databases.push(
      publicReportDatabase({ schedule: { deliveryLeaseUntil: new Date('2026-08-12T08:01:00Z') } }).db,
      publicReportDatabase({ statementResults: [[]] }).db,
    )
    await expect(revokeWorkspacePublicReport({ workspaceId, actorUserId, shareId, now })).rejects.toThrow('envoi est en cours')
    await expect(revokeWorkspacePublicReport({ workspaceId, actorUserId, shareId, now })).rejects.toThrow('Lien introuvable')
  })

  it('issues a reset OTP challenge without storing the plaintext code', async () => {
    const database = publicReportDatabase({ statementResults: [[{ id: recipientId }]] })
    mocks.databases.push(database.db)
    await issuePublicReportOtp({ workspaceId, shareId, email: 'client@example.test', otp: '123456', now })
    expect(database.capture.values[0]).toMatchObject({
      email: 'client@example.test', otpExpiresAt: new Date('2026-08-12T08:10:00.000Z'),
    })
    expect(database.capture.sets[0]).toMatchObject({ otpHash: `otp:${recipientId}:123456` })
    expect(database.capture.values[1]).toMatchObject({ action: 'report.feedback_otp_requested' })
    expect(JSON.stringify(database.capture.values)).not.toContain('123456')
  })

  it('fails closed if OTP upsert returns no recipient', async () => {
    mocks.databases.push(publicReportDatabase({ statementResults: [[]] }).db)
    await expect(issuePublicReportOtp({ workspaceId, shareId, email: 'x@example.test', otp: '123456', now }))
      .rejects.toThrow('création du code OTP')
  })

  it('verifies an OTP, rotates the session and audits it', async () => {
    const database = publicReportDatabase({
      recipient: { id: recipientId, otpAttemptCount: 1, otpHash: `otp:${recipientId}:123456` },
    })
    mocks.databases.push(database.db)
    await verifyPublicReportOtp({
      workspaceId, shareId, recipientId, otp: '123456', sessionToken: 'session-secret', english: false, now,
    })
    expect(database.capture.sets[0]).toMatchObject({
      otpHash: null, verifiedAt: now, sessionTokenHash: 'hashed:session-secret',
      sessionExpiresAt: new Date('2026-08-12T09:00:00.000Z'),
    })
    expect(database.capture.values[0]).toMatchObject({ action: 'report.feedback_email_verified' })
  })

  it.each([
    { recipient: undefined, english: false, message: 'Code incorrect ou expiré' },
    { recipient: { id: recipientId, otpAttemptCount: 5, otpHash: 'x' }, english: true, message: 'Incorrect or expired code' },
    { recipient: { id: recipientId, otpAttemptCount: 1, otpHash: 'wrong' }, english: false, message: 'Code incorrect ou expiré' },
  ])('commits failed OTP accounting before returning an error %#', async ({ recipient, english, message }) => {
    const database = publicReportDatabase({ recipient })
    mocks.databases.push(database.db)
    await expect(verifyPublicReportOtp({
      workspaceId, shareId, recipientId, otp: '000000', sessionToken: 'session', english, now,
    })).rejects.toThrow(message)
    if (recipient) expect(database.capture.sets[0]).toMatchObject({ updatedAt: now })
  })

  it('validates session and pending approval in the same feedback transaction', async () => {
    const database = publicReportDatabase({
      recipient: { id: recipientId }, approval: { id: approvalId },
    })
    mocks.databases.push(database.db)
    await submitPublicReportFeedback({
      workspaceId, shareId, clientId, sessionToken: 'session', approvalId,
      authorName: 'Client', decision: 'approved', comment: 'Bon pour accord.', english: false, now,
    })
    expect(database.capture.values[0]).toMatchObject({
      shareId, approvalId, authorName: 'Client', decision: 'approved', comment: 'Bon pour accord.',
    })
    expect(database.capture.values[1]).toMatchObject({
      action: 'approval.client_feedback_received', actorUserId: `report-recipient:${recipientId}`,
    })
    expect(database.capture.sets.at(-1)).toMatchObject({ decision: 'approved', decisionAt: now })
    expect(mocks.contexts.at(-1)).toEqual({ workspaceId, userId: 'public:report-feedback' })
  })

  it('rejects expired sessions and non-pending approvals in the requested locale', async () => {
    mocks.databases.push(
      publicReportDatabase().db,
      publicReportDatabase({ recipient: { id: recipientId } }).db,
    )
    const base = {
      workspaceId, shareId, clientId, sessionToken: 'session', approvalId,
      authorName: 'Client', decision: 'changes_requested' as const, comment: '', now,
    }
    await expect(submitPublicReportFeedback({ ...base, english: true })).rejects.toThrow('verification has expired')
    await expect(submitPublicReportFeedback({ ...base, english: false })).rejects.toThrow('plus en attente')
  })
})
