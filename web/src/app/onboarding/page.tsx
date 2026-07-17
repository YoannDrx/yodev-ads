import { auth } from '@clerk/nextjs/server'
import { CreateOrganization } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { Radar } from 'lucide-react'

export default async function OnboardingPage() {
  const { userId, orgId } = await auth()
  if (!userId) redirect('/sign-in')
  if (orgId) redirect('/dashboard')
  return (
    <main className="grid min-h-screen place-items-center bg-[#f8f7ff] p-6">
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#635bff] text-white"><Radar /></span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Créez votre espace agence</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">Chaque organisation possède ses clients, sa marque, ses rôles et ses connexions isolées.</p>
        </div>
        <CreateOrganization afterCreateOrganizationUrl="/dashboard" />
      </div>
    </main>
  )
}
