import Link from 'next/link'
import { Activity, Database, Mail, Radar, Server, WalletCards } from 'lucide-react'
import type { PlatformComponent } from '@/lib/platform-status'
import type { CollectionPage } from '@/lib/collection-pagination'

export const componentCopy: Record<PlatformComponent, { fr: string; en: string; icon: typeof Server }> = {
  application: { fr: 'Application web', en: 'Web application', icon: Server },
  database: { fr: 'Base de données', en: 'Database', icon: Database },
  google_ads: { fr: 'Google Ads API', en: 'Google Ads API', icon: Radar },
  stripe: { fr: 'Paiements Stripe', en: 'Stripe payments', icon: WalletCards },
  email: { fr: 'Emails et notifications', en: 'Email and notifications', icon: Mail },
  scheduler: { fr: 'Jobs et planifications', en: 'Jobs and scheduling', icon: Activity },
}
export const statusCopy: Record<string, { fr: string; en: string }> = {
  unknown: { fr: 'État du service non vérifié', en: 'Service health unverified' },
  maintenance: { fr: 'Maintenance', en: 'Maintenance' },
  degraded: { fr: 'Performances dégradées', en: 'Degraded performance' },
  partial_outage: { fr: 'Incident partiel', en: 'Partial outage' },
  major_outage: { fr: 'Incident majeur', en: 'Major outage' },
  investigating: { fr: 'Investigation', en: 'Investigating' },
  identified: { fr: 'Cause identifiée', en: 'Identified' },
  monitoring: { fr: 'Surveillance', en: 'Monitoring' },
  resolved: { fr: 'Résolu', en: 'Resolved' },
}

export function PublicIncidentUpdates({ updates, locale }: { updates: { id: string; status: string; messageFr: string; messageEn: string; createdAt: Date }[]; locale: 'fr' | 'en' }) {
  return <div className="space-y-5">{updates.map((update) => <article key={update.id} data-public-incident-update>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{statusCopy[update.status]?.[locale] ?? update.status}</p>
      <time dateTime={update.createdAt.toISOString()} className="text-xs text-muted-foreground">{update.createdAt.toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'UTC' })} UTC</time>
    </div>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{locale === 'en' ? update.messageEn : update.messageFr}</p>
  </article>)}</div>
}

export function PublicHistoryPages({ page, path, locale, status }: { page: Pick<CollectionPage<unknown>, 'items' | 'total' | 'nextCursor' | 'started' | 'invalidCursor'>; path: string; locale: 'fr' | 'en'; status?: string }) {
  const english = locale === 'en', params = new URLSearchParams(status ? { status } : {})
  const first = `${path}?${params}`
  if (page.nextCursor) params.set('cursor', page.nextCursor)
  return <div className="my-5 flex flex-wrap items-center justify-between gap-4 text-sm">
    {page.invalidCursor ? <p role="alert">{english ? 'This page link is invalid or expired.' : 'Ce lien de page est invalide ou expiré.'}</p>
      : <p>{page.items.length.toLocaleString(locale)} {english ? 'shown' : 'affichés'} · {page.total.toLocaleString(locale)} {english ? 'results · newest first' : 'résultats · plus récents en premier'}</p>}
    <nav aria-label={english ? 'History pages' : 'Pages de l’historique'} className="flex flex-wrap gap-4">
      {(page.started || page.invalidCursor) && <Link prefetch={false} href={first} className="underline">{english ? 'Latest results' : 'Résultats récents'}</Link>}
      {page.nextCursor && <Link prefetch={false} href={`${path}?${params}`} className="underline">{english ? 'Older results' : 'Résultats plus anciens'}</Link>}
    </nav>
  </div>
}
