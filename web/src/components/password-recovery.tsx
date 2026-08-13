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
  async function submit(formData: FormData) {
    setPending(true); setError(null); setMessage(null)
    const result = mode === 'request'
      ? await authClient.requestPasswordReset({ email: String(formData.get('email') ?? '').trim().toLowerCase(), redirectTo: '/reset-password' })
      : await authClient.resetPassword({ newPassword: String(formData.get('password') ?? ''), token: token ?? '' })
    setPending(false)
    if (result.error) return setError(result.error.message || (english ? 'Request failed.' : 'La demande a échoué.'))
    setMessage(mode === 'request' ? (english ? 'If the account exists, a reset link has been sent.' : 'Si le compte existe, un lien a été envoyé.') : (english ? 'Password updated. You can now sign in.' : 'Mot de passe mis à jour. Vous pouvez vous connecter.'))
  }
  return <main className="grid min-h-screen place-items-center bg-[#f3f6f8] p-6"><div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl"><h1 className="text-2xl font-semibold">{mode === 'request' ? (english ? 'Reset your password' : 'Réinitialiser le mot de passe') : (english ? 'Choose a new password' : 'Choisir un nouveau mot de passe')}</h1>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}<form action={submit} className="mt-6 space-y-4">{mode === 'request' ? <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className="mt-1.5 h-11 w-full rounded-xl border px-3" /></label> : <label className="block text-sm font-medium">{english ? 'New password' : 'Nouveau mot de passe'}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className="mt-1.5 h-11 w-full rounded-xl border px-3" /></label>}<Button disabled={pending || (mode === 'reset' && !token)} className="h-11 w-full">{pending ? '…' : english ? 'Continue' : 'Continuer'}</Button></form><Link href="/sign-in" className="mt-5 block text-center text-sm text-[#168977]">{english ? 'Back to sign in' : 'Retour à la connexion'}</Link></div></main>
}
