import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  getSession: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  getLocale: vi.fn(async () => 'fr'),
}))

vi.mock('@/lib/auth', () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/locale', () => ({ getLocale: mocks.getLocale }))

import {
  createInitialWorkspace,
  hasVerifiedAuthIdentity,
  requireAdminWorkspace,
  requireWorkspace,
  requireWorkspacePermission,
} from './workspace'

const workspaceId = '00000000-0000-4000-8000-000000000001'

function authSession(overrides: Record<string, unknown> = {}) {
  return {
    session: { id: 'session-1', activeOrganizationId: 'org-1' },
    user: { id: 'user-1', name: 'Yoann', email: 'yoann@example.test', emailVerified: true },
    ...overrides,
  }
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId, authOrganizationId: 'org-1', ownerUserId: 'user-1', name: 'Agency', slug: 'agency',
    plan: 'studio', accessState: 'active', trialEndsAt: null, ...overrides,
  }
}

function contextDatabase(input: { workspace?: unknown; membership?: unknown; authUser?: unknown; grant?: unknown } = {}) {
  return databaseDouble({ query: {
    workspaces: { findFirst: vi.fn(async () => input.workspace) },
    authMembers: { findFirst: vi.fn(async () => input.membership) },
    authUsers: { findFirst: vi.fn(async () => input.authUser) },
    trialGrants: { findFirst: vi.fn(async () => input.grant) },
  } })
}

describe('Better Auth workspace identity and trial orchestration', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(authSession())
  })

  afterEach(() => vi.useRealTimers())

  it('redirects anonymous users and sessions without an active organization', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    await expect(requireWorkspace()).rejects.toThrow('redirect:/sign-in')
    mocks.getSession.mockResolvedValueOnce(authSession({ session: { id: 'session-1', activeOrganizationId: null } }))
    await expect(requireWorkspace()).rejects.toThrow('redirect:/onboarding')
  })

  it('requires both a Better Auth membership and a mapped workspace', async () => {
    mocks.databases.push(contextDatabase({ workspace: workspace(), membership: undefined }).db)
    await expect(requireWorkspace()).rejects.toThrow('redirect:/onboarding')
    mocks.databases.push(contextDatabase({ workspace: undefined, membership: { role: 'owner' } }).db)
    await expect(requireWorkspace()).rejects.toThrow('redirect:/onboarding')
  })

  it('returns server-derived role and entitlements from Better Auth membership', async () => {
    const existing = workspace({ ownerUserId: 'owner-2' })
    mocks.databases.push(contextDatabase({ workspace: existing, membership: { role: 'strategist' } }).db)
    await expect(requireWorkspace()).resolves.toMatchObject({
      workspace: existing, role: 'strategist', isAdmin: false,
      entitlements: { state: 'active', plan: 'studio' },
    })
  })

  it('fails unknown persisted role, plan and lifecycle values closed', async () => {
    mocks.databases.push(contextDatabase({
      workspace: workspace({ ownerUserId: 'owner-2', plan: 'unknown', accessState: 'unknown' }),
      membership: { role: 'custom' },
    }).db)
    await expect(requireWorkspace()).resolves.toMatchObject({ role: 'client', entitlements: { state: 'suspended', plan: 'trial' } })
  })

  it('suspends an expired trial with a compare-and-set transition', async () => {
    const expired = workspace({ plan: 'trial', accessState: 'trial', trialEndsAt: new Date(0) })
    const suspended = { ...expired, accessState: 'suspended' }
    mocks.databases.push(
      contextDatabase({ workspace: expired, membership: { role: 'owner' } }).db,
      databaseDouble({ statementResults: [[suspended]] }).db,
    )
    await expect(requireWorkspace()).resolves.toMatchObject({ workspace: suspended, entitlements: { state: 'suspended' } })
  })

  it('creates the first verified Better Auth workspace and trial atomically', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:00Z'))
    const database = contextDatabase({
      authUser: { id: 'user-1', email: 'yoann@example.test', emailVerified: true },
      membership: undefined,
      grant: undefined,
    })
    mocks.databases.push(database.db)
    await expect(createInitialWorkspace({ name: 'Mon Agence', slug: 'mon-agence' })).resolves.toMatchObject({ created: true })
    expect(database.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Mon Agence' }),
      expect.objectContaining({ userId: 'user-1', role: 'owner' }),
      expect.objectContaining({ ownerUserId: 'user-1', authOwnerUserId: 'user-1', accessState: 'trial' }),
      expect.objectContaining({ creatorAuthUserId: 'user-1' }),
    ]))
  })

  it('denies an unverified identity and never grants a second trial', async () => {
    mocks.databases.push(contextDatabase({ authUser: { id: 'user-1', emailVerified: false } }).db)
    await expect(createInitialWorkspace({ name: 'Agence', slug: 'agence' })).rejects.toThrow('vérifier')

    const repeated = contextDatabase({
      authUser: { id: 'user-1', emailVerified: true }, membership: undefined, grant: { workspaceId: 'old' },
    })
    mocks.databases.push(repeated.db)
    await createInitialWorkspace({ name: 'Agence', slug: 'agence' })
    expect(repeated.capture.values).toContainEqual(expect.objectContaining({ accessState: 'suspended', trialStartedAt: null, trialEndsAt: null }))
    expect(repeated.capture.values).not.toContainEqual(expect.objectContaining({ creatorAuthUserId: 'user-1' }))
  })

  it('detects verified Better Auth identities from the database', async () => {
    mocks.databases.push(contextDatabase({ authUser: { email: 'owner@example.test', emailVerified: true } }).db)
    await expect(hasVerifiedAuthIdentity('user-1')).resolves.toBe(true)
    mocks.databases.push(contextDatabase({ authUser: { email: 'owner@example.test', emailVerified: false } }).db)
    await expect(hasVerifiedAuthIdentity('user-1')).resolves.toBe(false)
  })

  it('enforces lifecycle and permission guards after identity resolution', async () => {
    mocks.databases.push(contextDatabase({ workspace: workspace(), membership: { role: 'owner' } }).db)
    await expect(requireAdminWorkspace()).resolves.toMatchObject({ role: 'owner' })
    mocks.databases.push(contextDatabase({ workspace: workspace({ ownerUserId: 'owner' }), membership: { role: 'client' } }).db)
    await expect(requireWorkspacePermission('billing:manage')).rejects.toThrow('Permission required')
    mocks.databases.push(contextDatabase({ workspace: workspace({ accessState: 'grace' }), membership: { role: 'owner' } }).db)
    await expect(requireWorkspacePermission('reports:manage')).rejects.toThrow('access state')
  })
})
