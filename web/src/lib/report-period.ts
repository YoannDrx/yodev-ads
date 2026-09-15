import { z } from 'zod'

// Numeric compatibility for older callers; calendar selections use report-period-selection.
export const reportPeriodSchema = z.coerce.number().refine(isSupportedReportPeriod, 'La période de rapport n’est pas prise en charge par la collecte actuelle.')

export function isSupportedReportPeriod(value: number) {
  return [7, 30, 90].includes(value)
}

export function unsupportedReportPeriodMessage(locale: string) {
  return locale === 'en'
    ? 'This report has an invalid period. Ask its author to choose 7, 30 or 90 days, a previous month or custom dates.'
    : 'La période de ce rapport est invalide. Demandez à son auteur de choisir 7, 30 ou 90 jours, le mois précédent ou des dates personnalisées.'
}
