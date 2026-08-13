import { LegalDocument } from '@/components/legal-document'
import { getLocale } from '@/lib/locale'

export const metadata = { title: 'Mentions légales · Legal notice' }

export default async function LegalPage() {
  const locale = await getLocale()
  const fr = locale === 'fr'
  return (
    <LegalDocument locale={locale} title={fr ? 'Mentions légales' : 'Legal notice'}>
      <section><h2>{fr ? 'Éditeur' : 'Publisher'}</h2><p>{fr
        ? 'Ads by Yodev est édité sous le nom commercial Yodev par Yoann Andrieux, entrepreneur individuel (EI). SIREN : 803 272 590. SIRET : 803 272 590 00024. Activité principale : programmation informatique (NAF/APE 62.01Z).'
        : 'Ads by Yodev is published under the Yodev trade name by Yoann Andrieux, a French sole trader (entrepreneur individuel). SIREN: 803 272 590. SIRET: 803 272 590 00024. Main business activity: computer programming (NAF/APE 62.01Z).'}</p></section>
      <section><h2>{fr ? 'Adresse et contact' : 'Address and contact'}</h2><p>11 rue de la Chine, 75020 Paris, France · <a href="mailto:hello@yodev.fr">hello@yodev.fr</a>.</p></section>
      <section><h2>{fr ? 'Directeur de la publication' : 'Publication director'}</h2><p>Yoann Andrieux.</p></section>
      <section><h2>{fr ? 'TVA' : 'VAT'}</h2><p>{fr
        ? 'Lorsque le régime exempt_293b est activé et applicable : « TVA non applicable, article 293 B du Code général des impôts ». Le régime effectivement applicable figure au Checkout et sur la facture.'
        : 'When the exempt_293b scheme is enabled and applicable: “VAT not applicable, Article 293 B of the French General Tax Code”. The scheme actually applicable is shown at Checkout and on the invoice.'}</p></section>
      <section><h2>{fr ? 'Hébergement' : 'Hosting'}</h2><p>{fr
        ? 'L’application et ses artefacts sont hébergés par Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis. La base de données est fournie par Neon, Inc. La liste à jour des prestataires est publiée sur la page Sous-traitants.'
        : 'The application and its artifacts are hosted by Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, USA. The database is provided by Neon, Inc. The current vendor list is published on the Subprocessors page.'}</p></section>
    </LegalDocument>
  )
}
