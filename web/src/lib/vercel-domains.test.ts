import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addOrVerifyVercelProjectDomain,
  domainDnsRecord,
  domainReachesApplication,
  getVercelProjectDomain,
  normalizeCustomHostname,
  removeVercelProjectDomain,
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
    for (const value of ['https://example.com', '*.example.com', '127.0.0.1', 'service.local', 'ads.yodev.fr', 'tenant.vercel.app']) {
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'reports.example.com', verified: true }), { status: 200 }))
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

  it('loads and removes only the requested project domain', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'reports.example.com', verified: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'reports.example.com' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getVercelProjectDomain('reports.example.com')).resolves.toMatchObject({ verified: true })
    await expect(removeVercelProjectDomain('reports.example.com')).resolves.toMatchObject({ name: 'reports.example.com' })
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('DELETE')
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
