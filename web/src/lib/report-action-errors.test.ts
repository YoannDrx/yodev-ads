import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { reportActionError } from './report-action-errors'
import { localizeFlashMessage } from './flash-copy'

describe('safe report action errors', () => {
  it.each([
    ['Un envoi est en cours. Réessayez dans quelques minutes.', 'A delivery is in progress. Try again in a few minutes.'],
    ['L’espace actif a changé. Rechargez la page avant d’enregistrer.', 'The active workspace changed. Reload this page before saving.'],
    ['Quota exceeded: reports (3/3)', 'This workspace has reached its report limit. Deactivate a link before trying again.'],
  ])('keeps actionable errors translated: %s', (error, english) => {
    expect(localizeFlashMessage(reportActionError(new Error(error)), 'en')).toBe(english)
  })
  it('hides arbitrary details including a known prefix followed by secrets', () => {
    for (const error of [new Error('Quota exceeded: reports (3/3) private@example.test'), new Error('SQL bearer-secret'), 'private-editorial', undefined]) {
      expect(localizeFlashMessage(reportActionError(error), 'en')).toBe('Unable to save this report change. Refresh the page and try again.')
    }
  })
  it('replaces schema diagnostics with a translated validation message', () => {
    const invalid = z.email().safeParse('private-invalid-input')
    expect(localizeFlashMessage(reportActionError(invalid.error), 'en')).toBe('Check the form fields and reporting dates before trying again.')
  })
})
