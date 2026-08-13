import { Suspense } from 'react'
import { InvitationPanel } from '@/components/invitation-panel'
import { getLocale } from '@/lib/locale'

export default async function InvitationPage() {
  return <Suspense><InvitationPanel locale={await getLocale()} /></Suspense>
}
