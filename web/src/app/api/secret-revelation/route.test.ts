import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), consume: vi.fn(), get: vi.fn(), remove: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.get, delete: mocks.remove }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.workspace }))
vi.mock('@/lib/data', () => ({ consumeWorkspaceSecretRevelation: mocks.consume }))
vi.mock('@/lib/crypto', () => ({ decryptSecret: (value: string) => value }))
import { POST } from './route'
const workspaceId = '00000000-0000-4000-8000-000000000001', revelationId = '00000000-0000-4000-8000-000000000002'
const input = { workspaceId, revelationId, kind: 'api_key' }
const request = (body: unknown = input) => new Request('https://ads.example.test/api/secret-revelation', { method: 'POST', body: JSON.stringify(body) })
describe('secret revelation endpoint', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.workspace.mockResolvedValue({ workspace: { id: workspaceId }, session: { userId: 'owner' } }); mocks.get.mockReturnValue({ value: revelationId }); mocks.consume.mockResolvedValue({ encryptedSecret: 'fixture-only' }) })
  it('reveals only the displayed cookie-bound context, once, without cache', async () => {
    const response = await POST(request()); expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).data.secret).toBe('fixture-only')
    expect(mocks.consume).toHaveBeenCalledWith(workspaceId, 'owner', revelationId, 'api_key'); expect(mocks.remove).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })
  it.each([{}, { ...input, workspaceId: revelationId }, { ...input, revelationId: workspaceId }, { ...input, kind: 'unknown' }])('does not consume a mismatched or malformed form', async (body) => {
    expect((await POST(request(body))).status).toBe(404); expect(mocks.consume).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('does not leak backend details or clear a newer cookie after a denial', async () => {
    mocks.consume.mockRejectedValue(new Error('sensitive backend detail')); const response = await POST(request())
    expect(response.status).toBe(404); expect(await response.text()).not.toContain('sensitive'); expect(mocks.remove).not.toHaveBeenCalled()
  })
})
