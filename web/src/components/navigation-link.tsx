'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { navigationLinkActive } from '@/lib/navigation-state'

/** Layouts survive client navigation; derive selection from the current router state. */
export function NavigationLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return <Link href={href} aria-current={navigationLinkActive(usePathname(), href) ? 'page' : undefined} className={className}>{children}</Link>
}

/** Move keyboard focus without creating a hash entry in the product navigation history. */
export function SkipToContent({ children }: { children: ReactNode }) {
  return <a href="#main-content" onClick={(event) => {
    const main = document.getElementById('main-content')
    if (main) {
      event.preventDefault()
      main.focus()
      main.scrollIntoView({ block: 'start' })
    }
  }} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-3 focus:text-foreground focus:">{children}</a>
}
