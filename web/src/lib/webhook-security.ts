import 'server-only'

import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

const MAXIMUM_WEBHOOK_RESPONSE_BYTES = 64 * 1024

function privateIpv4(address: string) {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export function isPrivateOrReservedIp(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(normalized)
  if (version === 4) return privateIpv4(normalized)
  if (version !== 6) return true
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return privateIpv4(mappedIpv4)
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff')
  )
}

export async function assertSafeWebhookUrl(destination: string) {
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
    : await lookup(hostname, { all: true, verbatim: true })
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
  const validated = await assertSafeWebhookUrl(destination)
  const body = JSON.stringify(payload)
  const timeoutMs = options.timeoutMs ?? 8_000
  const maximumResponseBytes = options.maximumResponseBytes ?? MAXIMUM_WEBHOOK_RESPONSE_BYTES
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maximumResponseBytes) || maximumResponseBytes <= 0) {
    throw new Error('La configuration du transport webhook est invalide.')
  }
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
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      lookup: pinnedPublicLookup(validated.addresses),
      servername: validated.url.hostname,
      timeout: timeoutMs,
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
