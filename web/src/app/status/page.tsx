import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, CircleHelp, Clock3, Radar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { componentCopy, statusCopy, PublicHistoryPages, PublicIncidentUpdates } from '@/components/platform-status-content'
import { getLocale } from '@/lib/locale'
import { PLATFORM_COMPONENTS, type PlatformComponent } from '@/lib/platform-status'
import { getPublicPlatformStatus } from '@/lib/public-status'

export const metadata: Metadata = { title: 'Status' }

export default async function StatusPage({ searchParams }: { searchParams: Promise<{ cursor?: string; status?: string }> }) {
  const query = await searchParams
  const [locale, snapshot] = await Promise.all([getLocale(), getPublicPlatformStatus(new Date(), query).catch(() => null)])
  const english = locale === 'en', declaredIncident = snapshot && snapshot.summary.activeIncidentCount > 0
  const statusFilter = query.status === 'active' || query.status === 'resolved' ? query.status : undefined
  return <main className="min-h-screen bg-[#f3f6f8] px-4 py-10 text-[#0d1722] sm:px-7">
    <div className="mx-auto max-w-4xl">
      <header className="flex items-center justify-between"><Link href="/" className="flex items-center gap-3 font-semibold"><span className="grid size-10 place-items-center rounded-xl bg-[#19A58F]"><Radar className="size-5" /></span>Ads by Yodev</Link><Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">{english ? 'Sign in' : 'Connexion'}</Link></header>
      <section className={`mt-10 rounded-3xl p-7 text-white ${declaredIncident ? 'bg-amber-700' : 'bg-slate-700'}`}>
        <div className="flex items-start gap-4">
          {declaredIncident ? <AlertTriangle className="mt-1 size-7 shrink-0" /> : <CircleHelp className="mt-1 size-7 shrink-0" />}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-white/70">{english ? 'Service status' : 'État du service'}</p>
            <h1 className="mt-2 text-3xl font-semibold">{snapshot ? statusCopy[snapshot.summary.overall][locale] : (english ? 'Status temporarily unavailable' : 'Statut temporairement indisponible')}</h1>
            <p className="mt-3 text-sm leading-6 text-white/85">{english ? 'This page lists declared public incidents. Without a recent verified service check, the absence of an incident does not establish service health.' : 'Cette page recense les incidents publics déclarés. Sans contrôle récent vérifié, l’absence d’incident ne permet pas de conclure au bon fonctionnement du service.'}</p>
            <p className="mt-2 text-sm leading-6 text-white/85">{snapshot ? (english ? `Registry consulted ${snapshot.consultedAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC. ${snapshot.summary.activeIncidentCount} active incident(s).` : `Registre consulté le ${snapshot.consultedAt.toLocaleString('fr-FR', { timeZone: 'UTC' })} UTC. ${snapshot.summary.activeIncidentCount} incident(s) actif(s).`) : (english ? 'The incident registry could not be queried.' : 'Le registre des incidents ne peut pas être interrogé.')}</p>
          </div>
        </div>
      </section>
      <section className="mt-6 grid gap-3 sm:grid-cols-2">{PLATFORM_COMPONENTS.map((component) => {
        const status = snapshot?.summary.components[component], Icon = componentCopy[component].icon
        return <Card key={component} className="shadow-none"><CardContent className="flex items-center justify-between gap-3 p-5"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100"><Icon className="size-5" /></span><div><p className="font-medium">{componentCopy[component][locale]}</p><p className="mt-1 text-xs text-muted-foreground">{status ? statusCopy[status][locale] : (english ? 'Unknown' : 'Inconnu')}</p></div></div><span className={`size-2.5 shrink-0 rounded-full ${status && status !== 'unknown' ? 'bg-amber-500' : 'bg-slate-400'}`} /></CardContent></Card>
      })}</section>
      <section className="mt-10">
        <h2 className="text-xl font-semibold">{english ? 'Incident history' : 'Historique des incidents'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{english ? 'All unresolved public incidents and incidents started in the last 90 days. The service summary always includes every unresolved incident, independently of the page and filter.' : 'Tous les incidents publics non résolus et ceux commencés dans les 90 derniers jours. La synthèse prend toujours en compte tous les incidents non résolus, indépendamment de la page et du filtre.'}</p>
        <nav aria-label={english ? 'Incident filter' : 'Filtrer les incidents'} className="my-4 flex flex-wrap gap-4 text-sm">
          {([['', 'Tous', 'All'], ['active', 'Actifs', 'Active'], ['resolved', 'Résolus', 'Resolved']] as const).map(([value, fr, en]) => <Link key={value} prefetch={false} aria-current={(statusFilter ?? '') === value ? 'page' : undefined} href={value ? `/status?status=${value}` : '/status'} className="underline aria-[current=page]:font-semibold">{english ? en : fr}</Link>)}
        </nav>
        {snapshot && <PublicHistoryPages page={snapshot.page} path="/status" locale={locale} status={statusFilter} />}
        <div className="mt-4 space-y-4">{snapshot?.page.items.map(({ incident, updates, hasMoreUpdates }) => <Card key={incident.id} className="[content-visibility:auto] shadow-none" data-public-incident>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div>
              <div className="flex flex-wrap gap-2"><Badge variant={incident.status === 'resolved' ? 'outline' : 'secondary'}>{statusCopy[incident.status]?.[locale] ?? incident.status}</Badge><Badge variant="outline">{componentCopy[incident.component as PlatformComponent]?.[locale] ?? incident.component}</Badge></div>
              <h3 className="mt-3 break-words font-semibold [overflow-wrap:anywhere]">{english ? incident.titleEn : incident.titleFr}</h3>
            </div><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{incident.startedAt.toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: 'UTC' })} UTC</span></div>
            <div className="mt-5 border-t pt-4"><PublicIncidentUpdates updates={updates} locale={locale} /></div>
            <Link prefetch={false} href={`/status/${incident.id}`} className="mt-4 inline-block text-sm underline">{hasMoreUpdates ? (english ? 'Latest 3 updates · read complete history' : '3 derniers messages · lire tout l’historique') : (english ? 'Read incident history' : 'Lire l’historique de l’incident')}</Link>
          </CardContent>
        </Card>)}</div>
        {snapshot && !snapshot.page.invalidCursor && snapshot.page.total === 0 && <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">{english ? 'No declared public incident matches this filter and period.' : 'Aucun incident public déclaré ne correspond à ce filtre et à cette période.'}</p>}
      </section>
    </div>
  </main>
}
