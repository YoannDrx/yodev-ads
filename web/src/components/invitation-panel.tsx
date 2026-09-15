'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { recoverAcceptedInvitation } from '@/app/invitation/actions'
import { invitationErrorMessage } from '@/lib/invitation-error'

export function InvitationPanel({ locale }: { locale: string }) {
  const english = locale === 'en'
  const invitationIds = useSearchParams().getAll('id')
  const invitationId = invitationIds.length === 1 && /^[a-zA-Z0-9_-]{1,128}$/.test(invitationIds[0]) ? invitationIds[0] : null
  const session = authClient.useSession()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [acceptedOrganizationId, setAcceptedOrganizationId] = useState<string | null>(null)
  const signInUrl = `/sign-in?returnTo=${encodeURIComponent(`/invitation?id=${invitationId ?? ''}`)}`
  async function accept() {
    if (!invitationId || pending) return
    setPending(true); setError(null)
    try {
      let organizationId = acceptedOrganizationId
      if (!organizationId) {
        let result: Awaited<ReturnType<typeof authClient.organization.acceptInvitation>> | undefined
        try { result = await authClient.organization.acceptInvitation({ invitationId }) } catch {
          // The server may have accepted the invitation before the response was lost.
        }
        organizationId = result?.data?.member.organizationId ?? await recoverAcceptedInvitation(invitationId)
        if (!organizationId) return setError(invitationErrorMessage(result?.error?.code, locale))
        setAcceptedOrganizationId(organizationId)
      }
      const active = await authClient.organization.setActive({ organizationId })
      if (active.error) return setError(english ? 'Invitation accepted, but the workspace could not be opened. Try again.' : 'Invitation acceptée, mais l’espace n’a pas pu être ouvert. Réessayez.')
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Invitation changes tenants; discard the previous workspace document.
      window.location.assign('/dashboard')
    } catch {
      setError(english ? 'Unable to complete the request. Check your connection and try again.' : 'Impossible de terminer la demande. Vérifiez votre connexion et réessayez.')
    } finally { setPending(false) }
  }

  return <main className="grid min-h-screen place-items-center bg-card p-6"><div className="w-full max-w-md rounded-md bg-card p-7 text-center "><h1 className="text-2xl font-semibold">{english ? 'Workspace invitation' : 'Invitation à un workspace'}</h1><p className="mt-3 text-sm text-muted-foreground">{english ? 'The invitation is bound to the verified email address that received it.' : 'Cette invitation est liée à l’adresse email vérifiée qui l’a reçue.'}</p>{error && <p role="alert" className="mt-4 rounded-md y-status-danger p-3 text-sm text-[var(--y-danger)]">{error}</p>}{!invitationId ? <p className="mt-5 text-sm text-[var(--y-danger)]">{english ? 'Invalid invitation link.' : 'Lien d’invitation invalide.'}</p> : session.isPending ? <p className="mt-5 text-sm">…</p> : !session.data ? <Button asChild className="mt-6"><Link href={signInUrl}>{english ? 'Sign in to continue' : 'Se connecter pour continuer'}</Link></Button> : <Button disabled={pending} onClick={accept} className="mt-6">{pending ? '…' : english ? 'Accept invitation' : 'Accepter l’invitation'}</Button>}</div></main>
}
