import { expect, it } from 'vitest'
import { invitationErrorMessage } from './invitation-error'

it('localizes predictable refusals with a concrete next step', () => {
  const codes = ['WORKSPACE_INVITATION_UNAVAILABLE', 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED', 'INVITATION_NOT_FOUND', 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION']
  for (const code of codes) {
    expect(invitationErrorMessage(code, 'en')).not.toBe(invitationErrorMessage(code, 'fr'))
    expect(invitationErrorMessage(code, 'fr')).not.toContain(code)
  }
  expect(invitationErrorMessage(codes[0], 'fr')).toContain('rétablir son accès')
  expect(invitationErrorMessage(codes[1], 'en')).toContain('free a place')
})

it('does not expose unrecognized provider or database details', () => {
  expect(invitationErrorMessage('SQL query with private details', 'fr')).toBe(invitationErrorMessage(undefined, 'fr'))
  expect(invitationErrorMessage(undefined, 'unknown')).toBe(invitationErrorMessage(undefined, 'fr'))
})
