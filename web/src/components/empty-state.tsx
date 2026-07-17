import Link from 'next/link'
import { Cable, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyState({ title = 'Connectez votre MCC Google Ads', description = 'Une fois connecté, VigieAds synchronise vos comptes clients et affiche leurs performances en direct.' }: { title?: string; description?: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#d9d4e8] bg-white px-6 py-16 text-center shadow-sm">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-violet-50 text-violet-700"><Cable /></span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-md leading-7 text-muted-foreground">{description}</p>
      <Button asChild className="mt-6 bg-[var(--brand-accent)] text-white"><Link href="/settings">Configurer la connexion <ArrowRight className="ml-1 size-4" /></Link></Button>
    </div>
  )
}
