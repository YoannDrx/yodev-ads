import { cookies } from 'next/headers'
import Link from 'next/link'
import { completeTeamsNotificationConnection } from '@/app/teams-connection-actions'
import { PageHeading } from '@/components/page-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireCapability } from '@/lib/entitlements'
import { featureEnabled } from '@/lib/feature-flags'
import { accessTeamsOAuthSession } from '@/lib/notification-oauth-management'
import { requireTeamsSessionContext, teamsConnectionError, teamsSessionCookieName } from '@/lib/teams-session-context'
import { listJoinedTeams, listTeamChannels } from '@/lib/teams-oauth'
import { requireWorkspacePagePermission } from '@/lib/workspace'


export default async function TeamsDestinationPage({
  searchParams,
}: {
  searchParams: Promise<{ teamId?: string; sessionId?: string; workspaceId?: string }>
}) {
  const { workspace, session, entitlements } = await requireWorkspacePagePermission('workspace:admin', '/settings/teams')
  const english = workspace.locale === 'en'
  const query = await searchParams
  let selection
  try {
    if (!featureEnabled('teamsConnector') || !featureEnabled('notifications')) throw new Error('Connector disabled')
    requireCapability(entitlements, 'notifications.webhook')
    const sessionId = query.sessionId ?? ''
    const sealed = (await cookies()).get(teamsSessionCookieName(sessionId))?.value
    requireTeamsSessionContext({ workspaceId: workspace.id, userId: session.userId, sessionId,
      displayedWorkspaceId: query.workspaceId ?? '', sealed })
    const { accessToken, expiresAt } = await accessTeamsOAuthSession({ workspaceId: workspace.id, actorUserId: session.userId, sessionId })
    const teams = await listJoinedTeams(accessToken)
    const selectedTeam = teams.find((team) => team.id === query.teamId)
    const channels = selectedTeam ? await listTeamChannels(accessToken, selectedTeam.id) : []
    selection = { teams, selectedTeam, channels, expiresAt, sessionId }
  } catch (error) {
    return <>
      <PageHeading eyebrow="Microsoft Teams" title={english ? 'Connection unavailable' : 'Connexion indisponible'} description={english ? 'Check your session before selecting a channel.' : 'Vérifiez votre session avant de choisir un canal.'} />
      <Card className="max-w-3xl"><CardContent className="space-y-4 pt-6">
        <p role="alert">{teamsConnectionError(error, english)}</p>
        <Link href="/settings" className="underline">{english ? 'Back to Settings' : 'Retour aux paramètres'}</Link>
      </CardContent></Card>
    </>
  }
  const { teams, selectedTeam, channels, expiresAt, sessionId } = selection

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
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <select aria-label={english ? 'Team' : 'Équipe'} name="teamId" defaultValue={selectedTeam?.id ?? ''} required className="h-10 flex-1 rounded-lg border bg-white px-3 text-sm">
              <option value="">{english ? 'Choose a team' : 'Choisir une équipe'}</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}
            </select>
            <Button type="submit" variant="outline">{english ? 'Load channels' : 'Charger les canaux'}</Button>
          </form>
          {selectedTeam && (
            <form action={completeTeamsNotificationConnection} className="space-y-3 border-t pt-5">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="teamId" value={selectedTeam.id} />
              <select aria-label={english ? 'Channel' : 'Canal'} name="channelId" required className="h-10 w-full rounded-lg border bg-white px-3 text-sm">
                <option value="">{english ? 'Choose a channel' : 'Choisir un canal'}</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.displayName}{channel.membershipType ? ` · ${channel.membershipType}` : ''}</option>)}
              </select>
              {channels.length === 0 && <p>{english ? 'No accessible channel is available in this team.' : 'Aucun canal accessible n’est disponible dans cette équipe.'}</p>}
              <Button type="submit" disabled={channels.length === 0}>{english ? 'Connect this channel' : 'Connecter ce canal'}</Button>
            </form>
          )}
          {teams.length === 0 && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{english ? 'No directly joined Microsoft Teams team is available for this account.' : 'Aucune équipe Microsoft Teams dont ce compte est membre direct n’est disponible.'}</p>}
        </CardContent>
      </Card>
    </>
  )
}
