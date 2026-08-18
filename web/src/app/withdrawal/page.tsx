import { LegalDocument } from '@/components/legal-document'
import { getLocale } from '@/lib/locale'

export const metadata = { title: 'Offre B2B · Business-only offer' }

export default async function WithdrawalPage() {
  const locale = await getLocale()
  const fr = locale === 'fr'
  return (
    <LegalDocument locale={locale} title={fr ? 'Offre exclusivement professionnelle' : 'Business-only offer'}>
      <p>{fr
        ? 'Ads by Yodev ne propose actuellement aucun parcours de souscription destiné aux consommateurs. Le Checkout exige une raison sociale et des coordonnées de facturation professionnelles.'
        : 'Ads by Yodev currently offers no consumer subscription flow. Checkout requires a legal business name and professional billing details.'}</p>
      <p>{fr
        ? 'Pour toute question relative à un contrat professionnel, contactez hello@yodev.fr.'
        : 'For questions about a business contract, contact hello@yodev.fr.'}</p>
    </LegalDocument>
  )
}
