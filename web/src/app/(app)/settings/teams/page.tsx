import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { completeTeamsNotificationConnection } from '@/app/actions'
import { PageHeading } from '@/components/page-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireCapability } from '@/lib/entitlements'
import { featureEnabled } from '@/lib/feature-flags'
import { accessTeamsOAuthSession } from '@/lib/notification-oauth-management'
import { openOAuthState } from '@/lib/oauth-state'
import { listJoinedTeams, listTeamChannels } from '@/lib/teams-oauth'
import { requireWorkspacePermission } from '@/lib/workspace'

const SESSION_COOKIE_NAME = 'yodev_ads_teams_session'

export default async function TeamsDestinationPage({
  searchParams,
}: {
  searchParams: Promise<{ teamId?: string }>
}) {
  const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
  if (!featureEnabled('teamsConnector')) redirect('/settings?error=Le%20connecteur%20Microsoft%20Teams%20est%20temporairement%20désactivé.')
  requireCapability(entitlements, 'notifications.webhook')
  const english = workspace.locale === 'en'
  const sealed = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!sealed) redirect(`/settings?error=${encodeURIComponent(english ? 'The Teams OAuth session has expired.' : 'La session OAuth Teams a expiré.')}`)
  let state
  try {
    state = openOAuthState(sealed, 'teams')
  } catch (error) {
    redirect(`/settings?error=${encodeURIComponent(error instanceof Error ? error.message : 'Session OAuth Teams invalide.')}`)
  }
  if (state.workspaceId !== workspace.id || state.userId !== session.userId || !state.payload.sessionId) {
    redirect(`/settings?error=${encodeURIComponent(english ? 'Teams OAuth security verification failed.' : 'La vérification de sécurité OAuth Teams a échoué.')}`)
  }
  const { accessToken, expiresAt } = await accessTeamsOAuthSession({
    workspaceId: workspace.id,
    actorUserId: session.userId,
    sessionId: state.payload.sessionId,
  })
  const teams = await listJoinedTeams(accessToken)
  const query = await searchParams
  const selectedTeam = teams.find((team) => team.id === query.teamId)
  const channels = selectedTeam ? await listTeamChannels(accessToken, selectedTeam.id) : []

  return (
    <>
      <PageHeading
        eyebrow="Microsoft Teams"
        title={english ? 'Choose a destination' : 'Choisir une destination'}
        description={english ? 'Messages are sent through Microsoft Graph on behalf of the account that granted access.' : 'Les messages sont envoyés via Microsoft Graph au nom du compte ayant accordé l’accès.'}
      />
      <Card className="max-w-3xl border-[#e8e5ef] shadow-sm">
        <CardHeader><CardTitle>{english ? 'Team and channel' : 'Équipe et canal'}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground">{english ? `This selection session expires at ${expiresAt.toLocaleTimeString('en-GB')}.` : `Cette session de sélection expire à ${expiresAt.toLocaleTimeString('fr-FR')}.`}</p>
          <form method="get" className="flex flex-col gap-3 sm:flex-row">
            <select name="teamId" defaultValue={selectedTeam?.id ?? ''} required className="h-10 flex-1 rounded-lg border bg-white px-3 text-sm">
              <option value="">{english ? 'Choose a team' : 'Choisir une équipe'}</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}
            </select>
            <Button type="submit" variant="outline">{english ? 'Load channels' : 'Charger les canaux'}</Button>
          </form>
          {selectedTeam && (
            <form action={completeTeamsNotificationConnection} className="space-y-3 border-t pt-5">
              <input type="hidden" name="teamId" value={selectedTeam.id} />
              <select name="channelId" required className="h-10 w-full rounded-lg border bg-white px-3 text-sm">
                <option value="">{english ? 'Choose a channel' : 'Choisir un canal'}</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.displayName}{channel.membershipType ? ` · ${channel.membershipType}` : ''}</option>)}
              </select>
              <Button type="submit">{english ? 'Connect this channel' : 'Connecter ce canal'}</Button>
            </form>
          )}
          {teams.length === 0 && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{english ? 'No directly joined Microsoft Teams team is available for this account.' : 'Aucune équipe Microsoft Teams dont ce compte est membre direct n’est disponible.'}</p>}
        </CardContent>
      </Card>
    </>
  )
}
