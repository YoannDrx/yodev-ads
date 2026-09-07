import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), cookie: vi.fn(), set: vi.fn(), state: vi.fn(), access: vi.fn(), resolve: vi.fn(), complete: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`) }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie, set: mocks.set }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.context }))
vi.mock('@/lib/feature-flags', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/oauth-state', () => ({ openOAuthState: mocks.state }))
vi.mock('@/lib/notification-oauth-management', () => ({ accessTeamsOAuthSession: mocks.access, completeTeamsOAuthSession: mocks.complete }))
vi.mock('@/lib/teams-oauth', () => ({ resolveTeamsDestination: mocks.resolve }))
import { completeTeamsNotificationConnection } from './teams-connection-actions'
import { entitlementContext } from '@/lib/entitlements'
const workspaceId = '00000000-0000-4000-8000-000000000001', sessionId = '00000000-0000-4000-8000-000000000002'
function form(overrides: Record<string, string> = {}) { const data = new FormData(); for (const [k, v] of Object.entries({ workspaceId, sessionId, teamId: 'team-fixture', channelId: 'channel-fixture', ...overrides })) data.set(k, v); return data }
describe('Teams displayed selection binding', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`) })
    mocks.context.mockResolvedValue({ workspace: { id: workspaceId, locale: 'en' }, session: { userId: 'actor' }, entitlements: entitlementContext('active', 'agency') })
    mocks.cookie.mockReturnValue({ value: 'signed-cookie' }); mocks.state.mockReturnValue({ workspaceId, userId: 'actor', payload: { sessionId } })
    mocks.access.mockResolvedValue({ accessToken: 'fixture-access' }); mocks.resolve.mockResolvedValue({ teamId: 'team-fixture', channelId: 'channel-fixture', teamName: 'Verified team', channelName: 'Verified channel' })
  })
  it('uses the displayed session and provider-verified destination without clearing another cookie', async () => {
    await expect(completeTeamsNotificationConnection(form())).rejects.toThrow('Microsoft+Teams+is+connected')
    expect(mocks.cookie).toHaveBeenCalledWith(`yodev_ads_teams_session_${sessionId}`)
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorUserId: 'actor', sessionId, teamName: 'Verified team' }))
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it.each<Record<string, string>>([{ workspaceId: '00000000-0000-4000-8000-000000000003' }, { sessionId: '00000000-0000-4000-8000-000000000004' }, { sessionId: '' }])('rejects an old or malformed form before provider access: %j', async (invalid) => {
    await expect(completeTeamsNotificationConnection(form(invalid))).rejects.toThrow('/settings?error=')
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled()
  })
  it('rejects a cookie owned by another actor', async () => {
    mocks.state.mockReturnValue({ workspaceId, userId: 'other', payload: { sessionId } })
    await expect(completeTeamsNotificationConnection(form())).rejects.toThrow('/settings?error='); expect(mocks.access).not.toHaveBeenCalled()
  })
  it('keeps private provider errors out of the localized redirect', async () => {
    mocks.resolve.mockRejectedValue(new Error('private provider failure fixture-token'))
    await expect(completeTeamsNotificationConnection(form())).rejects.toThrow('Teams+could+not+be')
    expect(mocks.redirect.mock.calls[0][0]).not.toContain('fixture-token'); expect(mocks.complete).not.toHaveBeenCalled()
  })
})
