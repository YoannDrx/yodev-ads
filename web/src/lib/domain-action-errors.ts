import { z } from 'zod'

const publicMessages = new Set([
  'L’espace actif a changé. Rechargez la page avant d’enregistrer.',
  'Action non autorisée pour cet espace.',
  'Les domaines personnalisés sont temporairement désactivés.',
  'Saisissez un nom d’hôte sans protocole, chemin, port ni wildcard.',
  'Nom de domaine invalide.',
  'Ce domaine local ou interne ne peut pas être utilisé.',
  'Ce domaine est réservé à la plateforme.',
  'Révoquez le domaine existant avant d’en configurer un autre.',
  'Ce domaine reste réservé pendant son nettoyage. Contactez le support.',
  'Domaine introuvable.',
  'Le domaine a changé. Actualisez la page avant de réessayer.',
  'Le domaine a été révoqué pendant sa vérification.',
  'Le domaine a déjà été révoqué.',
  'La réponse Vercel ne permet pas de confirmer l’état du domaine.',
  'Opération du domaine non finalisée. Réessayez ou contactez le support.',
])

export function domainActionError(error: unknown) {
  if (error instanceof z.ZodError) return 'Vérifiez le nom du domaine et les champs du formulaire.'
  if (error instanceof Error) {
    if (publicMessages.has(error.message)) return error.message
    if (error.message === 'Permission required: workspace:admin') return 'Vos droits actuels ne permettent pas cette action. Rechargez la page ou contactez un administrateur.'
    if (error.message === 'Capability required: custom_domain') return 'Votre forfait ne permet pas de configurer un domaine personnalisé. Vous pouvez retirer le domaine existant.'
    if (/^Le TXT _yodev-ads\.[a-z0-9.-]{4,253} est absent ou incorrect\.$/.test(error.message)) return 'Le TXT de vérification est absent ou incorrect. Vérifiez le nom et la valeur DNS.'
  }
  return 'Opération du domaine non finalisée. Réessayez ou contactez le support.'
}
