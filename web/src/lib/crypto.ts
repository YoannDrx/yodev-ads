import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

type Envelope = {
  v: 1
  iv: string
  tag: string
  data: string
}

function encryptionKey() {
  const encoded = process.env.APP_ENCRYPTION_KEY
  if (!encoded) throw new Error('APP_ENCRYPTION_KEY is not configured')
  const key = Buffer.from(encoded, 'base64url')
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must contain exactly 32 bytes')
  return key
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const envelope: Envelope = {
    v: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url'),
  }
  return Buffer.from(JSON.stringify(envelope)).toString('base64url')
}

export function decryptSecret(encodedEnvelope: string): string {
  const envelope = JSON.parse(Buffer.from(encodedEnvelope, 'base64url').toString('utf8')) as Envelope
  if (envelope.v !== 1) throw new Error('Unsupported secret envelope version')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
