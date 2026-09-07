import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountMenu } from '@/components/account-menu'
import { AuthSecurityControls } from '@/components/auth-security-controls'
import { currentAuthSession } from '@/lib/workspace'
import { getLocale } from '@/lib/locale'

export default async function AccountPage() {
  const [session, locale] = await Promise.all([currentAuthSession(), getLocale()])
  if (!session) redirect('/sign-in?returnTo=%2Faccount')
  const english = locale === 'en'
  return <main className="min-h-screen bg-[#f3f6f8] px-4 py-8 text-[#0d1722]">
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3"><Link href={session.activeOrganizationId ? '/dashboard' : '/onboarding'} className="text-sm font-medium text-[#168977] underline">{english ? 'Back to my workspace' : 'Retour à mon espace'}</Link><AccountMenu locale={locale} /></header>
      <section className="rounded-3xl border bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold">{english ? 'Account security' : 'Sécurité du compte'}</h1>
        <p className="mt-2 break-all text-sm text-slate-500">{session.user.email}</p>
        <p className="mt-2 text-sm">{session.user.emailVerified ? (english ? 'Email verified' : 'Email vérifié') : (english ? 'Email verification required' : 'Vérification de l’email requise')}</p>
        <p className="mt-4 text-sm leading-6 text-slate-600">{english ? 'These settings protect your personal account across all your workspaces.' : 'Ces réglages protègent votre compte personnel dans tous vos espaces.'}</p>
        {session.activeOrganizationId && <Link href="/account/notifications" className="mt-4 inline-block text-sm font-medium text-[#168977] underline">{english ? 'My task notifications' : 'Mes notifications de tâches'}</Link>}
        <AuthSecurityControls locale={locale} />
        <Link href="/forgot-password" className="mt-6 inline-block text-sm text-[#168977] underline">{english ? 'Reset my password' : 'Réinitialiser mon mot de passe'}</Link>
      </section>
    </div>
  </main>
}
