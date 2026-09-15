"use client";
import { YodevBrand } from "@/brand/brand";
import { AppearanceToggle } from "./appearance";

import Link from 'next/link'
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { authDestination } from '@/lib/auth-destination'
import { Button } from '@/components/ui/button'

export function AuthPanel({ mode, locale, googleEnabled, returnTo, linkError = false, publicRegistration = false }: { mode: 'sign-in' | 'sign-up'; locale: string; googleEnabled: boolean; returnTo?: string; linkError?: boolean; publicRegistration?: boolean }) {
  const english = locale === 'en'
  const signUp = mode === 'sign-up'
  const destination = authDestination(returnTo, signUp ? '/onboarding' : '/dashboard')
  const invitationQuery = (destination === '/account' || destination.startsWith('/invitation?')) ? `?returnTo=${encodeURIComponent(destination)}` : ''
  const [error, setError] = useState<string | null>(linkError ? (english ? 'This sign-in link is invalid or expired. Request a new link below.' : 'Ce lien de connexion est invalide ou expiré. Demandez un nouveau lien ci-dessous.') : null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function run(operation: () => Promise<void>) {
    if (pending) return
    setPending(true); setError(null); setNotice(null)
    try { await operation() } catch {
      setError(english ? 'Unable to complete the request. Check your connection and try again.' : 'Impossible de terminer la demande. Vérifiez votre connexion et réessayez.')
    } finally { setPending(false) }
  }

  async function submit(formData: FormData) {
    await run(async () => {
      const email = String(formData.get('email') ?? '').trim().toLowerCase()
      const password = String(formData.get('password') ?? '')
      const name = String(formData.get('name') ?? '').trim()
      const result = signUp
        ? await authClient.signUp.email({ email, password, name, callbackURL: destination })
        : await authClient.signIn.email({ email, password, callbackURL: destination })
      if (result.error) {
        setError(result.error.message || (english ? 'Authentication failed.' : 'Échec de l’authentification.'))
        return
      }
      if (signUp) {
        setNotice(english ? 'Check your email to verify your account.' : 'Consultez votre email pour vérifier votre compte.')
        return
      }
      // A new identity must not reuse a previously cached workspace document.
      window.location.assign(destination)
    })
  }

  async function google() {
    await run(async () => {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: destination })
      if (result.error) setError(result.error.message || (english ? 'Google sign-in failed.' : 'La connexion Google a échoué.'))
    })
  }

  async function emailLink(formData: FormData) {
    await run(async () => {
      const email = String(formData.get('magicEmail') ?? '').trim().toLowerCase()
      const result = await authClient.signIn.magicLink({ email, callbackURL: destination, errorCallbackURL: new URL(`/sign-in${invitationQuery}`, window.location.origin).href })
      if (result.error) {
        setError(result.error.message || (english ? 'Unable to send the secure link.' : 'Impossible d’envoyer le lien sécurisé.'))
        return
      }
      setNotice(english ? 'If this account exists, a secure sign-in link has been sent.' : 'Si ce compte existe, un lien de connexion sécurisé a été envoyé.')
    })
  }

  async function passkey() {
    await run(async () => {
      const result = await authClient.signIn.passkey()
      if (!result?.data || result.error) {
        setError(result?.error?.message || (english ? 'Passkey sign-in was not completed. Try again or use another sign-in method.' : 'La connexion par passkey n’a pas abouti. Réessayez ou utilisez un autre mode de connexion.'))
        return
      }
      window.location.assign(destination)
    })
  }

  return (
    <main className="grid min-h-screen place-items-center bg-card p-6 text-foreground">
      <div className="w-full max-w-md rounded-md border border-border bg-card p-7  ">
        <Link href="/" className="mx-auto flex w-fit items-center gap-2 font-semibold"><YodevBrand product="ads"/></Link>
        <div className="mt-4 flex justify-end"><AppearanceToggle locale={locale}/></div><h1 className="mt-7 text-center text-2xl font-semibold tracking-tight">
          {signUp ? (english ? 'Create your account' : 'Créer votre compte') : (english ? 'Welcome back' : 'Heureux de vous revoir')}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {signUp ? destination.startsWith('/invitation?')
            ? (english ? 'Use the invited email address to join the workspace after verification.' : 'Utilisez l’adresse email invitée pour rejoindre l’espace après vérification.')
            : publicRegistration
              ? (english ? 'Verify your email, then start a 14-day trial for your first workspace.' : 'Vérifiez votre email, puis démarrez un essai de 14 jours pour votre premier espace.')
              : (english ? 'Private beta by invitation. Create your account with the approved email address.' : 'Bêta privée sur invitation. Créez votre compte avec l’adresse email autorisée.')
            : (english ? 'Sign in to your secure workspace.' : 'Connectez-vous à votre espace sécurisé.')}
        </p>
        {error && <p role="alert" className="mt-5 rounded-md y-status-danger p-3 text-sm text-[var(--y-danger)]">{error}</p>}
        {notice && <p role="status" className="mt-5 rounded-md y-status-success p-3 text-sm text-[var(--y-success)]">{notice}</p>}
        <form action={submit} className="mt-6 space-y-4">
          {signUp && <label className="block text-sm font-medium">{english ? 'Name' : 'Nom'}<input name="name" required minLength={2} maxLength={120} autoComplete="name" className="mt-1.5 h-11 w-full rounded-md border px-3 outline-none focus:border-primary" /></label>}
          <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className="mt-1.5 h-11 w-full rounded-md border px-3 outline-none focus:border-primary" /></label>
          <label className="block text-sm font-medium">{english ? 'Password' : 'Mot de passe'}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete={signUp ? 'new-password' : 'current-password'} className="mt-1.5 h-11 w-full rounded-md border px-3 outline-none focus:border-primary" /></label>
          <Button disabled={pending} className="h-11 w-full bg-card text-foreground hover:bg-card">{pending ? '…' : signUp ? (english ? 'Create account' : 'Créer mon compte') : (english ? 'Sign in' : 'Se connecter')}</Button>
        </form>
        {!signUp && <Link href="/forgot-password" className="mt-3 block text-center text-sm text-muted-foreground">{english ? 'Forgot password?' : 'Mot de passe oublié ?'}</Link>}
        {!signUp && <form action={emailLink} className="mt-4 space-y-3 rounded-md bg-muted p-4"><label className="block text-sm font-medium">{english ? 'Secure sign-in link' : 'Lien de connexion sécurisé'}<input name="magicEmail" type="email" required autoComplete="email" placeholder="Email" className="mt-1.5 h-11 w-full rounded-md border bg-card px-3 outline-none focus:border-primary" /></label><Button disabled={pending} type="submit" variant="outline" className="h-11 w-full">{english ? 'Email me a sign-in link' : 'Recevoir un lien par email'}</Button></form>}
        {googleEnabled && <><div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground"><span className="h-px flex-1 bg-muted" />{english ? 'or' : 'ou'}<span className="h-px flex-1 bg-muted" /></div><Button type="button" variant="outline" className="h-11 w-full" disabled={pending} onClick={google}>{english ? 'Continue with Google' : 'Continuer avec Google'}</Button></>}
        {!signUp && <Button type="button" variant="ghost" className="mt-2 h-11 w-full" disabled={pending} onClick={passkey}><KeyRound className="mr-2 size-4" />{english ? 'Use a passkey' : 'Utiliser une passkey'}</Button>}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {signUp ? (english ? 'Already registered?' : 'Déjà inscrit ?') : (english ? 'New to Yodev Ads?' : 'Nouveau sur Yodev Ads ?')}{' '}
          <Link className="font-medium text-muted-foreground" href={`${signUp ? '/sign-in' : '/sign-up'}${invitationQuery}`}>{signUp ? (english ? 'Sign in' : 'Se connecter') : (english ? 'Create an account' : 'Créer un compte')}</Link>
        </p>
      </div>
    </main>
  )
}
