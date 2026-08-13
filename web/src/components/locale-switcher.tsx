'use client'

import { usePathname } from 'next/navigation'
import { setLocalePreference } from '@/app/preferences-actions'
import type { Locale } from '@/lib/i18n'

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname()
  return (
    <form action={setLocalePreference} className="inline-flex rounded-full border border-current/15 p-0.5" aria-label="Language / Langue">
      <input type="hidden" name="returnTo" value={pathname} />
      {(['fr', 'en'] as const).map((value) => (
        <button
          key={value}
          type="submit"
          name="locale"
          value={value}
          aria-pressed={locale === value}
          className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${locale === value ? 'bg-current/10' : 'opacity-55 hover:opacity-100'}`}
        >
          {value}
        </button>
      ))}
    </form>
  )
}

