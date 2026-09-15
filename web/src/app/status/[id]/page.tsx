import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { PublicHistoryPages, PublicIncidentUpdates, statusCopy } from '@/components/platform-status-content'
import { getLocale } from '@/lib/locale'
import { getPublicPlatformIncident } from '@/lib/public-status'

export const metadata: Metadata = { title: 'Incident history' }

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const [{ id }, query, locale] = await Promise.all([params, searchParams, getLocale()])
  const result = await getPublicPlatformIncident(id, query)
  if (!result) notFound()
  const english = locale === 'en'
  return <main className="min-h-screen bg-card px-4 py-10 text-foreground sm:px-7">
    <div className="mx-auto max-w-4xl">
      <Link href="/status" className="text-sm underline">{english ? 'Back to service status' : 'Revenir au statut du service'}</Link>
      <h1 className="mt-6 break-words text-3xl font-semibold [overflow-wrap:anywhere]">{english ? result.incident.titleEn : result.incident.titleFr}</h1>
      <Badge className="mt-3" variant="outline">{statusCopy[result.incident.status]?.[locale] ?? result.incident.status}</Badge>
      <PublicHistoryPages page={result.page} path={`/status/${id}`} locale={locale} />
      <section className="rounded-md border bg-card p-5"><PublicIncidentUpdates updates={result.page.items} locale={locale} />
        {!result.page.invalidCursor && result.page.total === 0 && <p className="text-sm text-muted-foreground">{english ? 'No update has been published for this incident.' : 'Aucun message n’a été publié pour cet incident.'}</p>}
      </section>
    </div>
  </main>
}
