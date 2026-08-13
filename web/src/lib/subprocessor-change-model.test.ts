import { describe, expect, it } from 'vitest'
import {
  assertSubprocessorNoticePeriod,
  minimumSubprocessorNoticeDate,
  subprocessorChangeEmail,
} from './subprocessor-change-model'

const now = new Date('2026-08-13T10:00:00.000Z')

describe('subprocessor change notice model', () => {
  it('enforces a complete 15-day notice period', () => {
    expect(minimumSubprocessorNoticeDate(now)).toEqual(new Date('2026-08-28T10:00:00.000Z'))
    expect(() => assertSubprocessorNoticePeriod(new Date('2026-08-28T09:59:59.999Z'), now)).toThrow('15 jours')
    expect(() => assertSubprocessorNoticePeriod(new Date('2026-08-28T10:00:00.000Z'), now)).not.toThrow()
    expect(() => assertSubprocessorNoticePeriod(new Date('invalid'), now)).toThrow('invalide')
  })

  it('renders localized, escaped notification content', () => {
    const french = subprocessorChangeEmail({
      locale: 'fr', workspaceName: '<Atelier>', vendorName: 'Vendor & Co', changeType: 'addition',
      summaryFr: '<script>alert(1)</script>', summaryEn: 'New vendor',
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'), url: 'https://ads.yodev.fr/subprocessors',
    })
    expect(french.subject).toContain('Notification de changement')
    expect(french.html).toContain('&lt;Atelier&gt;')
    expect(french.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(french.html).not.toContain('<script>')

    const english = subprocessorChangeEmail({
      locale: 'en', workspaceName: 'Studio', vendorName: 'Vendor', changeType: 'replacement',
      summaryFr: 'Remplacement fournisseur', summaryEn: 'Provider replacement details',
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'), url: 'https://ads.yodev.fr/subprocessors',
    })
    expect(english.subject).toContain('Subprocessor change notice')
    expect(english.html).toContain('Provider replacement details')
  })
})
