import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  downloadable: vi.fn(),
  getBlob: vi.fn(),
}))

vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.requirePermission }))
vi.mock('@/lib/data', () => ({ getDownloadableWorkspaceExport: mocks.downloadable }))
vi.mock('@vercel/blob', () => ({ get: mocks.getBlob }))

import { GET } from './[exportId]/route'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const userId = '00000000-0000-4000-8000-000000000002'
const exportId = '00000000-0000-4000-8000-000000000003'

function request() {
  return GET(new Request(`https://ads.example.test/api/exports/${exportId}`), {
    params: Promise.resolve({ exportId }),
  })
}

describe('workspace export route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePermission.mockResolvedValue({ workspace: { id: workspaceId }, session: { userId } })
    mocks.downloadable.mockResolvedValue(null)
  })

  it('returns a non-enumerating 403 when the role lacks export permission', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission required: workspace:export'))
    const response = await request()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mocks.downloadable).not.toHaveBeenCalled()
  })

  it('scopes artifact lookup to the authenticated workspace and actor', async () => {
    const response = await request()
    expect(response.status).toBe(404)
    expect(mocks.downloadable).toHaveBeenCalledWith(workspaceId, userId, exportId)
    expect(mocks.getBlob).not.toHaveBeenCalled()
  })

  it('never serves a missing private blob even when the database artifact exists', async () => {
    mocks.downloadable.mockResolvedValueOnce({ artifactKey: 'exports/private.zip', artifactHash: 'abc' })
    mocks.getBlob.mockResolvedValueOnce(null)
    const response = await request()
    expect(response.status).toBe(404)
    expect(mocks.getBlob).toHaveBeenCalledWith('exports/private.zip', { access: 'private', useCache: false })
  })
})
