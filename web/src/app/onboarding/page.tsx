import { redirect } from 'next/navigation'
import { Check, Radar, ShieldCheck, Sparkles } from 'lucide-react'
import { createWorkspace } from '@/app/onboarding/actions'
import { currentAuthSession } from '@/lib/workspace'
import { getLocale } from '@/lib/locale'

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [session, locale, query] = await Promise.all([currentAuthSession(), getLocale(), searchParams])
  if (!session) redirect('/sign-in')
  if (session.activeOrganizationId) redirect('/dashboard')
  const english = locale === 'en'
  return (
    <main className="grid min-h-screen place-items-center bg-[#0d1722] p-6 text-white">
      <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#19A58F] text-[#0d1722]"><Radar /></span>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-.035em]">{english ? 'Welcome to Ads by Yodev' : 'Bienvenue dans Ads by Yodev'}</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/55">{english ? 'Create the secure workspace that will contain your clients, monitors and agency identity.' : 'Créez l’espace sécurisé qui contiendra vos clients, vos vigies et votre identité d’agence.'}</p>
          <div className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            {(english ? ['Data isolated by organization', 'Roles and sessions managed with Better Auth', 'Google Ads writes subject to approval'] : ['Données cloisonnées par organisation', 'Rôles et sessions gérés avec Better Auth', 'Écritures Google Ads sous approbation']).map((item) => (
              <p key={item} className="flex items-center gap-3 text-sm text-white/70"><span className="grid size-6 place-items-center rounded-full bg-[#19A58F]/12 text-[#19A58F]"><Check className="size-3.5" /></span>{item}</p>
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-white p-7 text-[#0d1722] shadow-2xl shadow-black/20">
          <div className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#19A58F]">{english ? 'Step 1 of 3' : 'Étape 1 sur 3'}</p><p className="mt-1 font-semibold">{english ? 'Your agency workspace' : 'Votre espace agence'}</p></div><div className="flex gap-2"><Sparkles className="size-4 text-[#19A58F]" /><ShieldCheck className="size-4 text-[#19A58F]" /></div></div>
          {query.error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{query.error}</p>}
          {!session.user.emailVerified && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{english ? 'Verify your email before creating the workspace.' : 'Vérifiez votre email avant de créer le workspace.'}</p>}
          <form action={createWorkspace} className="space-y-4">
            <label className="block text-sm font-medium">{english ? 'Workspace name' : 'Nom de l’espace'}<input name="name" required minLength={2} maxLength={120} defaultValue={session.user.name ? `${session.user.name}` : ''} className="mt-1.5 h-11 w-full rounded-xl border px-3 outline-none focus:border-[#19A58F]" /></label>
            <label className="block text-sm font-medium">{english ? 'Identifier' : 'Identifiant'}<input name="slug" maxLength={80} placeholder="mon-agence" className="mt-1.5 h-11 w-full rounded-xl border px-3 outline-none focus:border-[#19A58F]" /></label>
            <button disabled={!session.user.emailVerified} className="h-11 w-full rounded-xl bg-[#19A58F] font-semibold text-[#0d1722] disabled:cursor-not-allowed disabled:opacity-50">{english ? 'Create secure workspace' : 'Créer l’espace sécurisé'}</button>
          </form>
        </div>
      </div>
    </main>
  )
}
