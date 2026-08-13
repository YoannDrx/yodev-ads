'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="fr">
      <body>
        <main style={{ margin: '10vh auto', maxWidth: 640, padding: 24, fontFamily: 'system-ui' }}>
          <h1>Une erreur inattendue est survenue</h1>
          <p>La panne a été signalée. Rechargez la page ou réessayez dans quelques instants.</p>
        </main>
      </body>
    </html>
  )
}
