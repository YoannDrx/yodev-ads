import { Suspense } from 'react'
import { InvitationPanel } from '@/components/invitation-panel'
import { getLocale } from '@/lib/locale'

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const [query, locale] = await Promise.all([searchParams, getLocale()])
  return <Suspense><InvitationPanel key={typeof query.id === 'string' ? query.id : 'invalid'} locale={locale} /></Suspense>
}
