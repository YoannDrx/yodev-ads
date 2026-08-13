import { describe, expect, it } from 'vitest'
import { localizeFlashMessage } from './flash-copy'

describe('localized Server Action flash copy', () => {
  it('keeps French and translates known English messages', () => {
    expect(localizeFlashMessage('Alerte acquittée.', 'fr')).toBe('Alerte acquittée.')
    expect(localizeFlashMessage('Alerte acquittée.', 'en')).toBe('Alert acknowledged.')
    expect(localizeFlashMessage('Approbation enregistrée (1/2).', 'en')).toBe('Approval recorded (1/2).')
  })

  it('preserves provider errors that are not application copy', () => {
    expect(localizeFlashMessage('Google request failed: 429', 'en')).toBe('Google request failed: 429')
  })

  it.each([
    ['4 comptes synchronisés.', '4 accounts synchronized.'],
    ['4 comptes synchronisés. 1 compte annonceur hors quota (3) reste inactif.', '4 accounts synchronized. 1 advertiser account above the quota (3) remains inactive.'],
    ['3 signalement(s) détecté(s), 2 résolu(s).', '3 issue(s) detected, 2 resolved.'],
    ['Trop de demandes. Réessayez dans 12 secondes.', 'Too many requests. Try again in 12 seconds.'],
    ['Trop de messages. Réessayez dans 5 secondes.', 'Too many messages. Try again in 5 seconds.'],
    ['Le tarif Stripe Studio n’est pas encore configuré.', 'The Stripe price for Studio is not configured yet.'],
    ['Le TXT _yodev.example.test est absent ou incorrect.', 'The TXT record _yodev.example.test is missing or incorrect.'],
    ['La devise de la règle doit être EUR pour ce client.', 'The policy currency must be EUR for this client.'],
    ['Résiliation enregistrée. L’accès reste actif jusqu’au 31/08/2026.', 'Cancellation scheduled. Access remains active until 31/08/2026.'],
    ['Suppression programmée au 11/09/2026. Les accès et secrets ont été révoqués.', 'Deletion scheduled for 11/09/2026. Access and secrets have been revoked.'],
  ])('translates dynamic action copy: %s', (french, english) => {
    expect(localizeFlashMessage(french, 'en')).toBe(english)
  })
})
