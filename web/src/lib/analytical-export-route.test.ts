import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.auth }))
vi.mock('@/lib/analytical-pages', () => ({ getAnalyticalExport: mocks.read }))
import { GET } from '../app/(app)/insights/[family]/export/route'
const version = '79000000-0000-4000-8000-000000000003'
function request(family = 'devices') { return GET(new Request(`https://ads.yodev.fr/insights/${family}/export?client=client&version=${version}`), { params: Promise.resolve({ family }) }) }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ workspace: { id: 'workspace', locale: 'fr' } }) })
describe('analytical collection export HTTP contract', () => {
  it('downloads the complete JSON with exact source identity, no cache and integrity hash', async () => {
    const document = { version: 1, sourceVersion: version, records: Array.from({ length: 701 }, (_, index) => ({ label: index === 700 ? '=SUM(A1:A2)' : `Row ${index}` })) }
    mocks.read.mockResolvedValue({ changed: false, document })
    const response = await request(), body = await response.text()
    expect(response.status).toBe(200); expect(JSON.parse(body)).toEqual(document)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="yodev-devices-${version}.json"`)
    expect(response.headers.get('x-content-sha256')).toBe(createHash('sha256').update(body).digest('hex'))
    expect(mocks.auth).toHaveBeenCalledWith('portfolio:read')
    expect(mocks.read).toHaveBeenCalledWith('workspace', 'client', 'devices', version)
  })
  it('preserves forbidden, missing and refreshed-version distinctions', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('forbidden')); expect((await request()).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled()
    expect((await request('foreign-family')).status).toBe(404); expect(mocks.read).not.toHaveBeenCalled()
    mocks.read.mockResolvedValueOnce(null); expect((await request()).status).toBe(404)
    mocks.read.mockResolvedValue({ changed: true }); const changed = await request(); expect(changed.status).toBe(409); expect((await changed.json()).error).toContain('collecte a changé')
    mocks.auth.mockResolvedValue({ workspace: { id: 'workspace', locale: 'en' } }); expect((await (await request()).json()).error).toContain('collection changed')
  })
  it('rejects an oversized export without silently truncating it', async () => {
    mocks.read.mockResolvedValue({ changed: false, document: { sourceVersion: version, records: ['x'.repeat(4 * 1024 * 1024)] } })
    expect((await request()).status).toBe(413)
  })
})
