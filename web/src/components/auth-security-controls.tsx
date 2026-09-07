'use client'

import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function AuthSecurityControls({ locale }: { locale: string }) {
  const english = locale === 'en'
  const passkeys = authClient.useListPasskeys()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(operation: () => Promise<void>) {
    if (pending) return
    setPending(true); setError(null); setMessage(null)
    try { await operation() } catch {
      setError(english ? 'Unable to complete the request. Check your connection and try again.' : 'Impossible de terminer la demande. Vérifiez votre connexion et réessayez.')
    } finally { setPending(false) }
  }

  async function addPasskey() {
    await run(async () => {
      const result = await authClient.passkey.addPasskey({
        name: english ? 'Ads by Yodev passkey' : 'Passkey Ads by Yodev',
        authenticatorAttachment: 'platform',
      })
      if (!result?.data || result.error) return setError(result?.error?.message || (english ? 'Passkey registration was not completed. Please try again.' : 'L’enregistrement de la passkey n’a pas abouti. Réessayez.'))
      setMessage(english ? 'Passkey registered.' : 'Passkey enregistrée.')
    })
  }

  async function revokeOtherSessions() {
    await run(async () => {
      const result = await authClient.revokeOtherSessions()
      if (result.error) return setError(result.error.message || (english ? 'Session revocation failed.' : 'La révocation a échoué.'))
      setMessage(english ? 'Other sessions revoked.' : 'Autres sessions révoquées.')
    })
  }

  async function removePasskey(id: string) {
    await run(async () => {
      const result = await authClient.passkey.deletePasskey({ id })
      if (result.error) return setError(result.error.message || (english ? 'Unable to remove the passkey.' : 'Impossible de supprimer la passkey.'))
      setRemovingId(null)
      setMessage(english ? 'Passkey removed. This key can no longer sign in to your account.' : 'Passkey supprimée. Cette clé ne permet plus de se connecter à votre compte.')
    })
  }

  return <div className="mt-4 space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={addPasskey}><KeyRound className="mr-2 size-4" />{english ? 'Register a passkey' : 'Enregistrer une passkey'}</Button>
      <Button type="button" variant="outline" disabled={pending} onClick={revokeOtherSessions}><ShieldCheck className="mr-2 size-4" />{english ? 'Revoke other sessions' : 'Révoquer les autres sessions'}</Button>
    </div>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <section aria-label={english ? 'Your passkeys' : 'Vos passkeys'} className="space-y-3">
      <h2 className="font-semibold">{english ? 'Your passkeys' : 'Vos passkeys'}</h2>
      <p className="text-sm text-slate-500">{english ? 'Remove a key you no longer use. To disconnect devices that are already signed in, also revoke other sessions.' : 'Supprimez une clé que vous n’utilisez plus. Pour déconnecter les appareils déjà connectés, révoquez également les autres sessions.'}</p>
      {passkeys.isPending ? <p role="status">{english ? 'Loading passkeys…' : 'Chargement des passkeys…'}</p> : passkeys.error ? <div role="alert"><p>{english ? 'Unable to load your passkeys.' : 'Impossible de charger vos passkeys.'}</p><Button type="button" variant="outline" onClick={() => void passkeys.refetch()}>{english ? 'Retry' : 'Réessayer'}</Button></div> : !passkeys.data?.length ? <p className="text-sm text-slate-500">{english ? 'No passkey registered.' : 'Aucune passkey enregistrée.'}</p> : <ul className="divide-y rounded-xl border px-4">
        {passkeys.data.map((key) => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="min-w-0 break-words text-sm">{key.name || 'Passkey'}{key.createdAt && <span className="block text-xs text-slate-500">{english ? 'Registered on ' : 'Enregistrée le '}{new Date(key.createdAt).toLocaleDateString(english ? 'en-GB' : 'fr-FR', { timeZone: 'UTC' })}</span>}</span>
          {removingId === key.id ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm">{english ? 'Remove this key?' : 'Supprimer cette clé ?'}</span><Button type="button" variant="destructive" disabled={pending} onClick={() => removePasskey(key.id)}>{english ? 'Confirm removal' : 'Confirmer la suppression'}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setRemovingId(null)}>{english ? 'Cancel' : 'Annuler'}</Button></div> : <Button type="button" variant="outline" disabled={pending} aria-label={`${english ? 'Remove' : 'Supprimer'} ${key.name || 'passkey'}`} onClick={() => setRemovingId(key.id)}>{english ? 'Remove' : 'Supprimer'}</Button>}
        </li>)}
      </ul>}
    </section>
  </div>
}
