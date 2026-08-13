import { Suspense } from 'react'
import { PasswordRecovery } from '@/components/password-recovery'
import { getLocale } from '@/lib/locale'

export default async function ResetPasswordPage() {
  return <Suspense><PasswordRecovery mode="reset" locale={await getLocale()} /></Suspense>
}
