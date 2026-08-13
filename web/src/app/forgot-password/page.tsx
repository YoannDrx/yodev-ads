import { PasswordRecovery } from '@/components/password-recovery'
import { getLocale } from '@/lib/locale'

export default async function ForgotPasswordPage() {
  return <PasswordRecovery mode="request" locale={await getLocale()} />
}
