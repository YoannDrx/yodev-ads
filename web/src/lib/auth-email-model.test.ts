import { describe, expect, it } from 'vitest'
import { authEmail } from './auth-email-model'

describe('authentication email model', () => {
  it.each([
    ['email_verification', 'fr', 'Vérifiez votre adresse email', 'Vérifier mon adresse'],
    ['email_verification', 'en', 'Verify your email', 'Verify my email'],
    ['password_reset', 'fr', 'Réinitialisez votre mot de passe', 'Choisir un nouveau mot de passe'],
    ['password_reset', 'en', 'Reset your password', 'Choose a new password'],
    ['magic_link', 'fr', 'Votre lien de connexion sécurisé', 'Me connecter en sécurité'],
    ['magic_link', 'en', 'Your secure sign-in link', 'Sign in securely'],
  ] as const)('renders %s in %s', (kind, locale, subject, button) => {
    const rendered = authEmail({ kind, locale, actionUrl: 'https://ads.example.test/action' })
    expect(rendered.subject).toBe(subject)
    expect(rendered.html).toContain(button)
    expect(rendered.html).toContain('https://ads.example.test/action')
  })

  it('localizes invitations, supplies a fallback and escapes every untrusted field', () => {
    const french = authEmail({
      kind: 'organization_invitation', locale: 'fr', actionUrl: 'https://example.test/?x=<script>', organizationName: '<b>Agence</b>',
    })
    expect(french.subject).toBe('Invitation à un workspace')
    expect(french.html).toContain('&lt;b&gt;Agence&lt;/b&gt;')
    expect(french.html).toContain('&lt;script&gt;')
    expect(french.html).not.toContain('<b>Agence</b>')

    const english = authEmail({ kind: 'organization_invitation', locale: 'en', actionUrl: 'https://example.test' })
    expect(english.subject).toBe('Workspace invitation')
    expect(english.html).toContain('an Ads by Yodev workspace')
  })
})
