import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { localizeFlashMessage } from '@/lib/flash-copy'
import type { Locale } from '@/lib/i18n'

export function FlashMessage({ notice, error, locale = 'fr' }: { notice?: string; error?: string; locale?: Locale }) {
  const value = localizeFlashMessage(error ?? notice, locale)
  if (!value) return null
  return (
    <div className={`mb-6 flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${error ? 'border-red-200 y-status-danger text-[var(--y-danger)]' : 'border-emerald-200 y-status-success text-[var(--y-success)]'}`}>
      {error ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
      <span>{value}</span>
    </div>
  )
}
