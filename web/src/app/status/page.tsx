import type { Metadata } from 'next'
import Link from 'next/link'
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, Mail, Radar, Server, WalletCards } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { getLocale } from '@/lib/locale'
import { PLATFORM_COMPONENTS, type PlatformComponent } from '@/lib/platform-status'
import { getPublicPlatformStatus } from '@/lib/public-status'

export const metadata: Metadata = { title: 'Status' }

const componentCopy: Record<PlatformComponent, { fr: string; en: string; icon: typeof Server }> = {
  application: { fr: 'Application web', en: 'Web application', icon: Server },
  database: { fr: 'Base de données', en: 'Database', icon: Database },
  google_ads: { fr: 'Google Ads API', en: 'Google Ads API', icon: Radar },
  stripe: { fr: 'Paiements Stripe', en: 'Stripe payments', icon: WalletCards },
  email: { fr: 'Emails et notifications', en: 'Email and notifications', icon: Mail },
  scheduler: { fr: 'Jobs et planifications', en: 'Jobs and scheduling', icon: Activity },
}

const statusCopy: Record<string, { fr: string; en: string }> = {
  operational: { fr: 'Opérationnel', en: 'Operational' },
  maintenance: { fr: 'Maintenance', en: 'Maintenance' },
  degraded: { fr: 'Performances dégradées', en: 'Degraded performance' },
  partial_outage: { fr: 'Incident partiel', en: 'Partial outage' },
  major_outage: { fr: 'Incident majeur', en: 'Major outage' },
  investigating: { fr: 'Investigation', en: 'Investigating' },
  identified: { fr: 'Cause identifiée', en: 'Identified' },
  monitoring: { fr: 'Surveillance', en: 'Monitoring' },
  resolved: { fr: 'Résolu', en: 'Resolved' },
}

export default async function StatusPage() {
  const [locale, snapshot] = await Promise.all([
    getLocale(),
    getPublicPlatformStatus().catch(() => null),
  ])
  const english = locale === 'en'
  const overall = snapshot?.summary.overall
  const healthy = overall === 'operational'

  return <main className="min-h-screen bg-[#f3f6f8] px-4 py-10 text-[#0d1722] sm:px-7">
    <div className="mx-auto max-w-4xl">
      <header className="flex items-center justify-between"><Link href="/" className="flex items-center gap-3 font-semibold"><span className="grid size-10 place-items-center rounded-xl bg-[#19A58F]"><Radar className="size-5" /></span>Ads by Yodev</Link><Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">{english ? 'Sign in' : 'Connexion'}</Link></header>
      <section className={`mt-10 rounded-3xl p-7 text-white ${healthy ? 'bg-[#0d1722]' : snapshot ? 'bg-amber-700' : 'bg-slate-700'}`}>
        <div className="flex items-start gap-4">{healthy ? <CheckCircle2 className="mt-1 size-7 text-emerald-400" /> : <AlertTriangle className="mt-1 size-7 text-amber-200" />}<div><p className="text-xs font-semibold uppercase tracking-[.16em] text-white/60">{english ? 'Service status' : 'État du service'}</p><h1 className="mt-2 text-3xl font-semibold">{snapshot ? (statusCopy[overall!]?.[english ? 'en' : 'fr'] ?? overall) : (english ? 'Status temporarily unavailable' : 'Statut temporairement indisponible')}</h1><p className="mt-2 text-sm leading-6 text-white/70">{snapshot ? (english ? `Checked ${snapshot.checkedAt.toLocaleString('en-GB')}.` : `Vérifié le ${snapshot.checkedAt.toLocaleString('fr-FR')}.`) : (english ? 'The status database could not be queried. This message does not imply that the application is operational.' : 'La base de statut ne peut pas être interrogée. Ce message ne signifie pas que l’application est opérationnelle.')}</p></div></div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2">{PLATFORM_COMPONENTS.map((component) => {
        const status = snapshot?.summary.components[component]
        const Icon = componentCopy[component].icon
        return <Card key={component} className="shadow-none"><CardContent className="flex items-center justify-between p-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-slate-100"><Icon className="size-5" /></span><div><p className="font-medium">{componentCopy[component][english ? 'en' : 'fr']}</p><p className="mt-1 text-xs text-muted-foreground">{status ? statusCopy[status]?.[english ? 'en' : 'fr'] ?? status : (english ? 'Unknown' : 'Inconnu')}</p></div></div><span className={`size-2.5 rounded-full ${status === 'operational' ? 'bg-emerald-500' : status ? 'bg-amber-500' : 'bg-slate-400'}`} /></CardContent></Card>
      })}</section>

      <section className="mt-10"><h2 className="text-xl font-semibold">{english ? 'Incident history' : 'Historique des incidents'}</h2><div className="mt-4 space-y-4">{snapshot?.incidents.map(({ incident, updates }) => <Card key={incident.id} className="[content-visibility:auto] shadow-none"><CardContent className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><Badge variant={incident.status === 'resolved' ? 'outline' : 'secondary'}>{statusCopy[incident.status]?.[english ? 'en' : 'fr'] ?? incident.status}</Badge><Badge variant="outline">{componentCopy[incident.component as PlatformComponent]?.[english ? 'en' : 'fr'] ?? incident.component}</Badge></div><h3 className="mt-3 font-semibold">{english ? incident.titleEn : incident.titleFr}</h3></div><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{incident.startedAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}</span></div><div className="mt-5 space-y-4 border-t pt-4">{updates.map((update) => <article key={update.id}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{statusCopy[update.status]?.[english ? 'en' : 'fr'] ?? update.status}</p><time className="text-xs text-muted-foreground">{update.createdAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{english ? update.messageEn : update.messageFr}</p></article>)}</div></CardContent></Card>)}{snapshot && snapshot.incidents.length === 0 && <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">{english ? 'No public incident during the last 90 days.' : 'Aucun incident public au cours des 90 derniers jours.'}</div>}</div></section>
    </div>
  </main>
}
