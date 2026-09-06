import { z } from 'zod'

// Keep creation and readers aligned until historical, date-bounded reports are ready.
export const reportPeriodSchema = z.coerce.number().refine(isSupportedReportPeriod, 'La période de rapport n’est pas prise en charge par la collecte actuelle.')

export function isSupportedReportPeriod(value: number) {
  return value === 30
}

export function unsupportedReportPeriodMessage(locale: string) {
  return locale === 'en'
    ? 'This report uses a period that is not available yet. Ask its author to create a 30-day report.'
    : 'La période de ce rapport n’est pas encore disponible. Demandez à son auteur de créer un rapport de 30 jours.'
}
