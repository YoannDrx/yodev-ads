'use client'

import { useState } from 'react'
import { contrastText, reportAccent } from '@/lib/report-branding'

/** RSC navigations get a new request nonce, but the document keeps its original CSP. */
export function BrandStyles({ accentColor, nonce, scope }: { accentColor: string; nonce?: string; scope: 'report' | 'workspace' }) {
  const [documentNonce] = useState(() => typeof document === 'undefined'
    ? nonce
    : document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || nonce)
  const accent = reportAccent(accentColor)
  const css = scope === 'report'
    ? `.public-report-brand { background-color: ${accent}; color: ${contrastText(accent)}; }`
    : `.workspace-brand { --brand-accent: ${accent}; }`
  return <style nonce={documentNonce}>{css}</style>
}
