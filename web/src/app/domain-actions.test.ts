import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entitlementContext } from '@/lib/entitlements'
import { domainActionError } from '@/lib/domain-action-errors'
import { localizeFlashMessage } from '@/lib/flash-copy'
import { domainStatusLabel } from '@/lib/domain-status-label'

const mocks = vi.hoisted(() => ({ context: vi.fn(), feature: vi.fn(), token: vi.fn(), cookie: vi.fn(), redirect: vi.fn(), create: vi.fn(), verify: vi.fn(), revoke: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookie }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.context }))
vi.mock('@/lib/feature-flags', () => ({ requireFeature: mocks.feature }))
vi.mock('@/lib/tokens', async (original) => ({ ...await original<typeof import('@/lib/tokens')>(), createDomainVerificationToken: mocks.token }))
vi.mock('@/lib/workspace-domain-management', () => ({ createWorkspaceCustomDomain: mocks.create, verifyWorkspaceCustomDomain: mocks.verify, revokeWorkspaceCustomDomain: mocks.revoke }))
import * as actions from './domain-actions'

const workspaceId = '00000000-0000-4000-8000-000000000001', domainId = '00000000-0000-4000-8000-000000000002'
const pairs = [['createWorkspaceDomain', 'create'], ['verifyWorkspaceDomain', 'verify'], ['revokeWorkspaceDomain', 'revoke']] as const
function form() { const data = new FormData(); for (const [key, value] of Object.entries({ workspaceId, domainId, hostname: 'Reports.Example.Test.' })) data.set(key, value); return data }
function context(plan: 'agency' | 'solo' = 'agency') { return { workspace: { id: workspaceId, locale: 'en' }, session: { userId: 'actor' }, entitlements: entitlementContext('active', plan) } }
function error() { return new URL(mocks.redirect.mock.calls[0][0], 'https://example.test').searchParams.get('error') }
function noEffects() { for (const [, service] of pairs) expect(mocks[service]).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled(); expect(mocks.cookie).not.toHaveBeenCalled() }

describe('domain forms and public errors', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.context.mockResolvedValue(context()); mocks.token.mockReturnValue('one-shot-token')
    mocks.create.mockResolvedValue({ id: domainId }); mocks.verify.mockResolvedValue({ active: true }); mocks.revoke.mockResolvedValue({ id: domainId })
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`) })
  })

  it.each(pairs)('%s accepts its displayed workspace and passes the actor to the service', async (action, service) => {
    await expect(actions[action](form())).rejects.toThrow('redirect:')
    expect(mocks[service]).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorUserId: 'actor' }))
    expect(error()).toBeNull()
    if (service === 'create') {
      expect(mocks.create).toHaveBeenCalledWith({ workspaceId, actorUserId: 'actor', hostname: 'reports.example.test', token: 'one-shot-token' })
      expect(mocks.cookie).toHaveBeenCalledWith('yodev_secret_revelation', domainId, expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/api/secret-revelation' }))
    }
  })

  for (const kind of ['missing', 'foreign', 'duplicate']) it.each(pairs)(`%s refuses ${kind} workspace before effects`, async (action) => {
    const data = form()
    if (kind === 'missing') data.delete('workspaceId')
    if (kind === 'foreign') data.set('workspaceId', domainId)
    if (kind === 'duplicate') data.append('workspaceId', workspaceId)
    await expect(actions[action](data)).rejects.toThrow('redirect:')
    expect(error()).toBe('L’espace actif a changé. Rechargez la page avant d’enregistrer.'); noEffects()
  })

  it.each(pairs)('%s refuses revoked permissions with a safe localized error', async (action) => {
    mocks.context.mockRejectedValueOnce(new Error('Permission required: workspace:admin'))
    await expect(actions[action](form())).rejects.toThrow('redirect:'); noEffects()
    expect(localizeFlashMessage(error() ?? undefined, 'en')).toBe('Your current permissions do not allow this action. Reload the page or contact an administrator.')
  })

  it.each(pairs)('%s still respects the global provider switch', async (action) => {
    mocks.feature.mockImplementationOnce(() => { throw new Error('Les domaines personnalisés sont temporairement désactivés.') })
    await expect(actions[action](form())).rejects.toThrow('redirect:'); noEffects()
    expect(localizeFlashMessage(error() ?? undefined, 'en')).toBe('Custom domain operations are temporarily disabled.')
  })

  it.each(['createWorkspaceDomain', 'verifyWorkspaceDomain'] as const)('%s rejects configuration after downgrade', async (action) => {
    mocks.context.mockResolvedValueOnce(context('solo'))
    await expect(actions[action](form())).rejects.toThrow('redirect:'); noEffects()
    expect(localizeFlashMessage(error() ?? undefined, 'en')).toContain('You can remove the existing domain.')
  })

  it('allows the authorized administrator to remove a domain after downgrade', async () => {
    mocks.context.mockResolvedValueOnce(context('solo'))
    await expect(actions.revokeWorkspaceDomain(form())).rejects.toThrow('redirect:')
    expect(mocks.revoke).toHaveBeenCalledWith({ workspaceId, actorUserId: 'actor', domainId }); expect(error()).toBeNull()
  })

  it.each(pairs)('%s keeps SQL and provider details out of redirect URLs', async (action, service) => {
    mocks[service].mockRejectedValueOnce(new Error('Failed query: private-token private-provider-credential'))
    await expect(actions[action](form())).rejects.toThrow('redirect:')
    expect(error()).toBe('Opération du domaine non finalisée. Réessayez ou contactez le support.')
    expect(mocks.redirect.mock.calls[0][0]).not.toContain('private')
  })

  it.each(pairs)('%s handles malformed fields without raw validation output', async (action) => {
    const data = form(); data.set('hostname', ''); data.set('domainId', 'private-invalid-identifier')
    await expect(actions[action](data)).rejects.toThrow('redirect:'); noEffects()
    expect(error()).toBe('Vérifiez le nom du domaine et les champs du formulaire.')
  })

  it('explains a missing TXT without copying its hostname into the error URL', () => {
    const message = domainActionError(new Error('Le TXT _yodev-ads.reports.example.test est absent ou incorrect.'))
    expect(message).not.toContain('reports.example.test')
    expect(localizeFlashMessage(message, 'en')).toBe('The verification TXT record is missing or incorrect. Check its DNS name and value.')
  })

  it('localizes provider progress and treats unknown legacy statuses as unverified', () => {
    expect(domainStatusLabel('ownership_pending', 'en')).toBe('Ownership verification pending')
    expect(domainStatusLabel('dns_verified', 'fr')).toBe('Preuve TXT confirmée')
    expect(domainStatusLabel('private-provider-value', 'en')).toBe('Status to check')
  })
})
