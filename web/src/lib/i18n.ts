export const SUPPORTED_LOCALES = ['fr', 'en'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export function parseLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : 'fr'
}

export const commonMessages = {
  fr: {
    back: '← Ads by Yodev',
    lastUpdated: 'Dernière mise à jour',
    language: 'Langue',
    cookiesTitle: 'Vos choix de confidentialité',
    cookiesBody:
      'Les cookies essentiels permettent la connexion et la sécurité. Les mesures d’audience Vercel ne sont chargées qu’avec votre accord.',
    rejectAnalytics: 'Continuer sans mesure d’audience',
    acceptAnalytics: 'Autoriser la mesure d’audience',
    cookiePolicy: 'Politique cookies',
  },
  en: {
    back: '← Ads by Yodev',
    lastUpdated: 'Last updated',
    language: 'Language',
    cookiesTitle: 'Your privacy choices',
    cookiesBody:
      'Essential cookies enable sign-in and security. Vercel audience measurement is loaded only with your consent.',
    rejectAnalytics: 'Continue without audience measurement',
    acceptAnalytics: 'Allow audience measurement',
    cookiePolicy: 'Cookie policy',
  },
} as const satisfies Record<Locale, Record<string, string>>

