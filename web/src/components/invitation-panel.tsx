'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function InvitationPanel({ locale }: { locale: string }) {
  const english = locale === 'en'
  const invitationId = useSearchParams().get('id')
  const session = authClient.useSession()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function accept() {
    if (!invitationId) return
    setPending(true); setError(null)
    const result = await authClient.organization.acceptInvitation({ invitationId })
    setPending(false)
    if (result.error) return setError(result.error.message || (english ? 'Invitation could not be accepted.' : 'Impossible d’accepter l’invitation.'))
    await authClient.organization.setActive({ organizationId: result.data?.member.organizationId })
    router.push('/dashboard'); router.refresh()
  }
  return <main className="grid min-h-screen place-items-center bg-[#f3f6f8] p-6"><div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-xl"><h1 className="text-2xl font-semibold">{english ? 'Workspace invitation' : 'Invitation à un workspace'}</h1><p className="mt-3 text-sm text-slate-500">{english ? 'The invitation is bound to the verified email address that received it.' : 'Cette invitation est liée à l’adresse email vérifiée qui l’a reçue.'}</p>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{!invitationId ? <p className="mt-5 text-sm text-red-700">{english ? 'Invalid invitation link.' : 'Lien d’invitation invalide.'}</p> : session.isPending ? <p className="mt-5 text-sm">…</p> : !session.data ? <Button asChild className="mt-6"><Link href="/sign-in">{english ? 'Sign in to continue' : 'Se connecter pour continuer'}</Link></Button> : <Button disabled={pending} onClick={accept} className="mt-6">{pending ? '…' : english ? 'Accept invitation' : 'Accepter l’invitation'}</Button>}</div></main>
}
