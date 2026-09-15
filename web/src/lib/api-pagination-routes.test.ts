import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/api-v1', async (original) => ({ ...await original<typeof import('./api-v1')>(), authenticateApiRequest: mocks.authenticate }))
vi.mock('@/lib/api-v1-repository', () => ({ listApiAlerts: mocks.list, listApiApprovals: mocks.list, listApiReports: mocks.list }))
import { ApiV1Error } from './api-v1'
import { GET as alerts } from '../app/api/v1/alerts/route'
import { GET as approvals } from '../app/api/v1/approvals/route'
import { GET as reports } from '../app/api/v1/reports/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticate.mockResolvedValue({ workspace: { id: 'workspace' }, key: { id: 'key' } })
  mocks.list.mockResolvedValue({ data: [{ id: 'record' }], nextCursor: 'next-opaque-cursor' })
})

describe.each([['alerts', alerts], ['approvals', approvals], ['reports', reports]] as const)('%s pagination HTTP contract', (kind, route) => {
  it('passes an opaque cursor unchanged and retains the response envelope', async () => {
    const cursor = 'x'.repeat(700)
    const response = await route(new Request(`https://ads.yodev.fr/api/v1/${kind}?cursor=${cursor}&limit=37`))
    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', actorId: 'api-key:key', cursor, limit: 37 }))
    expect(await response.json()).toEqual({ data: [{ id: 'record' }], meta: { requestId: expect.any(String), nextCursor: 'next-opaque-cursor' } })
  })
  it.each(['limit=0', 'limit=101', 'limit=invalid', `cursor=${'x'.repeat(2049)}`])('rejects invalid parameters with 400: %s', async (query) => {
    const response = await route(new Request(`https://ads.yodev.fr/api/v1/${kind}?${query}`))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_INPUT')
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('preserves authentication and cursor rejection errors', async () => {
    mocks.authenticate.mockRejectedValueOnce(new ApiV1Error('INSUFFICIENT_SCOPE', 'Insufficient scope', 403))
    expect((await route(new Request(`https://ads.yodev.fr/api/v1/${kind}`))).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
    mocks.list.mockRejectedValueOnce(new ApiV1Error('INVALID_CURSOR', 'Invalid cursor', 400))
    const response = await route(new Request(`https://ads.yodev.fr/api/v1/${kind}?cursor=forged`))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_CURSOR')
  })
})
