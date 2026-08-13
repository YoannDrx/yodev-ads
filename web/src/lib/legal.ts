import 'server-only'

import { createHmac } from 'node:crypto'

export const LEGAL_VERSIONS = {
  terms: '2026-08-12',
  privacy: '2026-08-12',
  dpa: '2026-08-12',
  cookies: '2026-08-12',
} as const

export function requireCommercialLegalReadiness(customerType: 'individual' | 'business') {
  if (process.env.LEGAL_DOCUMENTS_APPROVED !== '1') {
    throw new Error('Le checkout est bloqué tant que les documents commerciaux FR/EN ne sont pas validés par un professionnel compétent.')
  }
  if (customerType === 'individual') {
    if (!process.env.CONSUMER_MEDIATOR_NAME || !process.env.CONSUMER_MEDIATOR_URL) {
      throw new Error('Le checkout consommateur est bloqué tant que le médiateur de la consommation n’est pas configuré.')
    }
  }
}

export function legalRequestFingerprint(headers: Headers) {
  const key = process.env.LEGAL_FINGERPRINT_KEY ?? process.env.APP_ENCRYPTION_KEY
  if (!key) throw new Error('LEGAL_FINGERPRINT_KEY is not configured')
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const userAgent = headers.get('user-agent') ?? 'unknown'
  return createHmac('sha256', key).update(`${ip}\n${userAgent}`).digest('hex')
}
