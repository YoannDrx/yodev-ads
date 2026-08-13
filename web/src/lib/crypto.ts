import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

type LegacyEnvelope = {
  v: 1
  iv: string
  tag: string
  data: string
}

type VersionedEnvelope = {
  v: 2
  kid: string
  iv: string
  tag: string
  data: string
}

type Envelope = LegacyEnvelope | VersionedEnvelope

function parseEnvelope(encodedEnvelope: string): Envelope {
  const envelope = JSON.parse(Buffer.from(encodedEnvelope, 'base64url').toString('utf8')) as Envelope
  if (envelope.v !== 1 && envelope.v !== 2) throw new Error('Unsupported secret envelope version')
  return envelope
}

function decodeKey(encoded: string | undefined, label: string) {
  if (!encoded) throw new Error('APP_ENCRYPTION_KEY is not configured')
  const key = Buffer.from(encoded, 'base64url')
  if (key.length !== 32) throw new Error(`${label} must contain exactly 32 bytes`)
  return key
}

function legacyEncryptionKey() {
  return decodeKey(process.env.APP_ENCRYPTION_KEY, 'APP_ENCRYPTION_KEY')
}

function versionedKeys() {
  const encoded = process.env.APP_ENCRYPTION_KEYS
  if (!encoded) return new Map<string, Buffer>()
  const values = JSON.parse(encoded) as Record<string, string>
  return new Map(Object.entries(values).map(([kid, key]) => [kid, decodeKey(key, `APP_ENCRYPTION_KEYS.${kid}`)]))
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12)
  const keys = versionedKeys()
  const kid = process.env.APP_ENCRYPTION_CURRENT_KID
  const key = kid ? keys.get(kid) : undefined
  if (kid && !key) throw new Error(`Current encryption key ${kid} is unavailable`)
  const cipher = createCipheriv('aes-256-gcm', key ?? legacyEncryptionKey(), iv)
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const envelope: Envelope = kid ? {
    v: 2,
    kid,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url'),
  } : { v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') }
  return Buffer.from(JSON.stringify(envelope)).toString('base64url')
}

export function decryptSecret(encodedEnvelope: string): string {
  const envelope = parseEnvelope(encodedEnvelope)
  const key = envelope.v === 1 ? legacyEncryptionKey() : versionedKeys().get(envelope.kid)
  if (!key) throw new Error(`Encryption key ${envelope.v === 2 ? envelope.kid : 'legacy'} is unavailable`)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function currentEncryptionKeyId() {
  return process.env.APP_ENCRYPTION_CURRENT_KID?.trim() || null
}

export function secretEnvelopeKeyId(encodedEnvelope: string) {
  const envelope = parseEnvelope(encodedEnvelope)
  return envelope.v === 2 ? envelope.kid : null
}

export function rewrapSecret(encodedEnvelope: string) {
  const currentKid = currentEncryptionKeyId()
  if (!currentKid) throw new Error('APP_ENCRYPTION_CURRENT_KID is required for secret rotation')
  if (secretEnvelopeKeyId(encodedEnvelope) === currentKid) return encodedEnvelope
  return encryptSecret(decryptSecret(encodedEnvelope))
}
