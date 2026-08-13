'use client'

import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function AuthSecurityControls({ locale }: { locale: string }) {
  const english = locale === 'en'
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function addPasskey() {
    setPending(true); setError(null); setMessage(null)
    const result = await authClient.passkey.addPasskey({
      name: english ? 'Ads by Yodev passkey' : 'Passkey Ads by Yodev',
      authenticatorAttachment: 'platform',
    })
    setPending(false)
    if (result?.error) return setError(result.error.message || (english ? 'Passkey registration failed.' : 'L’enregistrement de la passkey a échoué.'))
    setMessage(english ? 'Passkey registered.' : 'Passkey enregistrée.')
  }

  async function revokeOtherSessions() {
    setPending(true); setError(null); setMessage(null)
    const result = await authClient.revokeOtherSessions()
    setPending(false)
    if (result.error) return setError(result.error.message || (english ? 'Session revocation failed.' : 'La révocation a échoué.'))
    setMessage(english ? 'Other sessions revoked.' : 'Autres sessions révoquées.')
  }

  return <div className="mt-4 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={pending} onClick={addPasskey}><KeyRound className="mr-2 size-4" />{english ? 'Register a passkey' : 'Enregistrer une passkey'}</Button><Button type="button" variant="outline" disabled={pending} onClick={revokeOtherSessions}><ShieldCheck className="mr-2 size-4" />{english ? 'Revoke other sessions' : 'Révoquer les autres sessions'}</Button>{message && <p className="w-full text-xs text-emerald-700">{message}</p>}{error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}</div>
}
