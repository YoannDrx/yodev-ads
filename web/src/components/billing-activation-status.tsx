'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export function BillingActivationStatus({
  processing,
  active,
  locale,
}: {
  processing: boolean
  active: boolean
  locale: 'fr' | 'en'
}) {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!processing || active) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= 60_000) {
        window.clearInterval(timer)
        setTimedOut(true)
        return
      }
      router.refresh()
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [active, processing, router])

  if (!processing) return null
  const english = locale === 'en'
  return (
    <div className={`mb-6 rounded-2xl border p-4 text-sm ${active ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`} role="status">
      {active
        ? (english ? 'Subscription active. Your paid features are now available.' : 'Abonnement actif. Vos fonctionnalités payantes sont maintenant disponibles.')
        : timedOut
          ? (english ? 'Confirmation is taking longer than expected. This page and your billing email will update after the Stripe webhook is processed.' : 'La confirmation prend plus de temps que prévu. Cette page et votre email de facturation seront mis à jour après traitement du webhook Stripe.')
          : (english ? 'Payment received. Activation is being confirmed by Stripe…' : 'Paiement reçu. L’activation est en cours de confirmation par Stripe…')}
    </div>
  )
}
