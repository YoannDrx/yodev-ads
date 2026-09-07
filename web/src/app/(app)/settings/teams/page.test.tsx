import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const mocks = vi.hoisted(() => ({ context: vi.fn(), cookie: vi.fn(), state: vi.fn(), access: vi.fn(), teams: vi.fn(), channels: vi.fn() }))
vi.mock('@/app/teams-connection-actions', () => ({ completeTeamsNotificationConnection: async () => {} }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePagePermission: mocks.context }))
vi.mock('@/lib/feature-flags', () => ({ featureEnabled: () => true }))
vi.mock('@/lib/oauth-state', () => ({ openOAuthState: mocks.state }))
vi.mock('@/lib/notification-oauth-management', () => ({ accessTeamsOAuthSession: mocks.access }))
vi.mock('@/lib/teams-oauth', () => ({ listJoinedTeams: mocks.teams, listTeamChannels: mocks.channels }))
import Page from './page'
import { entitlementContext } from '@/lib/entitlements'
const workspaceId = '00000000-0000-4000-8000-000000000001', sessionId = '00000000-0000-4000-8000-000000000002'
const params = { workspaceId, sessionId, teamId: 'fixture-team' }
describe('Teams selection page', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.context.mockResolvedValue({ workspace: { id: workspaceId, locale: 'en' }, session: { userId: 'actor' }, entitlements: entitlementContext('active', 'agency') })
    mocks.cookie.mockReturnValue({ value: 'signed-cookie' }); mocks.state.mockReturnValue({ workspaceId, userId: 'actor', payload: { sessionId } })
    mocks.access.mockResolvedValue({ accessToken: 'fixture-access', expiresAt: new Date('2030-01-01') }); mocks.teams.mockResolvedValue([{ id: 'fixture-team', displayName: 'Fixture team' }]); mocks.channels.mockResolvedValue([{ id: 'fixture-channel', displayName: 'Fixture channel' }])
  })
  it('binds both forms to the workspace/session and labels both choices', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }))
    expect(html.match(/name="workspaceId"/g)).toHaveLength(2); expect(html.match(/name="sessionId"/g)).toHaveLength(2)
    expect(html).toContain(`value="${sessionId}"`); expect(html).toContain('aria-label="Team"'); expect(html).toContain('aria-label="Channel"')
  })
  it('refuses a mismatched displayed workspace without calling Graph', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...params, workspaceId: 'foreign' }) }))
    expect(html).toContain('role="alert"'); expect(html).toContain('no longer matches'); expect(mocks.access).not.toHaveBeenCalled()
  })
  it.each(['fr', 'en'])('renders provider errors as an actionable localized page: %s', async (locale) => {
    mocks.context.mockResolvedValue({ workspace: { id: workspaceId, locale }, session: { userId: 'actor' }, entitlements: entitlementContext('active', 'agency') })
    mocks.teams.mockRejectedValue(new Error('private-provider-token'))
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }))
    expect(html).toContain('role="alert"'); expect(html).toContain(locale === 'en' ? 'Back to Settings' : 'Retour aux paramètres'); expect(html).not.toContain('private-provider-token')
  })
})
