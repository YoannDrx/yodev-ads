'use client'

import { useRef, type ReactNode } from 'react'
import { Menu } from 'lucide-react'

export function MobileMenu({ children, label }: { children: ReactNode; label: string }) {
  const details = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  return <details ref={details} onKeyDown={(event) => {
    if (event.key === 'Escape' && details.current?.open) {
      details.current.open = false
      summary.current?.focus()
    }
  }} onClick={(event) => {
    if ((event.target as HTMLElement).closest('a') && details.current) details.current.open = false
  }}>
    <summary ref={summary} className="flex min-h-11 min-w-14 cursor-pointer list-none flex-col items-center justify-center gap-1 text-xs font-medium"><Menu className="size-5" />Menu</summary>
    <nav aria-label={label} className="absolute inset-x-2 bottom-full mb-2 max-h-[70dvh] overflow-y-auto rounded-xl border bg-white p-2 shadow-xl">{children}</nav>
  </details>
}
