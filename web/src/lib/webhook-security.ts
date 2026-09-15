import 'server-only'

import { workSignal } from '@/lib/work-deadline'

import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

const MAXIMUM_WEBHOOK_RESPONSE_BYTES = 64 * 1024

// Conservative public-unicast policy; special-purpose/tunnel ranges are not webhook targets.
// BlockList compares binary addresses, including expanded and hexadecimal IPv6 forms.
const reservedV4 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) reservedV4.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const reservedV6 = new BlockList()
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  reservedV6.addSubnet(address, prefix, 'ipv6')
}

export function isPrivateOrReservedIp(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(normalized)
  if (version === 4) return reservedV4.check(normalized, 'ipv4')
  if (version !== 6 || normalized.includes('%')) return true
  // Reject mapped IPv4 and NAT64 as well: their embedded destination may be private.
  return !globalV6.check(normalized, 'ipv6') || reservedV6.check(normalized, 'ipv6')
}

export async function withinSignal<T>(operation: Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted()
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export async function assertSafeWebhookUrl(destination: string, signal = workSignal(8_000)) {
  signal.throwIfAborted()
  const url = new URL(destination)
  if (url.protocol !== 'https:') throw new Error('Les webhooks doivent utiliser HTTPS.')
  if (url.username || url.password) throw new Error('Les identifiants intégrés à une URL sont interdits.')
  if (url.port && url.port !== '443') throw new Error('Seul le port HTTPS 443 est autorisé.')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    hostname === 'localhost' ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Cette destination webhook est interdite.')
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await withinSignal(lookup(hostname, { all: true, verbatim: true }), signal)
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
    throw new Error('La destination webhook doit résoudre uniquement vers des adresses IP publiques.')
  }
  return { url, addresses: addresses.map(({ address }) => address) }
}

export function pinnedPublicLookup(addresses: string[]): LookupFunction {
  const records = addresses.map((address) => ({ address, family: isIP(address) as 4 | 6 }))
  if (records.length === 0 || records.some((record) => !record.family || isPrivateOrReservedIp(record.address))) {
    throw new Error('Aucune adresse IP publique validée ne peut être épinglée.')
  }
  return (_hostname, options, callback) => {
    if (options.all) callback(null, records)
    else callback(null, records[0].address, records[0].family)
  }
}

export async function postSafeWebhook(
  destination: string,
  payload: Record<string, unknown>,
  options: { timeoutMs?: number; maximumResponseBytes?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 8_000
  const maximumResponseBytes = options.maximumResponseBytes ?? MAXIMUM_WEBHOOK_RESPONSE_BYTES
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maximumResponseBytes) || maximumResponseBytes <= 0) {
    throw new Error('La configuration du transport webhook est invalide.')
  }
  // One budget covers DNS, connection establishment and the complete response body.
  const signal = workSignal(timeoutMs)
  const validated = await assertSafeWebhookUrl(destination, signal)
  const body = JSON.stringify(payload)
  signal.throwIfAborted()
  return new Promise<{ statusCode: number }>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, statusCode?: number) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve({ statusCode: statusCode! })
    }
    const request = httpsRequest(validated.url, {
      method: 'POST',
      agent: false, rejectUnauthorized: true,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      lookup: pinnedPublicLookup(validated.addresses),
      servername: validated.url.hostname,
      timeout: timeoutMs,
      signal,
      // Native https.request never follows redirects.
    }, (response) => {
      let responseBytes = 0
      response.on('data', (chunk: Buffer | string) => {
        responseBytes += Buffer.byteLength(chunk)
        if (responseBytes > maximumResponseBytes) {
          response.destroy()
          finish(new Error('Webhook response exceeded the maximum size'))
        }
      })
      response.on('error', (error) => finish(error))
      response.on('end', () => {
        const statusCode = response.statusCode ?? 0
        if (statusCode < 200 || statusCode >= 300) finish(new Error(`Webhook HTTP ${statusCode}`))
        else finish(undefined, statusCode)
      })
    })
    request.on('timeout', () => request.destroy(new Error('Webhook timeout')))
    request.on('error', (error) => finish(error))
    request.end(body)
  })
}
