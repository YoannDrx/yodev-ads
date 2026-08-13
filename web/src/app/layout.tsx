import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { DM_Sans, Fira_Code, Plus_Jakarta_Sans } from 'next/font/google'
import { CookieConsentBanner } from '@/components/cookie-consent-banner'
import { getCookieConsent, getLocale } from '@/lib/locale'
import './globals.css'

const bodyFont = DM_Sans({ variable: '--font-yodev-body', subsets: ['latin'] })
const displayFont = Plus_Jakarta_Sans({ variable: '--font-yodev-display', subsets: ['latin'] })
const monoFont = Fira_Code({ variable: '--font-yodev-mono', subsets: ['latin'] })

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const french = locale === 'fr'
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'),
    title: {
      default: french ? 'Ads by Yodev — Le système d’exploitation Google Ads des agences' : 'Ads by Yodev — The Google Ads operating system for agencies',
      template: '%s · Ads by Yodev',
    },
    description: french
      ? 'Surveillez tous vos comptes Google Ads, expliquez les anomalies et sécurisez chaque changement dans un cockpit multi-client.'
      : 'Monitor every Google Ads account, explain anomalies and secure each change in a multi-client cockpit.',
    openGraph: {
      title: french ? 'Ads by Yodev — Google Ads, sans angle mort' : 'Ads by Yodev — Google Ads, with no blind spots',
      description: french
        ? 'Détecter, expliquer, approuver et agir sur tous les comptes de votre agence.'
        : 'Detect, explain, approve and act across every account in your agency.',
      type: 'website',
      locale: french ? 'fr_FR' : 'en_US',
    },
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, cookieConsent] = await Promise.all([getLocale(), getCookieConsent()])
  return (
    <html lang={locale} className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        {children}
        {cookieConsent === 'accepted' && <><Analytics /><SpeedInsights /></>}
        {cookieConsent === null && <CookieConsentBanner locale={locale} />}
      </body>
    </html>
  )
}
