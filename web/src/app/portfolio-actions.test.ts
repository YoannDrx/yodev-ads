import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ permission: vi.fn(), save: vi.fn(), remove: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`) }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.permission }))
vi.mock('@/lib/portfolio-views', () => ({ savePortfolioView: mocks.save, deletePortfolioView: mocks.remove }))
import { removePortfolioView, storePortfolioView } from './portfolio-actions'
function form(overrides: Record<string, string> = {}) { const result = new FormData(); for (const [key,value] of Object.entries({ name: 'Review', criteria: JSON.stringify({ q: 'Client', currency: 'USD', attention: 'all', assignee: '' }), ...overrides })) result.set(key,value); return result }
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ workspace: { id: 'workspace' }, session: { userId: 'actor' } }); mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`) }) })
describe('portfolio view actions', () => {
  it('uses authenticated scope and returns to the saved filters', async () => {
    await expect(storePortfolioView(form({ workspaceId: 'foreign', actorUserId: 'foreign' }))).rejects.toThrow('redirect:/portfolio?q=Client&currency=USD&view_notice=saved')
    expect(mocks.permission).toHaveBeenCalledWith('portfolio:save_view')
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', actorUserId: 'actor', name: 'Review' }))
  })
  it('denies direct writes before input processing when the role or lifecycle changed', async () => {
    mocks.permission.mockRejectedValue(new Error('denied'))
    await expect(storePortfolioView(form())).rejects.toThrow('denied')
    await expect(removePortfolioView(form())).rejects.toThrow('denied')
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('does not save malformed criteria or a missing name', async () => {
    await expect(storePortfolioView(form({ criteria: 'null' }))).rejects.toThrow('view_notice=unavailable')
    const missing = form(); missing.delete('name')
    await expect(storePortfolioView(missing)).rejects.toThrow('view_notice=unavailable')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it.each([['Portfolio view conflict','conflict'],['Portfolio view quota','quota'],['Private server detail','unavailable']])('exposes a safe result for %s', async (message,outcome) => {
    mocks.save.mockRejectedValue(new Error(message))
    await expect(storePortfolioView(form({ id: 'view', version: 'version' }))).rejects.toThrow(`view_notice=${outcome}`)
  })
  it('deletes with authenticated scope and hides internal errors', async () => {
    await expect(removePortfolioView(form({ id: 'view', version: 'version' }))).rejects.toThrow('redirect:/portfolio?view_notice=deleted')
    expect(mocks.remove).toHaveBeenCalledWith({ workspaceId: 'workspace', actorUserId: 'actor', id: 'view', version: 'version' })
    mocks.remove.mockRejectedValue(new Error('Portfolio view conflict'))
    await expect(removePortfolioView(form())).rejects.toThrow('view_notice=conflict')
  })
})
