import { LegalDocument } from '@/components/legal-document'
import { getLocale } from '@/lib/locale'
import { getPublishedSubprocessorChangeNotices } from '@/lib/subprocessor-change-management'

export const metadata = { title: 'Sous-traitants · Subprocessors' }

const vendors = [
  ['Google Cloud & Google Ads API', 'OAuth et données publicitaires / OAuth and advertising data', 'Selon la configuration Google / Per Google configuration'],
  ['Neon', 'PostgreSQL managé / Managed PostgreSQL', 'Union européenne configurée / Configured European Union region'],
  ['Vercel', 'Hébergement, fonctions, artefacts et métriques consenties / Hosting, functions, artifacts and consented metrics', 'Union européenne et États-Unis / European Union and United States'],
  ['Stripe', 'Paiement, facturation et fiscalité / Payment, billing and tax', 'Union européenne et États-Unis / European Union and United States'],
  ['Resend', 'Emails transactionnels / Transactional email', 'États-Unis / United States'],
  ['Sentry', 'Erreurs techniques expurgées / Redacted technical errors', 'Région à configurer avant production / Region to configure before production'],
] as const

export default async function SubprocessorsPage() {
  const locale = await getLocale()
  const fr = locale === 'fr'
  // The legal register remains available during a database incident. Dynamic
  // change notices degrade to an empty list instead of taking the legal page down.
  const notices = await getPublishedSubprocessorChangeNotices().catch(() => [])
  return (
    <LegalDocument locale={locale} title={fr ? 'Liste des sous-traitants' : 'Subprocessor list'}>
      <p>{fr
        ? 'Cette liste décrit les prestataires susceptibles de traiter des données pour fournir Ads by Yodev. L’activation effective dépend des intégrations configurées. Le client professionnel autorise leur recours dans les conditions du DPA.'
        : 'This list describes vendors that may process data to provide Ads by Yodev. Actual use depends on configured integrations. Business customers authorise their use under the DPA.'}</p>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr className="border-b text-left"><th className="py-2 pr-3">{fr ? 'Prestataire' : 'Vendor'}</th><th className="py-2 pr-3">{fr ? 'Finalité' : 'Purpose'}</th><th className="py-2">{fr ? 'Localisation indicative' : 'Indicative location'}</th></tr></thead><tbody>{vendors.map(([name, purpose, location]) => <tr key={name} className="border-b align-top"><td className="py-3 pr-3 font-medium text-foreground">{name}</td><td className="py-3 pr-3">{purpose}</td><td className="py-3">{location}</td></tr>)}</tbody></table></div>
      <section><h2>{fr ? 'Changements et opposition' : 'Changes and objection'}</h2><p>{fr
        ? 'Les ajouts ou remplacements matériels sont notifiés au contact administrateur au moins 15 jours avant leur prise d’effet lorsque cela est raisonnablement possible. Un client peut formuler une objection documentée liée à la protection des données à hello@yodev.fr pendant ce délai.'
        : 'Material additions or replacements are notified to the administrator contact at least 15 days before taking effect where reasonably possible. A customer may submit a documented data-protection objection to hello@yodev.fr during that period.'}</p></section>
      {notices.length > 0 && <section><h2>{fr ? 'Changements annoncés' : 'Announced changes'}</h2><div className="space-y-4">{notices.map((notice) => <article key={notice.id} className="rounded-xl border p-4"><p className="font-medium text-foreground">{notice.vendorName}</p><p className="mt-1 text-xs uppercase tracking-wide">{notice.changeType} · {new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(notice.effectiveAt)}</p><p className="mt-3 whitespace-pre-wrap">{fr ? notice.summaryFr : notice.summaryEn}</p></article>)}</div></section>}
      <section><h2>{fr ? 'Transferts internationaux' : 'International transfers'}</h2><p>{fr
        ? 'Les emplacements et mécanismes exacts doivent être confirmés dans les conditions et DPA en vigueur de chaque prestataire au moment de la souscription. Lorsque nécessaire, le transfert repose sur une décision d’adéquation, les clauses contractuelles types de la Commission européenne et des mesures supplémentaires appropriées.'
        : 'Exact locations and mechanisms must be confirmed against each vendor’s current terms and DPA at subscription time. Where required, transfers rely on an adequacy decision, European Commission standard contractual clauses and suitable supplementary measures.'}</p></section>
    </LegalDocument>
  )
}
