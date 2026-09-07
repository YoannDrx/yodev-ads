import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addOrVerifyVercelProjectDomain,
  domainDnsRecord,
  domainReachesApplication,
  getVercelProjectDomain,
  normalizeCustomHostname,
  removeVercelProjectDomain,
  VercelDomainApiError,
} from './vercel-domains'

describe('custom domain validation', () => {
  beforeEach(() => {
    process.env.VERCEL_API_TOKEN = 'test-token'
    process.env.VERCEL_PROJECT_ID = 'project_123'
    process.env.VERCEL_TEAM_ID = 'team_123'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.VERCEL_API_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    delete process.env.VERCEL_TEAM_ID
  })

  it('normalizes valid international and regular hostnames', () => {
    expect(normalizeCustomHostname('reports.example.com.')).toBe('reports.example.com')
    expect(normalizeCustomHostname('rapports.éxample.fr')).toBe('rapports.xn--xample-9ua.fr')
  })

  it('rejects URLs, wildcard, IP, internal and platform hostnames', () => {
    for (const value of ['https://example.com', '*.example.com', '127.0.0.1', 'service.local', 'ads.yodev.fr', 'tenant.vercel.app', 'user@example.com', '@example.com', 'reports.example.com?', 'reports.example.com#', 'reports.example.com?x=1', 'reports.example.com\\path', '-reports.example.com', 'reports-.example.com', 'reports..example.com', 'reports_bad.example.com', `${'a'.repeat(64)}.example.com`]) {
      expect(() => normalizeCustomHostname(value)).toThrow()
    }
  })

  it('creates an unambiguous DNS ownership challenge', () => {
    expect(domainDnsRecord('reports.example.com', 'secret')).toEqual({
      type: 'TXT',
      name: '_yodev-ads.reports.example.com',
      value: 'yodev-domain-verification=secret',
    })
  })

  it('adds a project domain and checks its Vercel configuration without redirects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'reports.example.com', projectId: 'project_123', verified: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ misconfigured: false, configuredBy: 'CNAME' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(addOrVerifyVercelProjectDomain('reports.example.com')).resolves.toMatchObject({
      name: 'reports.example.com',
      verified: true,
      configuration: { misconfigured: false },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(firstUrl.pathname).toBe('/v10/projects/project_123/domains')
    expect(firstUrl.searchParams.get('teamId')).toBe('team_123')
    expect(firstInit).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(firstInit.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('preserves the documented IPv4 groups and CNAME recommendations', async () => {
    const configuration = {
      misconfigured: false, configuredBy: 'A',
      recommendedIPv4: [{ rank: 1, value: ['192.0.2.1', '192.0.2.2'] }],
      recommendedCNAME: [{ rank: 1, value: 'cname.example.com' }],
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ name: 'reports.example.com', projectId: 'project_123', verified: true }))
      .mockResolvedValueOnce(Response.json(configuration)))
    await expect(addOrVerifyVercelProjectDomain('reports.example.com')).resolves.toMatchObject({ configuration })
  })

  it.each([
    { misconfigured: 'false' },
    { misconfigured: false, recommendedIPv4: [{ rank: 1, value: '192.0.2.1' }] },
    { misconfigured: false, recommendedCNAME: [{ rank: 1, value: ['cname.example.com'] }] },
  ])('refuses malformed DNS configuration: %j', async (configuration) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ name: 'reports.example.com', projectId: 'project_123', verified: true }))
      .mockResolvedValueOnce(Response.json(configuration)))
    await expect(addOrVerifyVercelProjectDomain('reports.example.com')).rejects.toThrow('ne permet pas de confirmer')
  })

  it('checks admission before the first provider request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    await expect(addOrVerifyVercelProjectDomain('reports.example.com', false, async () => { throw new Error('Access revoked') })).rejects.toThrow('Access revoked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks admission again after the domain was attached and before reading configuration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ name: 'reports.example.com', projectId: 'project_123', verified: true }))
    const admit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Access revoked'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(addOrVerifyVercelProjectDomain('reports.example.com', false, admit)).rejects.toThrow('Access revoked')
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(admit).toHaveBeenCalledTimes(2)
  })

  it('does not submit ownership verification after authorization is lost during the existing-domain lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: 'already exists' } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ name: 'reports.example.com', projectId: 'project_123', verified: false }))
    const admit = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Access revoked'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(addOrVerifyVercelProjectDomain('reports.example.com', true, admit)).rejects.toThrow('Access revoked')
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(admit).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('method', 'POST')
  })

  it('loads and removes only the requested project domain', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'reports.example.com', projectId: 'project_123', verified: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'reports.example.com' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getVercelProjectDomain('reports.example.com')).resolves.toMatchObject({ verified: true })
    await expect(removeVercelProjectDomain('reports.example.com')).resolves.toMatchObject({ name: 'reports.example.com' })
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('DELETE')
  })

  it.each([400, 409])('reconciles HTTP %i only with a matching domain in the configured project', async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'conflict', message: 'Any provider language' } }, { status }))
      .mockResolvedValueOnce(Response.json({ name: 'reports.example.com', projectId: 'project_123', verified: true }))
      .mockResolvedValueOnce(Response.json({ misconfigured: false }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(addOrVerifyVercelProjectDomain('reports.example.com')).resolves.toMatchObject({ verified: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([401, 403, 404, 429, 500])('does not infer existence from misleading HTTP %i text', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { code: 'forbidden', message: 'already exists private-token' } }, { status }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await addOrVerifyVercelProjectDomain('reports.example.com').catch((error) => error)
    expect(result).toBeInstanceOf(VercelDomainApiError); expect(result.status).toBe(status)
    expect(result.message).not.toContain('private-token'); expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: 'other.example.com', projectId: 'project_123', verified: true },
    { name: 'reports.example.com', projectId: 'other-project', verified: true },
    { name: 'reports.example.com', verified: true },
    { name: 'reports.example.com', projectId: 'project_123', verified: 'true' },
  ])('refuses a mismatched or malformed domain response: %j', async (body) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body)); vi.stubGlobal('fetch', fetchMock)
    await expect(addOrVerifyVercelProjectDomain('reports.example.com')).rejects.toThrow('ne permet pas de confirmer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('confirms domain absence after 404 only with a reachable matching project and a second absence read', async () => {
    const missing = () => Response.json({ error: { code: 'not_found', message: 'No resource' } }, { status: 404 })
    const fetchMock = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json({ id: 'project_123' })).mockResolvedValueOnce(missing())
    vi.stubGlobal('fetch', fetchMock)
    await expect(removeVercelProjectDomain('reports.example.com')).resolves.toMatchObject({ removed: true, alreadyAbsent: true })
    expect(fetchMock.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, (init as RequestInit).method ?? 'GET'])).toEqual([
      ['/v9/projects/project_123/domains/reports.example.com', 'DELETE'], ['/v9/projects/project_123', 'GET'], ['/v9/projects/project_123/domains/reports.example.com', 'GET'],
    ])
  })

  it.each([401, 403, 404, 429, 500])('does not confirm removal when the project lookup returns %i', async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'not_found' } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'not_found', message: '404 not found private-secret' } }, { status }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(removeVercelProjectDomain('reports.example.com')).rejects.toMatchObject({ status })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses to confirm removal if the domain still exists after DELETE returned 404', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'not_found' } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ id: 'project_123' })).mockResolvedValueOnce(Response.json({ name: 'reports.example.com' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(removeVercelProjectDomain('reports.example.com')).rejects.toThrow('ne permet pas de confirmer')
  })

  it.each([0, 1, 2])('rechecks removal admission before request %i, including absence lookups', async (stage) => {
    const missing = () => Response.json({ error: { code: 'not_found' } }, { status: 404 })
    const fetchMock = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json({ id: 'project_123' })).mockResolvedValueOnce(missing())
    const admit = vi.fn(async () => { if (admit.mock.calls.length > stage) throw new Error('Cleanup lease lost') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(removeVercelProjectDomain('reports.example.com', admit)).rejects.toThrow('Cleanup lease lost')
    expect(fetchMock).toHaveBeenCalledTimes(stage)
  })

  it.each([Response.json({ error: { message: '404 not found' } }), new Response('private malformed provider body')])('does not accept a malformed successful response as deletion confirmation', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(removeVercelProjectDomain('reports.example.com')).rejects.toThrow('ne permet pas de confirmer')
  })

  it('keeps network failures unconfirmed and private details out of errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private transport URL and credential')))
    await expect(removeVercelProjectDomain('reports.example.com')).rejects.toThrow('ne permet pas de confirmer')
  })

  it('fails closed when the domain probe errors or is not healthy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('certificate pending'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(domainReachesApplication('reports.example.com')).resolves.toBe(false)
    await expect(domainReachesApplication('reports.example.com')).resolves.toBe(false)
  })

  it('refuses provider calls without explicit Vercel credentials', async () => {
    delete process.env.VERCEL_API_TOKEN
    await expect(getVercelProjectDomain('reports.example.com')).rejects.toThrow('VERCEL_API_TOKEN')
  })
})
