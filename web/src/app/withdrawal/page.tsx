import { LegalDocument } from '@/components/legal-document'
import { getLocale } from '@/lib/locale'

export const metadata = { title: 'Rétractation · Withdrawal' }

export default async function WithdrawalPage() {
  const locale = await getLocale()
  const fr = locale === 'fr'
  return (
    <LegalDocument locale={locale} title={fr ? 'Droit et formulaire de rétractation' : 'Withdrawal right and form'}>
      <p>{fr
        ? 'Cette page concerne les consommateurs ayant souscrit à distance. Elle ne réduit aucun droit impératif. Le délai est en principe de 14 jours à compter de la conclusion du contrat.'
        : 'This page applies to consumers who subscribed at a distance. It does not reduce any mandatory right. The period is generally 14 days from contract conclusion.'}</p>
      <section><h2>{fr ? 'Démarrage immédiat' : 'Immediate performance'}</h2><p>{fr
        ? 'Si vous demandez expressément que le service commence avant la fin des 14 jours puis vous rétractez, le montant proportionnel au service fourni jusqu’à votre notification peut rester dû. Une renonciation anticipée ne produit effet que dans les conditions prévues par la loi, notamment après exécution complète lorsqu’elles s’appliquent.'
        : 'If you expressly request service to begin before the 14-day period ends and later withdraw, the proportionate amount supplied until notice may remain payable. Early waiver takes effect only under applicable law, including full performance where required.'}</p></section>
      <section><h2>{fr ? 'Exercer le droit' : 'Exercise the right'}</h2><p>{fr
        ? 'Envoyez avant l’expiration du délai une déclaration sans ambiguïté à hello@yodev.fr. Vous pouvez utiliser le modèle ci-dessous. Un accusé de réception vous sera adressé. Le remboursement dû est effectué selon les délais et le moyen de paiement prévus par la loi.'
        : 'Before the deadline, send an unambiguous statement to hello@yodev.fr. You may use the model below. Receipt will be acknowledged. Any refund due is made within the statutory timeline using the legally required payment method.'}</p></section>
      <section className="rounded-xl border bg-muted/30 p-5"><h2>{fr ? 'Formulaire type' : 'Model form'}</h2><p className="whitespace-pre-line">{fr
        ? `À l’attention de Yodev — Yoann Andrieux, 11 rue de la Chine, 75020 Paris, hello@yodev.fr\n\nJe vous notifie par la présente ma rétractation du contrat Ads by Yodev souscrit le [date], pour le workspace ou la référence [référence].\n\nNom :\nAdresse email du compte :\nAdresse :\nDate :\nSignature (uniquement en cas d’envoi papier) :`
        : `To Yodev — Yoann Andrieux, 11 rue de la Chine, 75020 Paris, hello@yodev.fr\n\nI hereby give notice that I withdraw from my Ads by Yodev contract concluded on [date], for workspace or reference [reference].\n\nName:\nAccount email:\nAddress:\nDate:\nSignature (only if sent on paper):`}</p></section>
      <p><a href={`mailto:hello@yodev.fr?subject=${encodeURIComponent(fr ? 'Rétractation Ads by Yodev' : 'Ads by Yodev withdrawal')}`}>{fr ? 'Envoyer ma demande par email' : 'Send my request by email'}</a></p>
    </LegalDocument>
  )
}

