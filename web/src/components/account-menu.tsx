'use client'

import { useRouter } from 'next/navigation'
import { LogOut, ShieldCheck } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

export function AccountMenu({ locale }: { locale: string }) {
  const router = useRouter()
  const session = authClient.useSession()
  const organizations = authClient.useListOrganizations()
  const english = locale === 'en'

  async function switchOrganization(organizationId: string) {
    await authClient.organization.setActive({ organizationId })
    router.push('/dashboard')
    router.refresh()
  }

  async function signOut() {
    await authClient.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      {(organizations.data?.length ?? 0) > 1 && (
        <select aria-label={english ? 'Active workspace' : 'Workspace actif'} value={session.data?.session.activeOrganizationId ?? ''} onChange={(event) => switchOrganization(event.target.value)} className="hidden h-9 max-w-48 rounded-lg border bg-white px-2 text-sm sm:block">
          {organizations.data?.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
        </select>
      )}
      <span title={session.data?.user.email ?? ''} className="grid size-9 place-items-center rounded-full bg-[#e6f8ef] text-[#168977]"><ShieldCheck className="size-4" /></span>
      <button onClick={signOut} title={english ? 'Sign out' : 'Se déconnecter'} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><LogOut className="size-4" /></button>
    </div>
  )
}
