export function invitationErrorMessage(code: string | undefined, locale: string) {
  const english = locale === 'en'
  switch (code) {
    case 'WORKSPACE_INVITATION_UNAVAILABLE':
      return english ? 'This workspace cannot accept members right now. Ask its owner to restore access, then try this invitation again.' : 'Cet espace ne peut pas accueillir de membres actuellement. Demandez à son propriétaire de rétablir son accès, puis réessayez cette invitation.'
    case 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED':
      return english ? 'This workspace has reached its member limit. Ask its owner to free a place or change the plan, then try again.' : 'Cet espace a atteint sa limite de membres. Demandez à son propriétaire de libérer une place ou de changer d’offre, puis réessayez.'
    case 'INVITATION_NOT_FOUND':
      return english ? 'This invitation is expired, revoked or no longer available. Ask the workspace owner for a new invitation.' : 'Cette invitation a expiré, a été révoquée ou n’est plus disponible. Demandez une nouvelle invitation au propriétaire de l’espace.'
    case 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION':
      return english ? 'Sign in with the email address that received this invitation.' : 'Connectez-vous avec l’adresse email qui a reçu cette invitation.'
    case 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION':
      return english ? 'Verify your email address before accepting this invitation.' : 'Vérifiez votre adresse email avant d’accepter cette invitation.'
    default:
      return english ? 'Invitation could not be accepted. Check your connection and try again.' : 'Impossible d’accepter l’invitation. Vérifiez votre connexion et réessayez.'
  }
}
