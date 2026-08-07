import Link from 'next/link'
import { Radar, Wrench } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function MaintenancePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#0C1117] p-6 text-[#F7F5F0]">
      <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#19A58F] text-[#0C1117]">
          <Radar className="size-7" aria-hidden="true" />
        </span>
        <p className="mt-6 font-mono text-xs font-semibold uppercase tracking-[.2em] text-[#67D8C4]">
          Ads by Yodev
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Maintenance planifiée en cours</h1>
        <p className="mt-4 leading-7 text-white/65">
          Les écritures et les analyses automatiques sont momentanément suspendues pendant la bascule.
          Vos données restent conservées et isolées.
        </p>
        <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70">
          <Wrench className="size-4" aria-hidden="true" />
          Réessayez dans quelques minutes
        </div>
        <div className="mt-8">
          <Link href="/privacy" className="text-sm text-[#67D8C4] hover:underline">
            Politique de confidentialité
          </Link>
        </div>
      </section>
    </main>
  )
}
