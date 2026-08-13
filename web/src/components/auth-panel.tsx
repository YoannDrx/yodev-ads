'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { KeyRound, Radar } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function AuthPanel({ mode, locale, googleEnabled }: { mode: 'sign-in' | 'sign-up'; locale: string; googleEnabled: boolean }) {
  const english = locale === 'en'
  const signUp = mode === 'sign-up'
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(formData: FormData) {
    setPending(true)
    setError(null)
    setNotice(null)
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    const name = String(formData.get('name') ?? '').trim()
    const result = signUp
      ? await authClient.signUp.email({ email, password, name, callbackURL: '/onboarding' })
      : await authClient.signIn.email({ email, password, callbackURL: '/dashboard' })
    setPending(false)
    if (result.error) {
      setError(result.error.message || (english ? 'Authentication failed.' : 'Échec de l’authentification.'))
      return
    }
    if (signUp) {
      setNotice(english ? 'Check your email to verify your account.' : 'Consultez votre email pour vérifier votre compte.')
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  async function google() {
    setError(null)
    await authClient.signIn.social({ provider: 'google', callbackURL: signUp ? '/onboarding' : '/dashboard' })
  }

  async function emailLink(formData: FormData) {
    setPending(true)
    setError(null)
    setNotice(null)
    const email = String(formData.get('magicEmail') ?? '').trim().toLowerCase()
    const result = await authClient.signIn.magicLink({
      email,
      callbackURL: '/dashboard',
      errorCallbackURL: '/sign-in',
    })
    setPending(false)
    if (result.error) {
      setError(result.error.message || (english ? 'Unable to send the secure link.' : 'Impossible d’envoyer le lien sécurisé.'))
      return
    }
    setNotice(english ? 'If this account exists, a secure sign-in link has been sent.' : 'Si ce compte existe, un lien de connexion sécurisé a été envoyé.')
  }

  async function passkey() {
    setPending(true)
    setError(null)
    const result = await authClient.signIn.passkey()
    setPending(false)
    if (result?.error) return setError(result.error.message || 'Passkey authentication failed.')
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f3f6f8] p-6 text-[#0d1722]">
      <div className="w-full max-w-md rounded-3xl border border-black/7 bg-white p-7 shadow-xl shadow-slate-900/5">
        <Link href="/" className="mx-auto flex w-fit items-center gap-2 font-semibold"><Radar className="size-6 text-[#19A58F]" /> Ads by Yodev</Link>
        <h1 className="mt-7 text-center text-2xl font-semibold tracking-tight">
          {signUp ? (english ? 'Create your account' : 'Créer votre compte') : (english ? 'Welcome back' : 'Heureux de vous revoir')}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          {signUp ? (english ? 'Start your 14-day trial after email verification.' : 'Démarrez votre essai de 14 jours après vérification de votre email.') : (english ? 'Sign in to your secure workspace.' : 'Connectez-vous à votre espace sécurisé.')}
        </p>
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <form action={submit} className="mt-6 space-y-4">
          {signUp && <label className="block text-sm font-medium">{english ? 'Name' : 'Nom'}<input name="name" required minLength={2} maxLength={120} autoComplete="name" className="mt-1.5 h-11 w-full rounded-xl border px-3 outline-none focus:border-[#19A58F]" /></label>}
          <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className="mt-1.5 h-11 w-full rounded-xl border px-3 outline-none focus:border-[#19A58F]" /></label>
          <label className="block text-sm font-medium">{english ? 'Password' : 'Mot de passe'}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete={signUp ? 'new-password' : 'current-password'} className="mt-1.5 h-11 w-full rounded-xl border px-3 outline-none focus:border-[#19A58F]" /></label>
          <Button disabled={pending} className="h-11 w-full bg-[#0d1722] text-white hover:bg-[#182838]">{pending ? '…' : signUp ? (english ? 'Create account' : 'Créer mon compte') : (english ? 'Sign in' : 'Se connecter')}</Button>
        </form>
        {!signUp && <Link href="/forgot-password" className="mt-3 block text-center text-sm text-[#168977]">{english ? 'Forgot password?' : 'Mot de passe oublié ?'}</Link>}
        {!signUp && <form action={emailLink} className="mt-4 space-y-3 rounded-2xl bg-slate-50 p-4"><label className="block text-sm font-medium">{english ? 'Secure sign-in link' : 'Lien de connexion sécurisé'}<input name="magicEmail" type="email" required autoComplete="email" placeholder="Email" className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 outline-none focus:border-[#19A58F]" /></label><Button disabled={pending} type="submit" variant="outline" className="h-11 w-full">{english ? 'Email me a sign-in link' : 'Recevoir un lien par email'}</Button></form>}
        {googleEnabled && <><div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" />{english ? 'or' : 'ou'}<span className="h-px flex-1 bg-slate-200" /></div><Button type="button" variant="outline" className="h-11 w-full" onClick={google}>{english ? 'Continue with Google' : 'Continuer avec Google'}</Button></>}
        {!signUp && <Button type="button" variant="ghost" className="mt-2 h-11 w-full" onClick={passkey}><KeyRound className="mr-2 size-4" />{english ? 'Use a passkey' : 'Utiliser une passkey'}</Button>}
        <p className="mt-6 text-center text-sm text-slate-500">
          {signUp ? (english ? 'Already registered?' : 'Déjà inscrit ?') : (english ? 'New to Ads by Yodev?' : 'Nouveau sur Ads by Yodev ?')}{' '}
          <Link className="font-medium text-[#168977]" href={signUp ? '/sign-in' : '/sign-up'}>{signUp ? (english ? 'Sign in' : 'Se connecter') : (english ? 'Create an account' : 'Créer un compte')}</Link>
        </p>
      </div>
    </main>
  )
}
