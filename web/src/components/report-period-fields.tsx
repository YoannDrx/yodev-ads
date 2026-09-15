'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { reportPeriodSelectionSchema } from '@/lib/report-period-selection'

export function ReportPeriodFields({ id, locale, initial }: { id: string; locale: 'fr' | 'en'; initial?: unknown }) {
  const english = locale === 'en'
  const parsed = reportPeriodSelectionSchema.safeParse(initial ?? { period: '30' })
  const selection = parsed.success ? parsed.data : undefined
  const [period, setPeriod] = useState(selection?.period ?? 'unsupported')
  return <div className="space-y-2">
    <label className="block text-sm font-medium" htmlFor={id}>{english ? 'Period' : 'Période'}</label>
    <select id={id} name="period" value={period} onChange={(event) => setPeriod(event.target.value)} required className="h-10 w-full rounded-lg border bg-card px-3 text-sm">
      {!selection && <option value="unsupported" disabled>{english ? 'Choose a valid period' : 'Choisissez une période valide'}</option>}
      {[7, 30, 90].map((days) => <option key={days} value={days}>{days} {english ? 'completed days' : 'jours complets'}</option>)}
      <option value="previous_month">{english ? 'Previous calendar month' : 'Mois civil précédent'}</option>
      <option value="custom">{english ? 'Custom dates' : 'Dates personnalisées'}</option>
    </select>
    {period === 'custom' && <div className="grid gap-2"><label className="text-xs" htmlFor={`${id}-from`}>{english ? 'From (inclusive)' : 'Du (inclus)'}</label><Input id={`${id}-from`} name="periodFrom" type="date" required defaultValue={selection?.period === 'custom' ? selection.from : ''} /><label className="text-xs" htmlFor={`${id}-through`}>{english ? 'Through (inclusive)' : 'Au (inclus)'}</label><Input id={`${id}-through`} name="periodThrough" type="date" required defaultValue={selection?.period === 'custom' ? selection.through : ''} /></div>}
    <p className="text-xs text-muted-foreground">{english ? 'Complete days in the client account’s timezone. Publishing requires complete stored history for the entire period.' : 'Jours complets dans le fuseau du compte client. La publication exige un historique enregistré complet sur toute la période.'}</p>
  </div>
}
