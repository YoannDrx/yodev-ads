import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))

import {
  saveClientGoal,
  saveWorkspaceApprovalPolicy,
  saveWorkspaceBranding,
  saveWorkspaceLocale,
  saveWorkspaceLogo,
} from './workspace-settings'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const actorUserId = 'user-1'

describe('workspace settings repository', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('normalizes monetary goals to micros and preserves nullable targets', async () => {
    const database = databaseDouble()
    mocks.databases.push(database.db)
    await saveClientGoal({
      workspaceId,
      actorUserId,
      clientId,
      currencyCode: 'EUR',
      primaryKpi: 'roas',
      monthlyBudget: 123.45,
      targetCpa: '',
      targetRoas: 4.5,
      targetConversions: '',
      targetConversionValue: 999,
      conversionValue: '',
      marginPercent: 32,
    })
    expect(database.capture.values[0]).toMatchObject({
      monthlyBudgetMicros: '123450000',
      targetCpaMicros: null,
      targetRoas: '4.5',
      targetConversions: null,
      targetConversionValueMicros: '999000000',
      conversionValueMicros: null,
      marginPercent: '32',
    })
    expect(database.capture.values[1]).toMatchObject({
      action: 'client.goal_updated',
      metadata: { primaryKpi: 'roas', currencyCode: 'EUR' },
    })
  })

  it('writes locale, approval policy and branding with explicit previous-state audit', async () => {
    const locale = databaseDouble()
    const approval = databaseDouble()
    const branding = databaseDouble()
    mocks.databases.push(locale.db, approval.db, branding.db)
    await saveWorkspaceLocale({ workspaceId, actorUserId, previousLocale: 'fr', locale: 'en' })
    await saveWorkspaceApprovalPolicy({
      workspaceId,
      actorUserId,
      previousRequiredApprovals: 1,
      previousAllowSelfApproval: false,
      requiredApprovals: 2,
      allowSelfApproval: false,
      approvalMode: 'dual',
    })
    await saveWorkspaceBranding({
      workspaceId,
      actorUserId,
      brandName: 'ACME Ads',
      brandTagline: 'Safe growth',
      accentColor: '#123456',
    })
    expect(locale.capture.sets[0]).toMatchObject({ locale: 'en' })
    expect(locale.capture.values[0]).toMatchObject({ action: 'workspace.locale_updated' })
    expect(approval.capture.sets[0]).toMatchObject({ approvalMode: 'dual', requiredApprovals: 2 })
    expect(approval.capture.values[0]).toMatchObject({
      metadata: expect.objectContaining({ previousRequiredApprovals: 1, requiredApprovals: 2 }),
    })
    expect(branding.capture.sets[0]).toMatchObject({ brandName: 'ACME Ads', accentColor: '#123456' })
  })

  it('audits both controlled logo upload and removal without exposing file contents', async () => {
    const upload = databaseDouble()
    const removal = databaseDouble()
    mocks.databases.push(upload.db, removal.db)
    await saveWorkspaceLogo({
      workspaceId,
      actorUserId,
      logoUrl: 'https://blob.public.blob.vercel-storage.com/workspace-branding/logo.png',
      contentType: 'image/png',
      size: 512,
    })
    await saveWorkspaceLogo({ workspaceId, actorUserId, logoUrl: null })
    expect(upload.capture.values[0]).toMatchObject({
      action: 'workspace.logo_uploaded',
      metadata: { contentType: 'image/png', size: 512 },
    })
    expect(removal.capture.values[0]).toMatchObject({ action: 'workspace.logo_removed', metadata: {} })
    expect(mocks.contexts).toEqual([
      { workspaceId, userId: actorUserId },
      { workspaceId, userId: actorUserId },
    ])
  })
})
