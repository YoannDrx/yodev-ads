import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ permission: vi.fn(), save: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`) }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.permission }))
vi.mock('@/lib/account-selection', () => ({ saveManagedAccountSelection: mocks.save }))
import { updateManagedAccounts } from './account-selection-actions'
const clientId = '75000000-0000-4000-8000-000000000001'
function form(overrides: Record<string, string> = {}) {
  const result = new FormData()
  for (const [key, value] of Object.entries({ workspaceId: 'workspace', clientIds: JSON.stringify([clientId]), version: 'a'.repeat(64), mode: 'selection', ...overrides })) result.set(key, value)
  return result
}
describe('Account selection server action', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockReset(); mocks.permission.mockReset(); mocks.permission.mockResolvedValue({ workspace: { id: 'workspace' }, session: { userId: 'owner' } }) })
  it('uses authenticated scope and preserves the requested priority-only mode', async () => {
    await expect(updateManagedAccounts(form({ mode: 'priorities' }))).rejects.toThrow('redirect:/accounts?selection=saved')
    expect(mocks.permission).toHaveBeenCalledWith('google:connect')
    expect(mocks.save).toHaveBeenCalledWith({ workspaceId: 'workspace', actorUserId: 'owner', clientIds: [clientId], version: 'a'.repeat(64), priorityOnly: true })
    expect(mocks.revalidate).toHaveBeenCalledWith('/dashboard', 'layout')
  })
  it('rejects an old form after switching the active workspace', async () => {
    await expect(updateManagedAccounts(form({ workspaceId: 'foreign' }))).rejects.toThrow('redirect:/accounts?selection=workspace_changed')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('never writes when the role or lifecycle denies permission', async () => {
    mocks.permission.mockRejectedValue(new Error('denied'))
    await expect(updateManagedAccounts(form())).rejects.toThrow('redirect:/accounts?selection=unavailable')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it.each<Record<string, string>>([{ clientIds: 'invalid JSON' }, { clientIds: '["foreign"]' }, { version: 'invalid' }, { mode: 'bypass' }])('rejects malformed input %j', async (invalid) => {
    await expect(updateManagedAccounts(form(invalid))).rejects.toThrow('redirect:/accounts?selection=unavailable')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('reports concurrent modification explicitly', async () => {
    mocks.save.mockRejectedValue(new Error('Account selection changed. Reload before saving.'))
    await expect(updateManagedAccounts(form())).rejects.toThrow('redirect:/accounts?selection=conflict')
  })
  it('keeps internal failure details out of the redirect', async () => {
    mocks.save.mockRejectedValue(new Error('private provider detail'))
    await expect(updateManagedAccounts(form())).rejects.toThrow('redirect:/accounts?selection=unavailable')
  })
})
