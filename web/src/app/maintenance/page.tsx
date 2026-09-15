import Link from 'next/link'
import { Radar, Wrench } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function MaintenancePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-card p-6 text-muted-foreground">
      <section className="w-full max-w-xl rounded-md border border-border bg-card p-8 text-center ">
        <span className="mx-auto grid size-14 place-items-center rounded-md bg-primary text-primary-foreground">
          <Radar className="size-7" aria-hidden="true" />
        </span>
        <p className="mt-6 font-mono text-xs font-semibold uppercase tracking-[.2em] text-primary">
          Yodev Ads
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Maintenance planifiée en cours</h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Les écritures et les analyses automatiques sont momentanément suspendues pendant la bascule.
          Vos données restent conservées et isolées.
        </p>
        <div className="mt-7 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground">
          <Wrench className="size-4" aria-hidden="true" />
          Réessayez dans quelques minutes
        </div>
        <div className="mt-8">
          <Link href="/privacy" className="text-sm text-primary hover:underline">
            Politique de confidentialité
          </Link>
        </div>
      </section>
    </main>
  )
}
