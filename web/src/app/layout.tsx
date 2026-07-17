import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { frFR } from '@clerk/localizations'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://vigie-ads.vercel.app'),
  title: { default: 'VigieAds — Le cockpit Google Ads des agences', template: '%s · VigieAds' },
  description:
    'Centralisez vos comptes Google Ads, surveillez leurs performances et sécurisez chaque changement dans un cockpit multi-client.',
  openGraph: {
    title: 'VigieAds — Le cockpit Google Ads des agences',
    description: 'Une vision claire, des changements contrôlés, tous vos clients réunis.',
    type: 'website',
    locale: 'fr_FR',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider localization={frFR}>
      <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full bg-background text-foreground">{children}</body>
      </html>
    </ClerkProvider>
  )
}
