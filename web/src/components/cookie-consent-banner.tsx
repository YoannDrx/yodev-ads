import Link from 'next/link'
import { setCookieConsent } from '@/app/preferences-actions'
import { commonMessages, type Locale } from '@/lib/i18n'

export function CookieConsentBanner({ locale }: { locale: Locale }) {
  const messages = commonMessages[locale]
  return (
    <aside
      aria-label={messages.cookiesTitle}
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-2xl border border-white/10 bg-[#0d1722] p-5 text-white shadow-2xl"
    >
      <h2 className="font-semibold">{messages.cookiesTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-white/65">
        {messages.cookiesBody}{' '}
        <Link href="/cookies" className="underline underline-offset-2">{messages.cookiePolicy}</Link>
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <form action={setCookieConsent}>
          <button name="consent" value="rejected" className="rounded-full px-4 py-2 text-sm text-white/75 hover:bg-white/10">
            {messages.rejectAnalytics}
          </button>
        </form>
        <form action={setCookieConsent}>
          <button name="consent" value="accepted" className="rounded-full bg-[#19A58F] px-4 py-2 text-sm font-semibold text-[#0d1722]">
            {messages.acceptAnalytics}
          </button>
        </form>
      </div>
    </aside>
  )
}

