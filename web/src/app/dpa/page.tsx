import { LegalDocument } from '@/components/legal-document'
import { getLocale } from '@/lib/locale'

export const metadata = { title: 'Accord de traitement des données · DPA' }

export default async function DpaPage() {
  const locale = await getLocale()
  const fr = locale === 'fr'
  return (
    <LegalDocument locale={locale} title={fr ? 'Accord de traitement des données (DPA)' : 'Data Processing Agreement (DPA)'}>
      <p>{fr
        ? 'Le présent DPA complète les Conditions pour les clients qui confient à Yodev des traitements de données personnelles. Le client est le responsable de traitement et Yodev le sous-traitant, sauf lorsque chacun agit comme responsable indépendant pour ses propres obligations.'
        : 'This DPA supplements the Terms for customers entrusting personal-data processing to Yodev. The customer is controller and Yodev is processor, except where each party acts as independent controller for its own obligations.'}</p>
      <section><h2>{fr ? '1. Objet et durée' : '1. Subject matter and duration'}</h2><p>{fr
        ? 'Traitement nécessaire à l’hébergement, la synchronisation Google Ads, l’analyse, la surveillance, l’approbation, le reporting, le support, l’export et la suppression pendant la durée du contrat, puis selon les délais de restitution et purge convenus.'
        : 'Processing required for hosting, Google Ads synchronisation, analysis, monitoring, approval, reporting, support, export and deletion for the contract term, followed by the agreed return and purge periods.'}</p></section>
      <section><h2>{fr ? '2. Données et personnes concernées' : '2. Data and data subjects'}</h2><p>{fr
        ? 'Identifiants professionnels, coordonnées, rôles, commentaires, journaux, identifiants Google Ads, données de campagnes et de conversion agrégées ou pseudonymisées. Personnes : utilisateurs du client, ses clients, collaborateurs et contacts de rapports. Les catégories particulières de données ne doivent pas être confiées au service.'
        : 'Business identifiers, contact details, roles, comments, logs, Google Ads identifiers, and aggregated or pseudonymised campaign and conversion data. Data subjects: customer users, its clients, staff and report contacts. Special-category data must not be submitted to the service.'}</p></section>
      <section><h2>{fr ? '3. Instructions et confidentialité' : '3. Instructions and confidentiality'}</h2><p>{fr
        ? 'Yodev traite les données uniquement sur instructions documentées résultant du contrat, de la configuration et des actions autorisées, sauf obligation légale contraire dont le client est informé lorsque la loi le permet. Les personnes habilitées sont soumises à confidentialité.'
        : 'Yodev processes data only on documented instructions arising from the contract, configuration and authorised actions, unless otherwise required by law, in which case the customer is informed where permitted. Authorised personnel are bound by confidentiality.'}</p></section>
      <section><h2>{fr ? '4. Sécurité' : '4. Security'}</h2><ul>
        <li>{fr ? 'isolation tenant par RLS et contrôles d’autorisation ;' : 'tenant isolation through RLS and authorisation controls;'}</li>
        <li>{fr ? 'chiffrement en transit et chiffrement applicatif versionné des jetons ;' : 'encryption in transit and versioned application encryption for tokens;'}</li>
        <li>{fr ? 'journaux d’audit immuables, moindre privilège et gestion des secrets ;' : 'immutable audit logs, least privilege and secret management;'}</li>
        <li>{fr ? 'sauvegarde, reprise, surveillance, gestion des vulnérabilités et réponse aux incidents.' : 'backup, recovery, monitoring, vulnerability handling and incident response.'}</li>
      </ul></section>
      <section><h2>{fr ? '5. Assistance et violation' : '5. Assistance and breach'}</h2><p>{fr
        ? 'Yodev assiste raisonnablement le client pour les droits des personnes, analyses d’impact et consultations. Une violation de données confiées est notifiée sans délai injustifié après confirmation, avec les informations disponibles et des mises à jour progressives.'
        : 'Yodev reasonably assists with data-subject rights, impact assessments and consultations. A breach of entrusted data is notified without undue delay after confirmation, with available information and progressive updates.'}</p></section>
      <section><h2>{fr ? '6. Sous-traitants ultérieurs et transferts' : '6. Subprocessors and transfers'}</h2><p>{fr
        ? 'Le client donne une autorisation générale aux prestataires publiés sur la page Sous-traitants, soumis à des obligations équivalentes. Les changements sont notifiés et peuvent faire l’objet d’une objection motivée. Les transferts hors EEE utilisent un mécanisme valide applicable.'
        : 'The customer gives general authorisation for vendors published on the Subprocessors page, subject to equivalent duties. Changes are notified and may be challenged on documented grounds. Transfers outside the EEA use an applicable valid mechanism.'}</p></section>
      <section><h2>{fr ? '7. Sort et audit' : '7. Return, deletion and audit'}</h2><p>{fr
        ? 'À la fin du service, le client peut exporter ses données ; les accès sont révoqués immédiatement et la purge opérationnelle intervient à J+30, sous réserve des obligations légales et de l’expiration normale des sauvegardes protégées. Yodev fournit les informations raisonnablement nécessaires à démontrer la conformité et accepte un audit encadré, après revue documentaire, une fois par an sauf incident.'
        : 'At service end, the customer may export data; access is revoked immediately and operational purge occurs at day 30, subject to legal retention and normal expiry of protected backups. Yodev provides information reasonably needed to demonstrate compliance and accepts a scoped audit, after documentary review, once per year except after an incident.'}</p></section>
      <section><h2>{fr ? '8. Contact et ordre de priorité' : '8. Contact and precedence'}</h2><p>{fr
        ? 'Contact protection des données : hello@yodev.fr. En cas de contradiction sur le traitement des données confiées, le présent DPA prévaut sur les Conditions. Les clauses contractuelles types applicables prévalent sur les stipulations incompatibles.'
        : 'Data protection contact: hello@yodev.fr. If terms conflict regarding entrusted-data processing, this DPA prevails over the Terms. Applicable standard contractual clauses prevail over incompatible terms.'}</p></section>
    </LegalDocument>
  )
}

