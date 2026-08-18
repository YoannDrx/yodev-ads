import Link from 'next/link'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { commonMessages, type Locale } from '@/lib/i18n'

export function LegalDocument({
  locale,
  title,
  children,
  updated = '12 août 2026',
  updatedEn = '12 August 2026',
}: {
  locale: Locale
  title: string
  children: React.ReactNode
  updated?: string
  updatedEn?: string
}) {
  const messages = commonMessages[locale]
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="text-sm font-medium text-emerald-700">{messages.back}</Link>
        <LocaleSwitcher locale={locale} />
      </div>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-8 space-y-7 leading-7 text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc">
        {children}
        <nav className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-5 text-sm">
          <Link href="/legal">{locale === 'fr' ? 'Mentions légales' : 'Legal notice'}</Link>
          <Link href="/terms">{locale === 'fr' ? 'CGV et conditions' : 'Terms'}</Link>
          <Link href="/privacy">{locale === 'fr' ? 'Confidentialité' : 'Privacy'}</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/subprocessors">{locale === 'fr' ? 'Sous-traitants' : 'Subprocessors'}</Link>
          <Link href="/dpa">DPA</Link>
        </nav>
        <p className="text-sm">{messages.lastUpdated}: {locale === 'fr' ? updated : updatedEn}.</p>
      </div>
    </main>
  )
}
