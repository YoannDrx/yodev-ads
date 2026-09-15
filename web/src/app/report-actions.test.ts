import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), feature: vi.fn(), client: vi.fn(), token: vi.fn(), cookie: vi.fn(), redirect: vi.fn(),
  createWorkspacePublicReport: vi.fn(), reviseWorkspacePublicReport: vi.fn(), revokeWorkspacePublicReport: vi.fn(),
  createWorkspaceReportTemplate: vi.fn(), updateWorkspaceReportTemplate: vi.fn(), deactivateWorkspaceReportTemplate: vi.fn(),
  createWorkspaceReportSchedule: vi.fn(), setWorkspaceReportScheduleEnabled: vi.fn(), rotateWorkspaceScheduledReportToken: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookie }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.context }))
vi.mock('@/lib/data', () => ({ getWorkspaceClient: mocks.client }))
vi.mock('@/lib/feature-flags', () => ({ requireFeature: mocks.feature }))
vi.mock('@/lib/tokens', () => ({ createShareToken: mocks.token }))
vi.mock('@/lib/report-management', () => ({ createWorkspaceReportTemplate: mocks.createWorkspaceReportTemplate, updateWorkspaceReportTemplate: mocks.updateWorkspaceReportTemplate,
  deactivateWorkspaceReportTemplate: mocks.deactivateWorkspaceReportTemplate, createWorkspaceReportSchedule: mocks.createWorkspaceReportSchedule,
  setWorkspaceReportScheduleEnabled: mocks.setWorkspaceReportScheduleEnabled, rotateWorkspaceScheduledReportToken: mocks.rotateWorkspaceScheduledReportToken }))
vi.mock('@/lib/public-report-workflows', () => ({ createWorkspacePublicReport: mocks.createWorkspacePublicReport, reviseWorkspacePublicReport: mocks.reviseWorkspacePublicReport, revokeWorkspacePublicReport: mocks.revokeWorkspacePublicReport }))
import * as actions from './report-actions'
import { entitlementContext } from '@/lib/entitlements'

const workspaceId = '00000000-0000-4000-8000-000000000001', entityId = '00000000-0000-4000-8000-000000000002'
const pairs = [
  ['createShareLink', 'createWorkspacePublicReport'], ['reviseReportEdition', 'reviseWorkspacePublicReport'], ['revokeShareLink', 'revokeWorkspacePublicReport'],
  ['createReportTemplate', 'createWorkspaceReportTemplate'], ['updateReportTemplate', 'updateWorkspaceReportTemplate'], ['deactivateReportTemplate', 'deactivateWorkspaceReportTemplate'],
  ['createReportSchedule', 'createWorkspaceReportSchedule'], ['toggleReportSchedule', 'setWorkspaceReportScheduleEnabled'], ['rotateScheduledReportToken', 'rotateWorkspaceScheduledReportToken'],
] as const
function form() {
  const data = new FormData()
  for (const [key, value] of Object.entries({ workspaceId, clientId: entityId, templateId: entityId, shareId: entityId, previousEditionId: entityId, scheduleId: entityId,
    label: 'Report fixture', name: 'Template fixture', expectedVersion: '1', locale: 'en', period: '30', mode: 'fixed', cadence: 'monthly', scheduleWeekday: '1', scheduleMonthday: '1', sendHour: '8', timezone: 'UTC', recipients: 'Recipient@example.test', operation: 'enable',
  })) data.set(key, value)
  return data
}
function noSideEffects() {
  for (const [, service] of pairs) expect(mocks[service]).not.toHaveBeenCalled()
  expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled(); expect(mocks.cookie).not.toHaveBeenCalled()
}
function redirectedError() { return new URL(mocks.redirect.mock.calls[0][0], 'https://example.test').searchParams.get('error') }

describe('report forms bound to their displayed workspace', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`) })
    mocks.context.mockResolvedValue({ workspace: { id: workspaceId, locale: 'en' }, session: { userId: 'actor' }, entitlements: entitlementContext('active', 'agency') })
    mocks.token.mockReturnValue('fixture-token'); mocks.client.mockResolvedValue({ id: entityId })
    mocks.createWorkspacePublicReport.mockResolvedValue({ id: entityId }); mocks.reviseWorkspacePublicReport.mockResolvedValue({ id: entityId })
  })
  it.each(pairs)('%s preserves its authorized service call', async (action, service) => {
    await expect(actions[action](form())).rejects.toThrow('redirect:/reports?notice=')
    expect(mocks.context).toHaveBeenCalledWith('reports:manage')
    expect(mocks[service]).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorUserId: 'actor' }))
    expect(mocks[service]).toHaveBeenCalledTimes(1)
  })
  for (const invalid of ['missing', 'different', 'duplicate'] as const) it.each(pairs)(`%s rejects a ${invalid} workspace before side effects`, async (action) => {
    const data = form()
    if (invalid === 'missing') data.delete('workspaceId')
    if (invalid === 'different') data.set('workspaceId', entityId)
    if (invalid === 'duplicate') data.append('workspaceId', workspaceId)
    await expect(actions[action](data)).rejects.toThrow('redirect:/reports?error=')
    expect(redirectedError()).toBe('L’espace actif a changé. Rechargez la page avant d’enregistrer.')
    noSideEffects(); expect(mocks.feature).not.toHaveBeenCalled()
  })
  it.each(pairs)('%s still requires permission independently of the hidden context', async (action) => {
    mocks.context.mockRejectedValue(new Error('Permission required: reports:manage'))
    await expect(actions[action](form())).rejects.toThrow('redirect:/reports?error=')
    noSideEffects()
  })
  it.each(pairs)('%s keeps failed query parameters out of redirects', async (action, service) => {
    mocks[service].mockRejectedValue(new Error('Failed query: insert report (private-editorial, bearer-secret, private@example.test)'))
    await expect(actions[action](form())).rejects.toThrow('redirect:/reports?error=')
    expect(redirectedError()).toBe('Impossible d’enregistrer cette modification du rapport. Actualisez la page et réessayez.')
    expect(mocks.cookie).not.toHaveBeenCalled()
  })
  it('rejects malformed report data before creating a report', async () => {
    const data = form(); data.set('period', 'custom'); data.set('periodFrom', '2026-02-31'); data.set('periodThrough', '2026-03-01')
    await expect(actions.createShareLink(data)).rejects.toThrow('redirect:/reports?error=')
    expect(redirectedError()).toContain('Vérifiez les champs'); noSideEffects()
  })
})
