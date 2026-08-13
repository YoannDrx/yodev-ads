import 'server-only'

import { isIP } from 'node:net'
import { resolveTxt } from 'node:dns/promises'
import { hashToken } from '@/lib/tokens'

type VercelDomain = {
  name?: string
  verified?: boolean
  verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>
  error?: { code?: string; message?: string }
  misconfigured?: boolean
  configuredBy?: string | null
  recommendedIPv4?: Array<{ rank?: number; value?: string }>
  recommendedCNAME?: Array<{ rank?: number; value?: string }>
}

function vercelConfiguration() {
  const token = process.env.VERCEL_API_TOKEN
  const project = process.env.VERCEL_PROJECT_ID
  if (!token || !project) throw new Error('VERCEL_API_TOKEN et VERCEL_PROJECT_ID sont requis pour les domaines personnalisés.')
  return { token, project, teamId: process.env.VERCEL_TEAM_ID }
}

export function normalizeCustomHostname(value: string) {
  const raw = value.trim().toLocaleLowerCase('en-US').replace(/\.$/, '')
  if (!raw || raw.includes('/') || raw.includes(':') || raw.startsWith('*.')) throw new Error('Saisissez un nom d’hôte sans protocole, chemin, port ni wildcard.')
  const hostname = new URL(`https://${raw}`).hostname
  if (hostname.length > 253 || !hostname.includes('.') || isIP(hostname)) throw new Error('Nom de domaine invalide.')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('Ce domaine local ou interne ne peut pas être utilisé.')
  const applicationHost = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr').hostname
  if (hostname === applicationHost || hostname.endsWith('.vercel.app')) throw new Error('Ce domaine est réservé à la plateforme.')
  return hostname
}

export function domainDnsRecord(hostname: string, token: string) {
  return { type: 'TXT' as const, name: `_yodev-ads.${hostname}`, value: `yodev-domain-verification=${token}` }
}

export async function verifyDomainDnsOwnership(hostname: string, expectedTokenHash: string) {
  let records: string[][]
  try {
    records = await resolveTxt(`_yodev-ads.${hostname}`)
  } catch {
    return false
  }
  return records
    .map((parts) => parts.join(''))
    .filter((value) => value.startsWith('yodev-domain-verification='))
    .some((value) => hashToken(value.slice('yodev-domain-verification='.length)) === expectedTokenHash)
}

async function vercelRequest(path: string, init: RequestInit = {}) {
  const { token, teamId } = vercelConfiguration()
  const url = new URL(`https://api.vercel.com${path}`)
  if (teamId) url.searchParams.set('teamId', teamId)
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const data = await response.json().catch(() => ({})) as VercelDomain
  if (!response.ok) throw new Error(`Vercel domain API: ${data.error?.message ?? `HTTP ${response.status}`}`)
  return data
}

export async function addOrVerifyVercelProjectDomain(hostname: string, attemptVerification = false) {
  const { project } = vercelConfiguration()
  let domain: VercelDomain
  try {
    domain = await vercelRequest(`/v10/projects/${encodeURIComponent(project)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    })
  } catch (error) {
    if (!(error instanceof Error) || !/already|exist/i.test(error.message)) throw error
    domain = await vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`)
  }
  if (!domain.verified && attemptVerification) {
    domain = await vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}/verify`, { method: 'POST' })
  }
  const configuration = await vercelRequest(`/v6/domains/${encodeURIComponent(hostname)}/config`)
  return { ...domain, configuration }
}

export async function getVercelProjectDomain(hostname: string) {
  const { project } = vercelConfiguration()
  return vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`)
}

export async function removeVercelProjectDomain(hostname: string) {
  const { project } = vercelConfiguration()
  return vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`, { method: 'DELETE' })
}

export async function domainReachesApplication(hostname: string) {
  try {
    const response = await fetch(`https://${hostname}/api/health`, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
    return response.ok
  } catch {
    return false
  }
}
