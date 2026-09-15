// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthPanel } from './auth-panel'
import { PasswordRecovery } from './password-recovery'
import { AuthSecurityControls } from './auth-security-controls'
import { InvitationPanel } from './invitation-panel'
import { AccountMenu } from './account-menu'

const mocks = vi.hoisted(() => ({
  email: vi.fn(), signup: vi.fn(), magic: vi.fn(), social: vi.fn(), passkey: vi.fn(), register: vi.fn(),
  reset: vi.fn(), request: vi.fn(), revoke: vi.fn(), accept: vi.fn(), recover: vi.fn(), active: vi.fn(), signOut: vi.fn(),
  query: new URLSearchParams(), authenticated: true, detailsError: false, refetchSession: vi.fn(), refetchOrganizations: vi.fn(), remove: vi.fn(), keys: [] as { id: string; name: string }[],
}))
vi.mock('@/app/invitation/actions', () => ({ recoverAcceptedInvitation: mocks.recover }))
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.query }))
vi.mock('@/lib/auth-client', () => ({ authClient: {
  signIn: { email: mocks.email, magicLink: mocks.magic, social: mocks.social, passkey: mocks.passkey },
  signUp: { email: mocks.signup }, passkey: { addPasskey: mocks.register, deletePasskey: mocks.remove },
  requestPasswordReset: mocks.request, resetPassword: mocks.reset, revokeOtherSessions: mocks.revoke,
  organization: { acceptInvitation: mocks.accept, setActive: mocks.active }, signOut: mocks.signOut,
  useSession: () => ({ error: mocks.detailsError ? { status: 429 } : null, refetch: mocks.refetchSession, isPending: false, data: mocks.authenticated ? { user: { email: 'local@example.test' }, session: {} } : null }),
  useListPasskeys: () => ({ data: mocks.keys, isPending: false, error: null }),
  useListOrganizations: () => ({ data: [], refetch: mocks.refetchOrganizations }),
} }))

beforeEach(() => { vi.resetAllMocks(); mocks.query = new URLSearchParams(); mocks.authenticated = true; mocks.keys = []; mocks.detailsError = false })
afterEach(cleanup)
const failure = () => Promise.reject(new TypeError('Network unavailable'))

it('distinguishes invited membership from a first-workspace public trial', () => {
  const view = render(<AuthPanel mode="sign-up" locale="en" googleEnabled={false} />)
  expect(screen.getByText(/Private beta by invitation/)).toBeVisible()
  view.rerender(<AuthPanel mode="sign-up" locale="en" googleEnabled={false} publicRegistration />)
  expect(screen.getByText(/14-day trial for your first workspace/)).toBeVisible()
  view.rerender(<AuthPanel mode="sign-up" locale="en" googleEnabled={false} publicRegistration returnTo="/invitation?id=invite" />)
  expect(screen.getByText(/Use the invited email address/)).toBeVisible()
  expect(screen.queryByText(/14-day trial/)).not.toBeInTheDocument()
})

describe('recoverable authentication failures', () => {
  for (const [label, mock] of [['Continue with Google', mocks.social], ['Use a passkey', mocks.passkey]] as const) {
    it(`restores controls after a rejected ${label} request`, async () => {
      mock.mockImplementation(failure)
      render(<AuthPanel mode="sign-in" locale="en" googleEnabled />)
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
      expect(screen.getByRole('button', { name: label })).toBeEnabled()
    })
  }
  it('does not treat an interrupted passkey ceremony as a successful login', async () => {
    mocks.passkey.mockResolvedValue(undefined)
    render(<AuthPanel mode="sign-in" locale="fr" googleEnabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser une passkey' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('n’a pas abouti')
  })
  for (const mode of ['sign-in', 'sign-up'] as const) {
    it(`allows retrying the ${mode} form after a network failure`, async () => {
      const mock = mode === 'sign-in' ? mocks.email : mocks.signup
      mock.mockImplementation(failure)
      render(<AuthPanel mode={mode} locale="en" googleEnabled={false} />)
      fireEvent.submit(screen.getByLabelText('Email', { exact: true }).closest('form')!)
      expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
      expect(screen.getByRole('button', { name: mode === 'sign-in' ? 'Sign in' : 'Create account' })).toBeEnabled()
    })
  }
  it('restores the magic link form after failure and announces success on retry', async () => {
    mocks.magic.mockImplementationOnce(failure).mockResolvedValue({ data: { status: true } })
    render(<AuthPanel mode="sign-in" locale="en" googleEnabled={false} />)
    const form = screen.getByLabelText('Secure sign-in link').closest('form')!
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
    fireEvent.submit(form)
    expect(await screen.findByRole('status')).toHaveTextContent('If this account exists')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
  for (const mode of ['request', 'reset'] as const) {
    it(`restores the password ${mode} form after failure`, async () => {
      mocks.query.set('token', 'local-fixture-token')
      ;(mode === 'request' ? mocks.request : mocks.reset).mockImplementation(failure)
      render(<PasswordRecovery mode={mode} locale="en" />)
      fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!)
      expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })
  }
  it('explains a missing reset token with a recovery link', () => {
    render(<PasswordRecovery mode="reset" locale="fr" />)
    expect(screen.getByRole('alert')).toHaveTextContent('invalide ou expiré')
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled()
  })
  for (const [label, mock] of [['Register a passkey', mocks.register], ['Revoke other sessions', mocks.revoke]] as const) {
    it(`restores security controls after ${label} fails`, async () => {
      mock.mockImplementation(failure)
      render(<AuthSecurityControls locale="en" />)
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
      expect(screen.getByRole('button', { name: label })).toBeEnabled()
    })
  }
  it('does not claim registration when the passkey response is absent', async () => {
    mocks.register.mockResolvedValue(undefined)
    render(<AuthSecurityControls locale="fr" />)
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une passkey' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('n’a pas abouti')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('retries workspace activation without reaccepting a consumed invitation', async () => {
    mocks.query.set('id', 'fixture-invitation')
    mocks.accept.mockResolvedValue({ data: { member: { organizationId: 'invited-organization' } } })
    mocks.active.mockResolvedValue({ error: { message: 'Unavailable' } })
    render(<InvitationPanel locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation accepted')
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
    await waitFor(() => expect(mocks.active).toHaveBeenCalledTimes(2))
    expect(mocks.accept).toHaveBeenCalledTimes(1)
    expect(mocks.active).toHaveBeenLastCalledWith({ organizationId: 'invited-organization' })
  })
  it('preserves invitation through the sign-in link', () => {
    mocks.authenticated = false; mocks.query.set('id', 'fixture-invitation')
    render(<InvitationPanel locale="en" />)
    expect(screen.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute('href', '/sign-in?returnTo=%2Finvitation%3Fid%3Dfixture-invitation')
  })
  it('makes a failed sign out retryable and does not claim to be signed out', async () => {
    mocks.signOut.mockImplementation(failure)
    render(<AccountMenu locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign out')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })
})

it('keeps a failed key removal retryable and requires an explicit confirmation', async () => {
  mocks.keys = [{ id: 'my-key', name: 'Laptop' }]
  mocks.remove.mockImplementation(failure)
  render(<AuthSecurityControls locale="en" />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Laptop' }))
  expect(mocks.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
  expect(screen.getByRole('button', { name: 'Confirm removal' })).toBeEnabled()
  expect(mocks.remove).toHaveBeenCalledWith({ id: 'my-key' })
})

it('explains account loading errors and retries both identity and organization reads', async () => {
  mocks.detailsError = true
  render(<AccountMenu locale="fr" />)
  expect(screen.getByRole('alert')).toHaveTextContent('n’ont pas pu être chargées')
  fireEvent.click(screen.getByRole('button', { name: 'Recharger les informations du compte' }))
  await waitFor(() => expect(mocks.refetchSession).toHaveBeenCalledOnce())
  expect(mocks.refetchOrganizations).toHaveBeenCalledOnce()
})

it('recovers an acceptance whose response was lost without creating another membership', async () => {
  mocks.query.set('id', 'accepted-invitation')
  mocks.accept.mockImplementation(failure)
  mocks.recover.mockResolvedValue('invited-organization')
  mocks.active.mockResolvedValue({ error: { message: 'Unavailable' } })
  render(<InvitationPanel locale="en" />)
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Invitation accepted')
  expect(mocks.recover).toHaveBeenCalledWith('accepted-invitation')
  expect(mocks.active).toHaveBeenCalledWith({ organizationId: 'invited-organization' })
})

it('does not activate a workspace when recovery cannot prove membership', async () => {
  mocks.query.set('id', 'foreign-invitation')
  mocks.accept.mockResolvedValue({ error: { code: 'INVITATION_NOT_FOUND', message: 'Raw provider detail' } })
  mocks.recover.mockResolvedValue(null)
  render(<InvitationPanel locale="en" />)
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Ask the workspace owner for a new invitation')
  expect(screen.getByRole('alert')).not.toHaveTextContent('Raw provider detail')
  expect(mocks.active).not.toHaveBeenCalled()
})

it('rejects ambiguous invitation identifiers before attempting acceptance', () => {
  mocks.query = new URLSearchParams('id=first&id=second')
  render(<InvitationPanel locale="en" />)
  expect(screen.getByText('Invalid invitation link.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument()
  expect(mocks.accept).not.toHaveBeenCalled()
})
