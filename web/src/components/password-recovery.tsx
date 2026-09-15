'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function PasswordRecovery({ mode, locale }: { mode: 'request' | 'reset'; locale: string }) {
  const english = locale === 'en'
  const token = useSearchParams().get('token')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const invalidLink = mode === 'reset' && !token
  async function submit(formData: FormData) {
    if (pending || invalidLink) return
    setPending(true); setError(null); setMessage(null)
    try {
      const result = mode === 'request'
        ? await authClient.requestPasswordReset({ email: String(formData.get('email') ?? '').trim().toLowerCase(), redirectTo: '/reset-password' })
        : await authClient.resetPassword({ newPassword: String(formData.get('password') ?? ''), token: token ?? '' })
      if (result.error) return setError(result.error.message || (english ? 'Request failed.' : 'La demande a échoué.'))
      setMessage(mode === 'request' ? (english ? 'If the account exists, a reset link has been sent.' : 'Si le compte existe, un lien a été envoyé.') : (english ? 'Password updated. You can now sign in.' : 'Mot de passe mis à jour. Vous pouvez vous connecter.'))
    } catch {
      setError(english ? 'Unable to complete the request. Check your connection and try again.' : 'Impossible de terminer la demande. Vérifiez votre connexion et réessayez.')
    } finally { setPending(false) }
  }

  return <main className="grid min-h-screen place-items-center bg-card p-6"><div className="w-full max-w-md rounded-md bg-card p-7 "><h1 className="text-2xl font-semibold">{mode === 'request' ? (english ? 'Reset your password' : 'Réinitialiser le mot de passe') : (english ? 'Choose a new password' : 'Choisir un nouveau mot de passe')}</h1>{invalidLink && <p role="alert" className="mt-4 rounded-md y-status-warning p-3 text-sm text-[var(--y-warning)]">{english ? 'This reset link is invalid or expired.' : 'Ce lien de réinitialisation est invalide ou expiré.'}{' '}<Link href="/forgot-password" className="underline">{english ? 'Request a new link' : 'Demander un nouveau lien'}</Link></p>}{error && <p role="alert" className="mt-4 rounded-md y-status-danger p-3 text-sm text-[var(--y-danger)]">{error}</p>}{message && <p role="status" className="mt-4 rounded-md y-status-success p-3 text-sm text-[var(--y-success)]">{message}</p>}<form action={submit} className="mt-6 space-y-4">{mode === 'request' ? <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className="mt-1.5 h-11 w-full rounded-md border px-3" /></label> : <label className="block text-sm font-medium">{english ? 'New password' : 'Nouveau mot de passe'}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className="mt-1.5 h-11 w-full rounded-md border px-3" /></label>}<Button disabled={pending || (mode === 'reset' && !token)} className="h-11 w-full">{pending ? '…' : english ? 'Continue' : 'Continuer'}</Button></form><Link href="/sign-in" className="mt-5 block text-center text-sm text-muted-foreground">{english ? 'Back to sign in' : 'Retour à la connexion'}</Link></div></main>
}
