import { z } from 'zod'
import { openOAuthState } from '@/lib/oauth-state'

export function teamsAuthorizationCookieName(state: string) {
  return `yodev_ads_teams_oauth_${z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).parse(state)}`
}

export function teamsSessionCookieName(sessionId: string) {
  return `yodev_ads_teams_session_${z.string().uuid().parse(sessionId)}`
}

/** Bind the displayed selection, signed cookie, current workspace and actor. */
export function requireTeamsSessionContext(input: { workspaceId: string; userId: string; sessionId: string; displayedWorkspaceId: string; sealed?: string }) {
  z.string().uuid().parse(input.sessionId)
  if (!input.sealed) throw new Error('La session OAuth Teams a expiré. Relancez la connexion.')
  const state = openOAuthState(input.sealed, 'teams')
  if (input.displayedWorkspaceId !== input.workspaceId || state.workspaceId !== input.workspaceId || state.userId !== input.userId || state.payload.sessionId !== input.sessionId) {
    throw new Error('La session OAuth Teams a changé. Relancez la connexion.')
  }
  return state
}

export function teamsConnectionError(error: unknown, english: boolean) {
  const detail = error instanceof Error ? error.message : ''
  if (/expir/i.test(detail)) return english ? 'This Teams session has expired. Restart the connection from Settings.' : 'Cette session Teams a expiré. Relancez la connexion depuis les paramètres.'
  if (/non autorisée|Capability|permission/i.test(detail)) return english ? 'Your current access no longer allows connecting Teams. Ask a workspace administrator to check your access.' : 'Vos droits actuels ne permettent plus de connecter Teams. Demandez à un administrateur de vérifier votre accès.'
  if (/Quota/.test(detail)) return english ? 'Your plan’s notification channel limit has been reached. Remove a channel or change your plan.' : 'La limite de canaux de notification de votre forfait est atteinte. Retirez un canal ou changez de forfait.'
  if (/changé|simultan|sécurité|Zod/.test(detail) || error instanceof z.ZodError) return english ? 'This Teams selection no longer matches the active session or workspace. Restart the connection from Settings.' : 'Cette sélection Teams ne correspond plus à la session ou à l’espace actif. Relancez la connexion depuis les paramètres.'
  return english ? 'Teams could not be loaded or connected. Try again from Settings; if the problem continues, check the Microsoft account’s access.' : 'Impossible de charger ou de connecter Teams. Réessayez depuis les paramètres ; si le problème persiste, vérifiez les accès du compte Microsoft.'
}
