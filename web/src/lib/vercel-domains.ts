import 'server-only'

import { isIP } from 'node:net'
import { z } from 'zod'
import { resolveTxt } from 'node:dns/promises'
import { hashToken } from '@/lib/tokens'
import { probeApplicationDomain } from '@/lib/domain-probe'

const projectDomainSchema = z.object({
  name: z.string().min(1), projectId: z.string().min(1), verified: z.boolean(),
  verification: z.array(z.object({ type: z.string().optional(), domain: z.string().optional(), value: z.string().optional(), reason: z.string().optional() })).optional(),
})
const configurationSchema = z.object({
  misconfigured: z.boolean(), configuredBy: z.string().nullable().optional(),
  recommendedIPv4: z.array(z.object({ rank: z.number(), value: z.array(z.string()) })).optional(),
  recommendedCNAME: z.array(z.object({ rank: z.number(), value: z.string() })).optional(),
})
type VercelDomain = z.infer<typeof projectDomainSchema>

export class VercelDomainApiError extends Error {
  readonly code: string | null
  constructor(readonly status: number, code?: unknown) {
    super(`Vercel domain API: HTTP ${status}`)
    this.name = 'VercelDomainApiError'
    this.code = typeof code === 'string' && /^[a-z0-9_]{1,80}$/.test(code) ? code : null
  }
}

export class VercelDomainResponseError extends Error {
  constructor() { super('La réponse Vercel ne permet pas de confirmer l’état du domaine.'); this.name = 'VercelDomainResponseError' }
}

function missingResource(error: unknown) { return error instanceof VercelDomainApiError && error.status === 404 && error.code === 'not_found' }

function projectDomain(data: unknown, hostname: string, project: string) {
  const parsed = projectDomainSchema.safeParse(data)
  if (!parsed.success || parsed.data.name !== hostname || parsed.data.projectId !== project) throw new VercelDomainResponseError()
  return parsed.data
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
  let parsed: URL
  try { parsed = new URL(`https://${raw}`) } catch { throw new Error('Nom de domaine invalide.') }
  const hostname = parsed.hostname
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || /[@?#]/.test(raw) || raw.includes('\\') || !hostname.split('.').every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new Error('Nom de domaine invalide.')
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

async function vercelRequest(path: string, init: RequestInit = {}, beforeRequest?: () => Promise<void>) {
  const { token, teamId } = vercelConfiguration()
  const url = new URL(`https://api.vercel.com${path}`)
  if (teamId) url.searchParams.set('teamId', teamId)
  await beforeRequest?.()
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    })
  } catch {
    // No provider text, credentials or request URL may escape through a caught Server Action error.
    throw new VercelDomainResponseError()
  }
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ code: z.unknown().optional() }) }).safeParse(data)
    throw new VercelDomainApiError(response.status, parsed.success ? parsed.data.error.code : undefined)
  }
  if (data === undefined || (data !== null && typeof data === 'object' && 'error' in data)) throw new VercelDomainResponseError()
  return data
}

export async function addOrVerifyVercelProjectDomain(hostname: string, attemptVerification = false, beforeRequest?: () => Promise<void>) {
  const { project } = vercelConfiguration()
  let domain: VercelDomain
  try {
    domain = projectDomain(await vercelRequest(`/v10/projects/${encodeURIComponent(project)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    }, beforeRequest), hostname, project)
  } catch (error) {
    if (!(error instanceof VercelDomainApiError) || ![400, 409].includes(error.status)) throw error
    domain = projectDomain(await vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`, {}, beforeRequest), hostname, project)
  }
  if (!domain.verified && attemptVerification) {
    domain = projectDomain(await vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}/verify`, { method: 'POST' }, beforeRequest), hostname, project)
  }
  const configuration = await vercelRequest(`/v6/domains/${encodeURIComponent(hostname)}/config`, {}, beforeRequest)
  const parsed = configurationSchema.safeParse(configuration)
  if (!parsed.success) throw new VercelDomainResponseError()
  return { ...domain, configuration: parsed.data }
}

export async function getVercelProjectDomain(hostname: string) {
  const { project } = vercelConfiguration()
  return projectDomain(await vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`), hostname, project)
}

export async function removeVercelProjectDomain(hostname: string, beforeRequest?: () => Promise<void>) {
  const { project } = vercelConfiguration()
  const path = `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`
  try {
    await vercelRequest(path, { method: 'DELETE' }, beforeRequest)
    return { name: hostname, removed: true, alreadyAbsent: false }
  } catch (error) {
    if (!missingResource(error)) throw error
  }
  // A generic nested-resource 404 can also mean a missing/wrong project. Confirm both scopes.
  const currentProject = z.object({ id: z.string() }).safeParse(await vercelRequest(`/v9/projects/${encodeURIComponent(project)}`, {}, beforeRequest))
  if (!currentProject.success || currentProject.data.id !== project) throw new VercelDomainResponseError()
  try {
    await vercelRequest(path, {}, beforeRequest)
  } catch (error) {
    if (missingResource(error)) return { name: hostname, removed: true, alreadyAbsent: true }
    throw error
  }
  throw new VercelDomainResponseError()
}

export async function domainReachesApplication(hostname: string, beforeRequest?: () => Promise<void>) {
  try { return await probeApplicationDomain(normalizeCustomHostname(hostname), beforeRequest) }
  catch { return false }
}
