import { redirect } from 'next/navigation'
import { Check, Radar, ShieldCheck, Sparkles } from 'lucide-react'
import { createWorkspace } from '@/app/onboarding/actions'
import { currentAuthSession } from '@/lib/workspace'
import { getLocale } from '@/lib/locale'
import { resolveWorkspaceSelection } from '@/lib/workspace-selection'

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [session, locale, query] = await Promise.all([currentAuthSession(), getLocale(), searchParams])
  if (!session) redirect('/sign-in')
  if (await resolveWorkspaceSelection({ sessionId: session.id, userId: session.userId })) redirect('/dashboard')
  const english = locale === 'en'
  return (
    <main className="grid min-h-screen place-items-center bg-card p-6 text-foreground">
      <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-md bg-primary text-primary-foreground"><Radar /></span>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-.035em]">{english ? 'Welcome to Yodev Ads' : 'Bienvenue dans Yodev Ads'}</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{english ? 'Create the secure workspace that will contain your clients, monitors and agency identity.' : 'Créez l’espace sécurisé qui contiendra vos clients, vos vigies et votre identité d’agence.'}</p>
          <div className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            {(english ? ['Data isolated by organization', 'Individual accounts and controlled access', 'Google Ads changes subject to approval'] : ['Données cloisonnées par organisation', 'Comptes individuels et accès contrôlés', 'Modifications Google Ads sous approbation']).map((item) => (
              <p key={item} className="flex items-center gap-3 text-sm text-muted-foreground"><span className="grid size-6 place-items-center rounded-md bg-primary text-primary"><Check className="size-3.5" /></span>{item}</p>
            ))}
          </div>
        </div>
        <div className="rounded-md bg-card p-7 text-foreground  shadow-black/20">
          <div className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-primary">{english ? 'Step 1 of 3' : 'Étape 1 sur 3'}</p><p className="mt-1 font-semibold">{english ? 'Your agency workspace' : 'Votre espace agence'}</p></div><div className="flex gap-2"><Sparkles className="size-4 text-primary" /><ShieldCheck className="size-4 text-primary" /></div></div>
          {query.error && <p role="alert" className="mb-4 rounded-md y-status-danger p-3 text-sm text-[var(--y-danger)]">{query.error}</p>}
          {!session.user.emailVerified && <p className="mb-4 rounded-md y-status-warning p-3 text-sm text-[var(--y-warning)]">{english ? 'Verify your email before creating the workspace.' : 'Vérifiez votre email avant de créer le workspace.'}</p>}
          <form action={createWorkspace} className="space-y-4">
            <label className="block text-sm font-medium">{english ? 'Workspace name' : 'Nom de l’espace'}<input name="name" required minLength={2} maxLength={120} defaultValue={session.user.name ? `${session.user.name}` : ''} className="mt-1.5 h-11 w-full rounded-md border px-3 outline-none focus:border-primary" /></label>
            <label className="block text-sm font-medium">{english ? 'Identifier' : 'Identifiant'}<input name="slug" maxLength={80} placeholder="mon-agence" className="mt-1.5 h-11 w-full rounded-md border px-3 outline-none focus:border-primary" /></label>
            <button disabled={!session.user.emailVerified} className="h-11 w-full rounded-md bg-primary font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{english ? 'Create secure workspace' : 'Créer l’espace sécurisé'}</button>
          </form>
        </div>
      </div>
    </main>
  )
}
