import Link from 'next/link'

export const metadata = { title: 'Conditions d’utilisation' }

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm font-medium text-emerald-700">
        ← Ads by Yodev
      </Link>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">Conditions d’utilisation</h1>
      <div className="mt-8 space-y-6 leading-7 text-muted-foreground">
        <p>
          Ads by Yodev est un outil d’assistance au pilotage Google Ads. L’utilisateur reste responsable de ses campagnes,
          budgets, accès et validations.
        </p>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Accès aux comptes</h2>
          <p>
            Vous devez disposer des autorisations nécessaires sur chaque compte connecté. Vous vous engagez à respecter
            les conditions Google Ads et la législation applicable à vos campagnes.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Changements et approbations</h2>
          <p>
            Les écritures sont soumises à une validation technique puis à une approbation interne. Ce mécanisme réduit
            le risque opérationnel sans garantir le résultat commercial d’une campagne.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Disponibilité</h2>
          <p>
            Le service dépend de fournisseurs tiers, notamment Google, Clerk, Neon et Vercel. Les erreurs externes sont
            signalées avec les identifiants de requête disponibles pour faciliter le diagnostic.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Éditeur et contact</h2>
          <p>
            Le service est édité sous le nom commercial Yodev par Yoann Andrieux, entrepreneur individuel (EI), SIREN
            803 272 590. Contact : hello@yodev.fr.
          </p>
        </section>
        <p className="text-sm">Dernière mise à jour : 10 août 2026.</p>
      </div>
    </main>
  )
}
