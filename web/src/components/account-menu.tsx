'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { LogOut, ShieldCheck } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

const subscribeToHydration = () => () => undefined
const clientSnapshot = () => true
const serverSnapshot = () => false

export function AccountMenu({ locale }: { locale: string }) {
  // Better Auth may populate its client cache before this streamed component hydrates.
  // Keep its first render identical to SSR, then expose the current client snapshot.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot)
  const session = authClient.useSession()
  const organizations = authClient.useListOrganizations()
  const english = locale === 'en'
  const [retryingDetails, setRetryingDetails] = useState(false)
  const detailsError = hydrated && Boolean(session.error || organizations.error)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(false)

  async function switchOrganization(organizationId: string) {
    if (switching || signingOut) return
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

  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)
  async function signOut() {
    if (signingOut || switching) return
    setSigningOut(true); setSignOutError(false)
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error('Sign out rejected')
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Remove the authenticated workspace document after session revocation.
      window.location.assign('/sign-in')
    } catch {
      setSignOutError(true)
      setSigningOut(false)
    }
  }

  async function retryDetails() {
    setRetryingDetails(true)
    try { await Promise.allSettled([session.refetch(), organizations.refetch()]) }
    finally { setRetryingDetails(false) }
  }

  return (
    <div className="flex items-center gap-2">
      {hydrated && (organizations.data?.length ?? 0) > 1 && (
        <select disabled={switching || signingOut} aria-busy={switching} aria-label={english ? 'Active workspace' : 'Workspace actif'} value={session.data?.session.activeOrganizationId ?? ''} onChange={(event) => switchOrganization(event.target.value)} className="h-9 max-w-28 sm:max-w-48 rounded-lg border bg-card px-2 text-sm">
          {organizations.data?.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
        </select>
      )}
      {(switchError || signOutError || detailsError) && <div role="alert" className="absolute right-4 top-16 z-50 max-w-sm space-y-2 rounded-lg border bg-card p-3 text-xs text-[var(--y-danger)]">
        {switchError && <p>{english ? 'Unable to switch workspace. Please try again.' : 'Impossible de changer d’espace. Réessayez.'}</p>}
        {signOutError && <p>{english ? 'Unable to sign out. Please try again.' : 'Impossible de vous déconnecter. Réessayez.'}</p>}
        {detailsError && <><p>{english ? 'Your account details could not be loaded. Please try again in a moment.' : 'Les informations du compte n’ont pas pu être chargées. Réessayez dans un instant.'}</p><button type="button" disabled={retryingDetails} className="font-medium underline" onClick={retryDetails}>{retryingDetails ? '…' : english ? 'Reload account details' : 'Recharger les informations du compte'}</button></>}
      </div>}
      <Link href="/account" aria-label={english ? 'Account security' : 'Sécurité du compte'} title={hydrated ? session.data?.user.email ?? '' : ''} className="grid size-9 place-items-center rounded-md bg-card text-muted-foreground"><ShieldCheck className="size-4" /></Link>
      <button disabled={signingOut || switching} onClick={signOut} title={english ? 'Sign out' : 'Se déconnecter'} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="size-4" /></button>
    </div>
  )
}
