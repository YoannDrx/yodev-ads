'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

export function AccountMenu({ locale }: { locale: string }) {
  const router = useRouter()
  const session = authClient.useSession()
  const organizations = authClient.useListOrganizations()
  const english = locale === 'en'
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(false)

  async function switchOrganization(organizationId: string) {
    if (switching) return
    setSwitching(true)
    setSwitchError(false)
    try {
      const result = await authClient.organization.setActive({ organizationId })
      if (result.error) throw new Error('Workspace switch rejected')
      // Discard the previous organization's router cache and in-flight RSC tree.
      // push + refresh can interleave old permissions with the new session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Changing tenants requires a fresh document; covered by the two-workspace browser regression.
      window.location.assign('/dashboard')
    } catch {
      setSwitchError(true)
      setSwitching(false)
    }
  }

  async function signOut() {
    await authClient.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      {(organizations.data?.length ?? 0) > 1 && (
        <select disabled={switching} aria-busy={switching} aria-label={english ? 'Active workspace' : 'Workspace actif'} value={session.data?.session.activeOrganizationId ?? ''} onChange={(event) => switchOrganization(event.target.value)} className="h-9 max-w-28 sm:max-w-48 rounded-lg border bg-white px-2 text-sm">
          {organizations.data?.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
        </select>
      )}
      {switchError && <span role="alert" className="absolute right-4 top-16 rounded-lg border bg-white p-3 text-xs text-red-700">{english ? 'Unable to switch workspace. Please try again.' : 'Impossible de changer d’espace. Réessayez.'}</span>}
      <span title={session.data?.user.email ?? ''} className="grid size-9 place-items-center rounded-full bg-[#e6f8ef] text-[#168977]"><ShieldCheck className="size-4" /></span>
      <button onClick={signOut} title={english ? 'Sign out' : 'Se déconnecter'} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><LogOut className="size-4" /></button>
    </div>
  )
}
