import Link from 'next/link'

export const metadata = { title: 'Mentions légales' }

const sections = [
  {
    title: 'Éditeur',
    content:
      'Ads by Yodev est édité sous le nom commercial Yodev par Yoann Andrieux, entrepreneur individuel (EI).',
  },
  {
    title: 'Immatriculation et activité',
    content:
      'SIREN : 803 272 590. SIRET : 803 272 590 00024. Activité principale : programmation informatique (code NAF/APE 62.01Z).',
  },
  {
    title: 'Régime de TVA',
    content: 'TVA non applicable, article 293 B du Code général des impôts.',
  },
  {
    title: 'Adresse professionnelle',
    content: '11 rue de la Chine, 75020 Paris, France.',
  },
  {
    title: 'Directeur de la publication',
    content: 'Yoann Andrieux.',
  },
  {
    title: 'Contact',
    content: 'hello@yodev.fr',
  },
  {
    title: 'Hébergement',
    content:
      "L'application est hébergée par Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis. Neon fournit l'hébergement de la base de données.",
  },
]

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm font-medium text-emerald-700">
        ← Ads by Yodev
      </Link>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">Mentions légales</h1>
      <div className="mt-8 space-y-6 leading-7 text-muted-foreground">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-xl font-semibold text-foreground">{section.title}</h2>
            <p>{section.content}</p>
          </section>
        ))}
        <p className="text-sm">Dernière mise à jour : 10 août 2026.</p>
      </div>
    </main>
  )
}
