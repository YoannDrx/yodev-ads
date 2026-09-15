import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('node:https', () => ({ request: mocks.request }))
import { probeApplicationDomain } from './domain-probe'
import { answerDomainProbeChallenge, createDomainProbeChallenge, DOMAIN_PROBE_HEADER } from './domain-probe-proof'
import { GET } from '@/app/api/domain-probe/route'
import { encryptSecret } from './crypto'
import { withWorkDeadline } from './work-deadline'

const hostname = 'reports.example.com'
const responseOptions = { status: 200, type: 'application/json', body: 'valid' }
let options: typeof responseOptions
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64url'))
  vi.stubEnv('APP_ENCRYPTION_CURRENT_KID', '')
  vi.stubEnv('APP_ENCRYPTION_KEYS', '')
  vi.stubEnv('CUSTOM_DOMAINS_ENABLED', '1')
  vi.stubEnv('MAINTENANCE_MODE', '0')
  options = { ...responseOptions }
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }])
  mocks.request.mockImplementation((url, init, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
    request.destroy = vi.fn()
    request.end = () => {
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: object; destroy: () => void }
      Object.assign(response, { statusCode: options.status, headers: { 'content-type': options.type }, destroy: vi.fn() })
      callback(response)
      queueMicrotask(() => {
        const body = options.body === 'valid' ? JSON.stringify({ proof: answerDomainProbeChallenge(init.headers[DOMAIN_PROBE_HEADER], url.hostname) }) : options.body
        response.emit('data', Buffer.from(body)); response.emit('end')
      })
    }
    return request
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('application domain proof', () => {
  it('answers only the encrypted fresh hostname-specific challenge, with independent nonces', async () => {
    const first = createDomainProbeChallenge(hostname), second = createDomainProbeChallenge(hostname)
    expect(first.expectedProof).not.toBe(second.expectedProof)
    expect(first.challenge).not.toContain(first.expectedProof)
    expect(answerDomainProbeChallenge(first.challenge, hostname)).toBe(first.expectedProof)
    expect(() => answerDomainProbeChallenge(first.challenge, 'other.example.com')).toThrow()
    const response = await GET(new Request(`https://${hostname}/api/domain-probe`, { headers: { [DOMAIN_PROBE_HEADER]: first.challenge } }))
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ proof: first.expectedProof })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it.each(['expired', 'future', 'wrong-purpose', 'tampered', 'oversized', 'missing-key', 'other-environment'])('refuses %s proof', (kind) => {
    let challenge = createDomainProbeChallenge(hostname, Date.now() + (kind === 'expired' ? -60_000 : kind === 'future' ? 60_000 : 0)).challenge
    if (kind === 'wrong-purpose') challenge = encryptSecret(JSON.stringify({ purpose: 'other' }))
    if (kind === 'tampered') challenge = `${challenge.slice(0, -10)}aaaaaaaaaa`
    if (kind === 'oversized') challenge = 'a'.repeat(2049)
    if (kind === 'missing-key') vi.stubEnv('APP_ENCRYPTION_KEY', '')
    if (kind === 'other-environment') vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://other.example.com')
    expect(() => answerDomainProbeChallenge(challenge, hostname)).toThrow()
  })

  it.each(['missing', 'foreign-host', 'forwarded-host', 'http', 'port', 'disabled', 'maintenance'])('endpoint refuses %s without private details', async (kind) => {
    const { challenge } = createDomainProbeChallenge(hostname)
    const headers: Record<string, string> = kind === 'missing' ? {} : { [DOMAIN_PROBE_HEADER]: challenge }
    if (kind === 'forwarded-host') headers['x-forwarded-host'] = hostname
    if (kind === 'disabled') vi.stubEnv('CUSTOM_DOMAINS_ENABLED', '0')
    if (kind === 'maintenance') vi.stubEnv('MAINTENANCE_MODE', '1')
    const origin = kind === 'http' ? `http://${hostname}` : kind === 'port' ? `https://${hostname}:8443` : ['foreign-host', 'forwarded-host'].includes(kind) ? 'https://other.example.com' : `https://${hostname}`
    const response = await GET(new Request(`${origin}/api/domain-probe`, { headers }))
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Domain verification unavailable.' })
  })

  it('pins the connection, keeps TLS hostname verification, disables socket reuse and sends no credentials', async () => {
    expect(await probeApplicationDomain(hostname)).toBe(true)
    const [url, init] = mocks.request.mock.calls[0]
    expect(url.href).toBe(`https://${hostname}/api/domain-probe`)
    expect(init).toMatchObject({ agent: false, servername: hostname, maxHeaderSize: 8192 })
    expect(init.rejectUnauthorized).toBe(true)
    expect(init.headers).not.toHaveProperty('Authorization'); expect(init.headers).not.toHaveProperty('Cookie')
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1' }])
    const callback = vi.fn(); init.lookup(hostname, { all: false }, callback)
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4)
    expect(mocks.lookup).toHaveBeenCalledOnce()
  })

  it.each(['127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2001:db8::1', '198.51.100.1'])('refuses DNS destination %s before connecting', async (address) => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }, { address }])
    expect(await probeApplicationDomain(hostname)).toBe(false); expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each(['other-site', 'replayed-proof', 'malformed', 'oversized', 'redirect', 'unhealthy', 'html'])('does not activate on %s response', async (kind) => {
    if (kind === 'other-site') options.body = '{"status":"ok"}'
    if (kind === 'replayed-proof') options.body = JSON.stringify({ proof: createDomainProbeChallenge(hostname).expectedProof })
    if (kind === 'malformed') options.body = '{'
    if (kind === 'oversized') options.body = 'a'.repeat(4097)
    if (kind === 'redirect') options.status = 302
    if (kind === 'unhealthy') options.status = 503
    if (kind === 'html') options.type = 'text/html'
    expect(await probeApplicationDomain(hostname)).toBe(false); expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('rechecks admission after DNS and before connecting', async () => {
    const admit = vi.fn().mockRejectedValue(new Error('Removed actor'))
    expect(await probeApplicationDomain(hostname, admit)).toBe(false)
    expect(admit).toHaveBeenCalledOnce(); expect(mocks.request).not.toHaveBeenCalled()
  })

  it('stops waiting for admission and never connects after late authorization', async () => {
    let release!: () => void
    const admit = () => new Promise<void>((resolve) => { release = resolve })
    expect(await withWorkDeadline(Date.now() + 25, () => probeApplicationDomain(hostname, admit))).toBe(false)
    release(); await Promise.resolve(); expect(mocks.request).not.toHaveBeenCalled()
  })

  it('stops stalled DNS at the shared deadline', async () => {
    mocks.lookup.mockReturnValue(new Promise(() => {}))
    expect(await withWorkDeadline(Date.now() + 25, () => probeApplicationDomain(hostname))).toBe(false)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('fails closed on certificate, socket and response interruption', async () => {
    for (const mode of ['certificate', 'aborted', 'error', 'timeout']) {
      mocks.request.mockImplementation((_url, _init, callback) => {
        const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
        request.destroy = vi.fn()
        request.end = () => queueMicrotask(() => {
          if (mode === 'certificate') request.emit('error', new Error('TLS certificate invalid'))
          else if (mode === 'timeout') request.emit('timeout')
          else {
            const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' } })
            callback(response); response.emit(mode, new Error('Connection lost'))
          }
        })
        return request
      })
      expect(await probeApplicationDomain(hostname)).toBe(false)
    }
  })
})
