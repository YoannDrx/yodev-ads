import { LegalDocument } from '@/components/legal-document'
import { getLocale } from '@/lib/locale'
import { RETENTION_POLICY } from '@/lib/retention-policy'

export const metadata = { title: 'Confidentialité · Privacy' }

export default async function PrivacyPage() {
  const locale = await getLocale()
  const fr = locale === 'fr'
  return (
    <LegalDocument locale={locale} title={fr ? 'Politique de confidentialité' : 'Privacy policy'}>
      <section><h2>{fr ? 'Responsable et rôles' : 'Controller and roles'}</h2><p>{fr
        ? 'Yodev, édité par Yoann Andrieux (EI, SIREN 803 272 590), est responsable des traitements liés au compte, à la souscription, à la sécurité et à l’usage de son service. Pour les données Google Ads et clients importées sur instruction d’un client professionnel, Yodev agit généralement comme sous-traitant et le client comme responsable de traitement.'
        : 'Yodev, published by Yoann Andrieux (French sole trader, SIREN 803 272 590), controls account, subscription, security and service usage processing. For Google Ads and client data imported on a business customer’s instructions, Yodev generally acts as processor and the customer as controller.'}</p></section>
      <section><h2>{fr ? 'Données traitées' : 'Data processed'}</h2><ul>
        <li>{fr ? 'identité, coordonnées, organisation, rôles et preuves d’acceptation ;' : 'identity, contact details, organisation, roles and acceptance evidence;'}</li>
        <li>{fr ? 'raison sociale, coordonnées de facturation professionnelles, plan et identifiants Stripe ;' : 'legal business name, professional billing details, plan and Stripe identifiers;'}</li>
        <li>{fr ? 'comptes, métriques, configurations, changements et identifiants de ressources Google Ads ;' : 'Google Ads accounts, metrics, settings, changes and resource identifiers;'}</li>
        <li>{fr ? 'alertes, rapports, commentaires, approbations, audits et journaux techniques ;' : 'alerts, reports, comments, approvals, audits and technical logs;'}</li>
        <li>{fr ? 'adresses IP et empreintes pseudonymisées nécessaires à la sécurité et aux limites de débit.' : 'IP addresses and pseudonymised fingerprints needed for security and rate limiting.'}</li>
      </ul></section>
      <section><h2>{fr ? 'Finalités et bases juridiques' : 'Purposes and legal bases'}</h2><p>{fr
        ? 'Les données sont utilisées pour exécuter le contrat (compte, Google Ads, rapports, support, billing), respecter les obligations légales (facturation et preuves), et poursuivre les intérêts légitimes de sécurité, prévention des abus, audit et amélioration technique. Les mesures d’audience non essentielles reposent sur votre consentement, révocable par suppression du cookie de choix ou via les réglages à venir.'
        : 'Data is used to perform the contract (account, Google Ads, reports, support and billing), comply with legal duties (invoicing and evidence), and pursue legitimate interests in security, abuse prevention, audit and technical improvement. Non-essential audience measurement relies on consent, which may be withdrawn by deleting the preference cookie or through upcoming settings.'}</p></section>
      <section><h2>{fr ? 'Destinataires et transferts' : 'Recipients and transfers'}</h2><p>{fr
        ? 'L’accès est limité aux personnes autorisées chez le client, à Yodev et aux prestataires strictement nécessaires listés sur la page Sous-traitants. Certains prestataires peuvent traiter des données hors Espace économique européen selon leurs conditions et mécanismes de transfert applicables. Yodev ne vend pas les données et ne les utilise pas pour cibler de la publicité.'
        : 'Access is limited to authorised customer users, Yodev and strictly necessary vendors listed on the Subprocessors page. Some vendors may process data outside the EEA under their applicable terms and transfer mechanisms. Yodev does not sell data or use it for advertising targeting.'}</p></section>
      <section><h2>{fr ? 'Durées de conservation' : 'Retention'}</h2><ul>
        <li>{fr ? 'performances, audits, approbations, alertes et changements : 24 mois ;' : 'performance, audits, approvals, alerts and changes: 24 months;'}</li>
        <li>{fr ? `preuves de livraison et erreurs de notification : ${RETENTION_POLICY.deliveryEvidenceDays} jours ; limitations de débit : suppression à expiration ;` : `delivery evidence and notification errors: ${RETENTION_POLICY.deliveryEvidenceDays} days; rate-limit records: deleted on expiry;`}</li>
        <li>{fr ? `rapports publics : ${RETENTION_POLICY.publicReportDefaultDays} jours par défaut ; exports : ${RETENTION_POLICY.exportArtifactDays} jours ;` : `public reports: ${RETENTION_POLICY.publicReportDefaultDays} days by default; exports: ${RETENTION_POLICY.exportArtifactDays} days;`}</li>
        <li>{fr ? 'jetons OAuth : jusqu’à révocation, suppression ou perte d’accès ;' : 'OAuth tokens: until revocation, deletion or loss of access;'}</li>
        <li>{fr ? `après demande de suppression : révocation immédiate puis purge opérationnelle à J+${RETENTION_POLICY.workspaceDeletionGraceDays}, hors données comptables légalement requises.` : `after a deletion request: immediate revocation followed by operational purge at day ${RETENTION_POLICY.workspaceDeletionGraceDays}, except legally required accounting records.`}</li>
      </ul></section>
      <section><h2>{fr ? 'Sécurité' : 'Security'}</h2><p>{fr
        ? 'Les espaces sont isolés en base et dans l’application. Les jetons OAuth sont chiffrés, les secrets sont révélés une seule fois, les actions sensibles sont auditées et les écritures Google nécessitent une approbation humaine. Aucun système ne peut garantir un risque nul.'
        : 'Workspaces are isolated in the database and application. OAuth tokens are encrypted, secrets are revealed once, sensitive actions are audited and Google writes require human approval. No system can guarantee zero risk.'}</p></section>
      <section><h2>{fr ? 'Vos droits' : 'Your rights'}</h2><p>{fr
        ? 'Selon votre situation, vous pouvez demander l’accès, la rectification, l’effacement, la limitation, la portabilité ou vous opposer à un traitement, et retirer un consentement sans effet rétroactif. Contactez hello@yodev.fr. Une preuve d’identité proportionnée peut être demandée. Vous pouvez également saisir la CNIL.'
        : 'Depending on your circumstances, you may request access, correction, deletion, restriction, portability or object to processing, and withdraw consent without retroactive effect. Contact hello@yodev.fr. Proportionate identity evidence may be requested. You may also lodge a complaint with the CNIL, the French data protection authority.'}</p></section>
      <section><h2>{fr ? 'Données Google' : 'Google data'}</h2><p>{fr
        ? 'L’utilisation et le transfert des informations reçues des API Google respectent la Google API Services User Data Policy, y compris ses exigences de Limited Use. Une connexion peut être révoquée dans les réglages ; le jeton est alors révoqué auprès de Google et sa copie chiffrée supprimée.'
        : 'Use and transfer of information received from Google APIs complies with the Google API Services User Data Policy, including Limited Use requirements. A connection may be revoked in Settings; the token is then revoked with Google and its encrypted copy removed.'}</p></section>
    </LegalDocument>
  )
}
