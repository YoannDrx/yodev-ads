import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { localizeFlashMessage } from '@/lib/flash-copy'
import type { Locale } from '@/lib/i18n'

export function FlashMessage({ notice, error, locale = 'fr' }: { notice?: string; error?: string; locale?: Locale }) {
  const value = localizeFlashMessage(error ?? notice, locale)
  if (!value) return null
  return (
    <div className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {error ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
      <span>{value}</span>
    </div>
  )
}
