import { AuthPanel } from '@/components/auth-panel'
import { getLocale } from '@/lib/locale'

export default async function SignUpPage() {
  const googleEnabled = Boolean(process.env.BETTER_AUTH_GOOGLE_CLIENT_ID && process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET)
  return <AuthPanel mode="sign-up" locale={await getLocale()} googleEnabled={googleEnabled} />
}
