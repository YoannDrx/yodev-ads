import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), recover: vi.fn() }))
vi.mock('@/lib/workspace', () => ({ currentAuthSession: mocks.session }))
vi.mock('@/lib/auth-invitations', () => ({ acceptedInvitationOrganization: mocks.recover }))
import { recoverAcceptedInvitation } from './actions'
beforeEach(() => vi.resetAllMocks())
it('does not reveal invitation state without a session or with malformed transport input', async () => {
  expect(await recoverAcceptedInvitation(null as unknown as string)).toBeNull()
  mocks.session.mockResolvedValue(null)
  expect(await recoverAcceptedInvitation('invitation')).toBeNull()
  expect(mocks.recover).not.toHaveBeenCalled()
})
it('derives identity and verification exclusively from the authenticated session', async () => {
  mocks.session.mockResolvedValue({ userId: 'actual-user', user: { email: 'actual@example.test', emailVerified: true } })
  mocks.recover.mockResolvedValue('acquired-organization')
  expect(await recoverAcceptedInvitation('invitation')).toBe('acquired-organization')
  expect(mocks.recover).toHaveBeenCalledWith({ invitationId: 'invitation', userId: 'actual-user', email: 'actual@example.test', emailVerified: true })
})
