export type AuthEmailKind = 'email_verification' | 'password_reset' | 'magic_link' | 'organization_invitation'

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function authEmail(input: {
  kind: AuthEmailKind
  locale: string
  actionUrl: string
  organizationName?: string
}) {
  const english = input.locale === 'en'
  const copy = input.kind === 'email_verification'
    ? english
      ? ['Verify your email', 'Confirm your email address to secure your Ads by Yodev account.', 'Verify my email']
      : ['Vérifiez votre adresse email', 'Confirmez votre adresse afin de sécuriser votre compte Ads by Yodev.', 'Vérifier mon adresse']
    : input.kind === 'password_reset'
      ? english
        ? ['Reset your password', 'A password reset was requested for your Ads by Yodev account.', 'Choose a new password']
        : ['Réinitialisez votre mot de passe', 'Une réinitialisation a été demandée pour votre compte Ads by Yodev.', 'Choisir un nouveau mot de passe']
      : input.kind === 'magic_link'
        ? english
          ? ['Your secure sign-in link', 'Use this single-use link to sign in to Ads by Yodev. It expires in 15 minutes.', 'Sign in securely']
          : ['Votre lien de connexion sécurisé', 'Utilisez ce lien à usage unique pour vous connecter à Ads by Yodev. Il expire dans 15 minutes.', 'Me connecter en sécurité']
      : english
        ? ['Workspace invitation', `You have been invited to join ${input.organizationName ?? 'an Ads by Yodev workspace'}.`, 'Review the invitation']
        : ['Invitation à un workspace', `Vous êtes invité à rejoindre ${input.organizationName ?? 'un workspace Ads by Yodev'}.`, 'Consulter l’invitation']
  return {
    subject: copy[0],
    text: `${copy[1]}\n\n${input.actionUrl}\n\n${english ? 'If you did not request this action, ignore this email.' : 'Si vous n’êtes pas à l’origine de cette action, ignorez cet email.'}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0d1722"><p style="color:#168977;font-weight:700">Ads by Yodev</p><h1 style="font-size:24px">${escapeHtml(copy[0])}</h1><p style="line-height:1.6">${escapeHtml(copy[1])}</p><p style="margin-top:28px"><a href="${escapeHtml(input.actionUrl)}" style="background:#0d1722;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">${escapeHtml(copy[2])}</a></p><p style="margin-top:24px;font-size:12px;color:#5e6971">${english ? 'If you did not request this action, ignore this email.' : 'Si vous n’êtes pas à l’origine de cette action, ignorez cet email.'}</p></div>`,
  }
}
