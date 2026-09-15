import Link from 'next/link'
import { Cable, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyState({
  title = 'Connectez votre MCC Google Ads',
  description = 'Une fois connecté, Yodev Ads synchronise vos comptes clients et affiche leurs performances en direct.',
  locale = 'fr',
  showConnectionAction = true,
}: {
  title?: string
  description?: string
  locale?: 'fr' | 'en'
  showConnectionAction?: boolean
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card px-6 py-16 text-center ">
      <span className="mx-auto grid size-14 place-items-center rounded-md bg-violet-50 text-violet-700">
        <Cable />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-md leading-7 text-muted-foreground">{description}</p>
      {showConnectionAction && <Button asChild className="mt-6 bg-[var(--brand-accent)] text-foreground">
        <Link href="/settings">
          {locale === 'en' ? 'Connection settings' : 'Configurer la connexion'} <ArrowRight className="ml-1 size-4" />
        </Link>
      </Button>}
    </div>
  )
}
