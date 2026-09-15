import Link from 'next/link'
import { setCookieConsent } from '@/app/preferences-actions'
import { commonMessages, type Locale } from '@/lib/i18n'

export function CookieConsentBanner({ locale }: { locale: Locale }) {
  const messages = commonMessages[locale]
  return (
    <aside
      aria-label={messages.cookiesTitle}
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-md border border-border bg-card p-5 text-foreground "
    >
      <h2 className="font-semibold">{messages.cookiesTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {messages.cookiesBody}{' '}
        <Link href="/cookies" className="underline underline-offset-2">{messages.cookiePolicy}</Link>
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <form action={setCookieConsent}>
          <button name="consent" value="rejected" className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-card">
            {messages.rejectAnalytics}
          </button>
        </form>
        <form action={setCookieConsent}>
          <button name="consent" value="accepted" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            {messages.acceptAnalytics}
          </button>
        </form>
      </div>
    </aside>
  )
}

