import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { frFR } from '@clerk/localizations'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { DM_Sans, Fira_Code, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const bodyFont = DM_Sans({ variable: '--font-yodev-body', subsets: ['latin'] })
const displayFont = Plus_Jakarta_Sans({ variable: '--font-yodev-display', subsets: ['latin'] })
const monoFont = Fira_Code({ variable: '--font-yodev-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'),
  title: { default: 'Ads by Yodev — Le système d’exploitation Google Ads des agences', template: '%s · Ads by Yodev' },
  description:
    'Surveillez tous vos comptes Google Ads, expliquez les anomalies et sécurisez chaque changement dans un cockpit multi-client.',
  openGraph: {
    title: 'Ads by Yodev — Google Ads, sans angle mort',
    description: 'Détecter, expliquer, approuver et agir sur tous les comptes de votre agence.',
    type: 'website',
    locale: 'fr_FR',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider localization={frFR}>
      <html lang="fr" className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} h-full antialiased`}>
        <body className="min-h-full bg-background text-foreground">
          {children}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}
