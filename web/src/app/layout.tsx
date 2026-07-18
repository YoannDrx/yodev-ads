import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { frFR } from '@clerk/localizations'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://vigihat.com'),
  title: { default: 'Vigihat — Le système d’exploitation Google Ads des agences', template: '%s · Vigihat' },
  description:
    'Surveillez tous vos comptes Google Ads, expliquez les anomalies et sécurisez chaque changement dans un cockpit multi-client.',
  openGraph: {
    title: 'Vigihat — Google Ads, sans angle mort',
    description: 'Détecter, expliquer, approuver et agir sur tous les comptes de votre agence.',
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
