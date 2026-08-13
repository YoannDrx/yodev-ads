'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SecretRevelation({ title, buttonLabel }: { title: string; buttonLabel: string }) {
  const [secret, setSecret] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  async function reveal() {
    setLoading(true)
    setError(undefined)
    const response = await fetch('/api/secret-revelation', { method: 'POST' })
    const body = await response.json() as { data?: { secret?: string }; error?: { message?: string } }
    setLoading(false)
    if (!response.ok || !body.data?.secret) {
      setError(body.error?.message ?? 'La clé ne peut plus être révélée.')
      return
    }
    setSecret(body.data.secret)
  }

  return (
    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">{title}</p>
      {secret ? (
        <Input readOnly value={secret} className="mt-3 bg-white font-mono text-xs" />
      ) : (
        <Button type="button" className="mt-3" onClick={reveal} disabled={loading}>
          {loading ? 'Révélation…' : buttonLabel}
        </Button>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
