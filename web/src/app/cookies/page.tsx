import { LegalDocument } from '@/components/legal-document'
import { setCookieConsent } from '@/app/preferences-actions'
import { getCookieConsent, getLocale } from '@/lib/locale'

export const metadata = { title: 'Cookies' }

export default async function CookiesPage() {
  const [locale, consent] = await Promise.all([getLocale(), getCookieConsent()])
  const fr = locale === 'fr'
  return (
    <LegalDocument locale={locale} title={fr ? 'Politique relative aux cookies' : 'Cookie policy'}>
      <p>{fr
        ? 'Ads by Yodev utilise des cookies essentiels et, seulement avec votre accord, des cookies ou technologies comparables de mesure d’audience. Le refus n’empêche pas l’accès au service.'
        : 'Ads by Yodev uses essential cookies and, only with your consent, cookies or similar audience-measurement technologies. Refusal does not prevent access to the service.'}</p>
      <section><h2>{fr ? 'Cookies essentiels' : 'Essential cookies'}</h2><ul>
        <li>{fr ? 'Better Auth : session, authentification, sécurité et organisation ; durée déterminée par notre configuration de session.' : 'Better Auth: session, authentication, security and organisation; duration follows our session configuration.'}</li>
        <li><code>yodev_locale</code> : {fr ? 'langue choisie, 12 mois.' : 'selected language, 12 months.'}</li>
        <li><code>yodev_cookie_consent</code> : {fr ? 'preuve du choix accepté/refusé, 12 mois.' : 'accepted/rejected choice record, 12 months.'}</li>
        <li>{fr ? 'Cookies OAuth et feedback : état anti-CSRF ou session courte, quelques minutes à 24 heures selon le parcours.' : 'OAuth and feedback cookies: anti-CSRF state or short session, from a few minutes to 24 hours depending on the flow.'}</li>
      </ul></section>
      <section><h2>{fr ? 'Mesure d’audience optionnelle' : 'Optional audience measurement'}</h2><p>{fr
        ? 'Vercel Web Analytics et Speed Insights ne sont rendus qu’après acceptation. Ils servent à mesurer l’usage agrégé, les performances et les erreurs de navigation. Aucun refus n’est interprété comme une acceptation.'
        : 'Vercel Web Analytics and Speed Insights are rendered only after acceptance. They measure aggregated usage, performance and navigation errors. Refusal is never treated as consent.'}</p></section>
      <section><h2>{fr ? 'Votre choix actuel' : 'Your current choice'}</h2><p>{consent === 'accepted'
        ? (fr ? 'La mesure d’audience est actuellement autorisée sur ce navigateur.' : 'Audience measurement is currently allowed in this browser.')
        : consent === 'rejected'
          ? (fr ? 'La mesure d’audience est actuellement refusée sur ce navigateur.' : 'Audience measurement is currently rejected in this browser.')
          : (fr ? 'Aucun choix n’a encore été enregistré.' : 'No choice has been recorded yet.')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={setCookieConsent}><button name="consent" value="rejected" className="rounded-full border px-4 py-2 text-sm text-foreground">{fr ? 'Refuser la mesure' : 'Reject measurement'}</button></form>
          <form action={setCookieConsent}><button name="consent" value="accepted" className="rounded-full bg-[#19A58F] px-4 py-2 text-sm font-semibold text-[#0d1722]">{fr ? 'Autoriser la mesure' : 'Allow measurement'}</button></form>
        </div>
      </section>
    </LegalDocument>
  )
}
