import { AlertCircle, CheckCircle2 } from 'lucide-react'

export function FlashMessage({ notice, error }: { notice?: string; error?: string }) {
  const value = error ?? notice
  if (!value) return null
  return (
    <div className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {error ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
      <span>{value}</span>
    </div>
  )
}
