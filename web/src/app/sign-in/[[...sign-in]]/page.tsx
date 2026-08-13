import { AuthPanel } from '@/components/auth-panel'
import { getLocale } from '@/lib/locale'

export default async function SignInPage() {
  const googleEnabled = Boolean(process.env.BETTER_AUTH_GOOGLE_CLIENT_ID && process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET)
  return <AuthPanel mode="sign-in" locale={await getLocale()} googleEnabled={googleEnabled} />
}
