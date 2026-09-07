'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SecretRevelation({ title, buttonLabel, workspaceId, revelationId, kind, locale }: {
  title: string; buttonLabel: string; workspaceId: string; revelationId?: string; kind: 'api_key' | 'report_url' | 'domain_dns'; locale: 'fr' | 'en'
}) {
  const [secret, setSecret] = useState<string>()
  const [dnsRecord, setDnsRecord] = useState<{ name: string; value: string }>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const english = locale === 'en'
  const unavailable = english ? 'This secret is unavailable, expired, already revealed, or your access has changed. Refresh the page and create a new one if needed.' : 'Ce secret est indisponible, expiré, déjà révélé, ou vos droits ont changé. Actualisez la page et créez-en un nouveau si nécessaire.'

  async function copy(value: string) {
    setError(undefined)
    setCopied(false)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setError(english ? 'Copying was blocked. Select the field and copy its contents manually.' : 'La copie a été bloquée. Sélectionnez le champ et copiez son contenu manuellement.')
    }
  }

  async function reveal() {
    setLoading(true)
    setError(undefined)
    try {
      const response = await fetch('/api/secret-revelation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, revelationId, kind }) })
      if (!response.ok) { setError(unavailable); return }
      const body = await response.json() as { data?: { secret?: unknown } }
      if (typeof body.data?.secret !== 'string' || !body.data.secret) { setError(unavailable); return }
      if (kind === 'domain_dns') {
        const record = JSON.parse(body.data.secret) as { type?: unknown; name?: unknown; value?: unknown } | null
        if (!record || record.type !== 'TXT' || typeof record.name !== 'string' || typeof record.value !== 'string' || !record.name || !record.value) { setError(unavailable); return }
        setDnsRecord({ name: record.name, value: record.value })
      }
      setSecret(body.data.secret)
    } catch {
      setError(english ? 'The response could not be received. Try again; if the secret was already revealed, create a new one.' : 'La réponse n’a pas pu être reçue. Réessayez ; si le secret a déjà été révélé, créez-en un nouveau.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">{title}</p>
      {secret ? (
        <div className="mt-3 space-y-2">
          {dnsRecord ? <>
            <p className="text-xs text-emerald-900">{english ? 'Create a TXT record with these fields.' : 'Créez un enregistrement TXT avec ces champs.'}</p>
            {[{ label: english ? 'DNS name' : 'Nom DNS', value: dnsRecord.name, button: english ? 'Copy name' : 'Copier le nom' }, { label: english ? 'TXT value' : 'Valeur TXT', value: dnsRecord.value, button: english ? 'Copy value' : 'Copier la valeur' }].map((field) => <div key={field.label} className="space-y-1">
              <label className="block text-xs text-emerald-900">{field.label}<Input readOnly value={field.value} className="mt-1 bg-white font-mono text-xs" /></label>
              <Button type="button" variant="outline" size="sm" onClick={() => copy(field.value)}>{field.button}</Button>
            </div>)}
          </> : <>
            <Input aria-label={title} readOnly value={secret} className="bg-white font-mono text-xs" />
            <Button type="button" variant="outline" size="sm" onClick={() => copy(secret)}>{english ? 'Copy' : 'Copier'}</Button>
          </>}
          {copied && <p role="status" className="text-xs text-emerald-800">{english ? 'Copied.' : 'Copié.'}</p>}
        </div>
      ) : (
        <Button type="button" className="mt-3" onClick={reveal} disabled={loading || !revelationId}>
          {loading ? english ? 'Revealing…' : 'Révélation…' : buttonLabel}
        </Button>
      )}
      {(error || !revelationId) && <p role="alert" className="mt-2 text-xs text-red-700">{error ?? unavailable}</p>}
    </div>
  )
}
