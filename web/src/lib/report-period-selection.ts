import { z } from 'zod'
import { calendarDates, reportCalendarWindow } from '@/lib/calendar-window'

export const reportPeriodSelectionSchema = z.discriminatedUnion('period', [
  z.object({ period: z.enum(['7', '30', '90']) }).strict(),
  z.object({ period: z.literal('previous_month') }).strict(),
  z.object({ period: z.literal('custom'), from: z.string(), through: z.string() }).strict(),
]).superRefine((selection, context) => {
  if (selection.period !== 'custom') return
  try { calendarDates(selection) } catch {
    context.addIssue({ code: 'custom', message: 'La plage de dates doit contenir entre 1 et 730 jours calendaires valides.' })
  }
})
export type ReportPeriodSelection = z.infer<typeof reportPeriodSelectionSchema>

export function storedReportPeriod(input: { periodConfig?: unknown; periodDays: number }) {
  return reportPeriodSelectionSchema.parse(input.periodConfig ?? { period: String(input.periodDays) })
}

export function reportPeriodFromForm(input: { period?: unknown; periodDays?: unknown; periodFrom?: unknown; periodThrough?: unknown }) {
  const period = input.period ?? String(input.periodDays ?? 30)
  return reportPeriodSelectionSchema.parse(period === 'custom'
    ? { period, from: input.periodFrom, through: input.periodThrough }
    : { period })
}

export function resolveReportPeriod(selection: ReportPeriodSelection, now: Date, timezone: string) {
  const validated = reportPeriodSelectionSchema.parse(selection)
  return reportCalendarWindow({ period: validated.period, now, timezone, custom: validated.period === 'custom' ? validated : undefined })
}

export function describeReportPeriod(selection: ReportPeriodSelection, locale: string) {
  if (selection.period === 'custom') return `${selection.from} → ${selection.through}`
  if (selection.period === 'previous_month') return locale === 'en' ? 'Previous calendar month' : 'Mois civil précédent'
  return `${selection.period} ${locale === 'en' ? 'completed days' : 'jours complets'}`
}
