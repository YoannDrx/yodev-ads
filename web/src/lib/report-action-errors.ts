import { z } from 'zod'

// Only application-owned messages may enter report redirects. Database errors can contain tokens and editorial content.
const publicMessages = new Set([
  'L’espace actif a changé. Rechargez la page avant d’enregistrer.',
  'Action non autorisée pour cet espace.',
  'Permission required: reports:manage',
  'Les rapports programmés sont temporairement désactivés.',
  'La livraison des rapports programmés est temporairement désactivée.',
  'Un envoi est en cours. Réessayez dans quelques minutes.',
  'Compte client introuvable.',
  'Planification introuvable.',
  'Lien introuvable.',
  'Modèle de rapport introuvable.',
  'Modèle introuvable ou déjà désactivé.',
  'Le modèle a été modifié ou désactivé. Rechargez la page avant de réessayer.',
  'Ce lien historique ne permet pas de révéler une révision. Créez un nouveau rapport.',
  'Le lien a changé. Actualisez la page.',
  'Les données complètes de cette période ne sont pas disponibles. Actualisez l’historique du compte avant de publier ce bilan.',
  'Fuseau horaire invalide.',
])

export function reportActionError(error: unknown) {
  if (error instanceof z.ZodError) return 'Vérifiez les champs du formulaire et les dates de la période avant de réessayer.'
  if (error instanceof Error) {
    if (publicMessages.has(error.message)) return error.message
    if (/^Quota exceeded: reports \(\d+\/\d+\)$/.test(error.message)) return 'Le quota de rapports de cet espace est atteint. Désactivez un lien avant de réessayer.'
  }
  return 'Impossible d’enregistrer cette modification du rapport. Actualisez la page et réessayez.'
}
