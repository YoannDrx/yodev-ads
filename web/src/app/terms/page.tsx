import { LegalDocument } from '@/components/legal-document'
import { getLocale } from '@/lib/locale'

export const metadata = { title: 'CGV et conditions · Terms' }

export default async function TermsPage() {
  const locale = await getLocale()
  const fr = locale === 'fr'
  return (
    <LegalDocument locale={locale} title={fr ? 'Conditions générales de vente et d’utilisation' : 'Terms of sale and use'}>
      <p>{fr
        ? 'Les présentes conditions régissent l’essai et l’abonnement professionnel au service Ads by Yodev, entre Yodev et l’entreprise titulaire du workspace. L’offre est exclusivement B2B. La souscription implique l’acceptation de la version affichée au Checkout.'
        : 'These terms govern professional trial and subscription access to Ads by Yodev between Yodev and the business owning the workspace. The offer is B2B only. Subscription requires acceptance of the version shown at Checkout.'}</p>
      <section><h2>{fr ? '1. Service et prérequis' : '1. Service and requirements'}</h2><p>{fr
        ? 'Ads by Yodev assiste l’analyse, la surveillance, le reporting et la préparation de changements Google Ads. Le client doit disposer des droits nécessaires sur chaque compte connecté et respecter les règles Google Ads. Le service ne garantit ni résultat publicitaire, ni disponibilité permanente des API tierces.'
        : 'Ads by Yodev assists with Google Ads analysis, monitoring, reporting and change preparation. The customer must have the required rights to every connected account and comply with Google Ads policies. The service does not guarantee advertising outcomes or uninterrupted third-party APIs.'}</p></section>
      <section><h2>{fr ? '2. Essai et abonnement' : '2. Trial and subscription'}</h2><p>{fr
        ? 'Un essai unique de 14 jours sans carte peut être accordé par identité vérifiée. L’essai est en lecture seule. Les offres Solo (29 €), Studio (89 €) et Agency (189 €) sont mensuelles, en euros, renouvelées automatiquement jusqu’à résiliation. Le prix, le régime fiscal et le total dû sont récapitulés avant paiement.'
        : 'One 14-day card-free trial may be granted per verified identity. Trial access is read-only. Solo (€29), Studio (€89) and Agency (€189) are monthly euro subscriptions that renew automatically until cancelled. The price, tax scheme and total due are summarised before payment.'}</p></section>
      <section><h2>{fr ? '3. Paiement, changement d’offre et impayé' : '3. Payment, plan changes and failed payment'}</h2><p>{fr
        ? 'Stripe traite les paiements. Une montée en gamme peut être proratisée immédiatement ; une baisse prend effet à l’échéance indiquée. En cas d’impayé, une grâce de sept jours peut s’appliquer, puis le workspace est suspendu aux fonctions de facturation, export et suppression jusqu’à régularisation.'
        : 'Stripe processes payments. An upgrade may be prorated immediately; a downgrade takes effect at the stated renewal date. After a failed payment, a seven-day grace period may apply, after which the workspace is limited to billing, export and deletion until payment is resolved.'}</p></section>
      <section><h2>{fr ? '4. Résiliation' : '4. Cancellation'}</h2><p>{fr
        ? 'Le titulaire peut demander la résiliation depuis la rubrique Facturation. Elle prend effet à la fin de la période payée et peut être annulée avant cette date. La réception et la date d’effet sont confirmées.'
        : 'The owner may cancel from Billing. Cancellation takes effect at the end of the paid period and may be withdrawn before then. Receipt and effective date are confirmed.'}</p></section>
      <section><h2>{fr ? '5. Client professionnel' : '5. Business customer'}</h2><p>{fr
        ? 'Le souscripteur déclare agir exclusivement à des fins professionnelles et disposer du pouvoir d’engager l’entreprise renseignée lors du paiement. Aucun parcours de souscription consommateur ni droit contractuel de rétractation B2C n’est proposé.'
        : 'The subscriber represents that they act solely for business purposes and have authority to bind the business entered at Checkout. No consumer subscription flow or contractual B2C withdrawal right is offered.'}</p></section>
      <section><h2>{fr ? '6. Approbations et responsabilité opérationnelle' : '6. Approvals and operational responsibility'}</h2><p>{fr
        ? 'Toute écriture Google Ads nécessite une action humaine explicite, est soumise aux garde-fous configurés et peut être bloquée en cas de dérive d’état. Le client demeure responsable du bien-fondé de ses budgets, ciblages, créations, données de conversion et approbations.'
        : 'Every Google Ads write requires explicit human action, is evaluated against configured safeguards and may be blocked when state has drifted. The customer remains responsible for budgets, targeting, creatives, conversion data and approvals.'}</p></section>
      <section><h2>{fr ? '7. Données, confidentialité et propriété' : '7. Data, confidentiality and ownership'}</h2><p>{fr
        ? 'Le client conserve ses droits sur ses données et autorise leur traitement uniquement pour fournir, sécuriser et exploiter le service. Yodev conserve ses droits sur le logiciel, sa documentation et ses méthodes. Les obligations relatives aux données personnelles sont précisées dans la Politique de confidentialité et, pour les traitements pour compte, le DPA.'
        : 'The customer retains rights in its data and authorises processing only to provide, secure and operate the service. Yodev retains rights in the software, documentation and methods. Personal data obligations are described in the Privacy Policy and, for processing on behalf of customers, the DPA.'}</p></section>
      <section><h2>{fr ? '8. Disponibilité, sécurité et suspension' : '8. Availability, security and suspension'}</h2><p>{fr
        ? 'Yodev met en œuvre des mesures raisonnables de sécurité et de reprise. L’accès peut être limité pour maintenance, incident, obligation légale, abus, risque de sécurité ou violation des présentes. Les données restent exportables selon l’état d’accès prévu.'
        : 'Yodev implements reasonable security and recovery measures. Access may be limited for maintenance, incidents, legal duties, abuse, security risk or breach of these terms. Data remains exportable according to the applicable access state.'}</p></section>
      <section><h2>{fr ? '9. Responsabilité et droit applicable' : '9. Liability and governing law'}</h2><p>{fr
        ? 'Aucune stipulation ne limite une responsabilité qui ne peut légalement être exclue. Sous réserve de ces exclusions impératives, la responsabilité directe de Yodev envers le client professionnel est limitée aux sommes payées au titre des douze derniers mois. Le droit français s’applique et une tentative de résolution amiable doit précéder tout contentieux.'
        : 'Nothing limits liability that cannot legally be excluded. Subject to those mandatory exclusions, Yodev’s direct liability to the business customer is limited to fees paid in the previous twelve months. French law applies and the parties must first seek an amicable resolution.'}</p></section>
      <section><h2>{fr ? '10. Contact et évolution' : '10. Contact and changes'}</h2><p>{fr
        ? 'Contact : hello@yodev.fr. Une modification substantielle est notifiée avant son entrée en vigueur. La version acceptée et son contexte sont conservés comme preuve.'
        : 'Contact: hello@yodev.fr. Material changes are notified before taking effect. The accepted version and its context are retained as evidence.'}</p></section>
    </LegalDocument>
  )
}
