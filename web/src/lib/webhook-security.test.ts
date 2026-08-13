import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('node:https', () => ({ request: mocks.request }))

import { assertSafeWebhookUrl, isPrivateOrReservedIp, pinnedPublicLookup, postSafeWebhook } from './webhook-security'

describe('isPrivateOrReservedIp', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    '127.0.0.1',
    '10.10.0.2',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '0.1.2.3',
    '192.0.2.1',
    '198.18.0.1',
    '198.19.255.255',
    '300.1.1.1',
    'not-an-ip',
    '::',
  ])('rejects private or special address %s', (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(false)
  })

  it('accepts only HTTPS 443 destinations without embedded credentials', async () => {
    for (const [url, message] of [
      ['http://hooks.example.test/path', 'HTTPS'],
      ['https://user:pass@hooks.example.test/path', 'identifiants'],
      ['https://hooks.example.test:8443/path', 'port'],
    ]) await expect(assertSafeWebhookUrl(url)).rejects.toThrow(message)

    for (const hostname of ['localhost', 'metadata.google.internal', 'api.localhost', 'api.local', 'api.internal']) {
      await expect(assertSafeWebhookUrl(`https://${hostname}/hook`)).rejects.toThrow('interdite')
    }
  })

  it('rejects empty/private DNS answers and accepts public DNS and literal IPs', async () => {
    mocks.lookup.mockResolvedValueOnce([])
    await expect(assertSafeWebhookUrl('https://empty.example.test/hook')).rejects.toThrow('IP publiques')
    mocks.lookup.mockResolvedValueOnce([{ address: '203.0.113.10' }, { address: '10.0.0.1' }])
    await expect(assertSafeWebhookUrl('https://mixed.example.test/hook')).rejects.toThrow('IP publiques')
    mocks.lookup.mockResolvedValueOnce([{ address: '8.8.8.8' }, { address: '2606:4700:4700::1111' }])
    await expect(assertSafeWebhookUrl('https://hooks.example.test./hook')).resolves.toMatchObject({
      addresses: ['8.8.8.8', '2606:4700:4700::1111'],
    })
    await expect(assertSafeWebhookUrl('https://1.1.1.1/hook')).resolves.toMatchObject({ addresses: ['1.1.1.1'] })
  })

  it('pins the HTTPS socket to the validated public address to defeat DNS rebinding', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }])
    let requestOptions: Record<string, unknown> | undefined
    mocks.request.mockImplementation((_url, options, callback) => {
      requestOptions = options
      const request = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: (error: Error) => void }
      request.destroy = (error) => request.emit('error', error)
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; destroy: () => void }
        response.statusCode = 204
        response.destroy = vi.fn()
        callback(response)
        queueMicrotask(() => response.emit('end'))
      }
      return request
    })
    await expect(postSafeWebhook('https://hooks.example.test/path', { ok: true })).resolves.toEqual({ statusCode: 204 })
    const pinned = requestOptions?.lookup as ReturnType<typeof pinnedPublicLookup>
    const result = await new Promise<{ address: string | object[]; family?: number }>((resolve, reject) => {
      pinned('hooks.example.test', { all: false }, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address, family })
      })
    })
    expect(result).toEqual({ address: '8.8.8.8', family: 4 })
    expect(requestOptions).toMatchObject({ servername: 'hooks.example.test', timeout: 8_000 })
    expect(mocks.lookup).toHaveBeenCalledOnce()
  })

  it('rejects invalid pin sets, oversized responses and non-success statuses', async () => {
    expect(() => pinnedPublicLookup([])).toThrow('publique')
    expect(() => pinnedPublicLookup(['127.0.0.1'])).toThrow('publique')
    mocks.lookup.mockResolvedValue([{ address: '1.1.1.1' }])
    mocks.request.mockImplementation((_url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void }
      request.destroy = (error) => request.emit('error', error)
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; destroy: () => void }
        response.statusCode = 200
        response.destroy = vi.fn()
        callback(response)
        queueMicrotask(() => {
          response.emit('data', Buffer.alloc(5))
          response.emit('end')
        })
      }
      return request
    })
    await expect(postSafeWebhook('https://hooks.example.test/path', {}, { maximumResponseBytes: 4 }))
      .rejects.toThrow('maximum size')

    mocks.request.mockImplementation((_url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void }
      request.destroy = (error) => request.emit('error', error)
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; destroy: () => void }
        response.statusCode = 307
        response.destroy = vi.fn()
        callback(response)
        queueMicrotask(() => response.emit('end'))
      }
      return request
    })
    await expect(postSafeWebhook('https://hooks.example.test/path', {})).rejects.toThrow('Webhook HTTP 307')
    await expect(postSafeWebhook('https://hooks.example.test/path', {}, { timeoutMs: 0 })).rejects.toThrow('configuration')
  })
})
