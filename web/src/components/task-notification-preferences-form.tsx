import { updateMyTaskNotificationPreferences } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { getMyTaskNotificationPreferences } from '@/lib/data'

export function TaskNotificationPreferencesForm({ taskPreferences, timezone, workspaceId, locale, returnTo = '/settings' }: {
  taskPreferences: Awaited<ReturnType<typeof getMyTaskNotificationPreferences>>
  timezone: string
  workspaceId: string
  locale: string
  returnTo?: '/settings' | '/account/notifications'
}) {
  const english = locale === 'en'
  return <>
<form action={updateMyTaskNotificationPreferences} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <div className="space-y-2"><Label htmlFor="mentionHandle">{english ? 'Mention handle' : 'Identifiant de mention'}</Label><div className="flex items-center"><span className="rounded-l-lg border border-r-0 bg-muted px-3 py-2 text-sm">@</span><Input id="mentionHandle" name="mentionHandle" defaultValue={taskPreferences?.mentionHandle ?? ''} placeholder="yoann" pattern="[a-z0-9][a-z0-9_-]{1,31}" required className="rounded-l-none" /></div></div>
              <div className="space-y-2"><Label htmlFor="digestCadence">{english ? 'Personal digest' : 'Digest personnel'}</Label><select id="digestCadence" name="digestCadence" defaultValue={taskPreferences?.digestCadence ?? 'none'} className="h-10 w-full rounded-lg border bg-card px-3 text-sm"><option value="none">{english ? 'Disabled' : 'Désactivé'}</option><option value="daily">{english ? 'Every day' : 'Chaque jour'}</option><option value="weekly">{english ? 'Every Monday' : 'Chaque lundi'}</option></select></div>
              <div className="space-y-2"><Label htmlFor="digestHour">{english ? 'Local time' : 'Heure locale'}</Label><Input id="digestHour" name="digestHour" type="number" min={0} max={23} defaultValue={taskPreferences?.digestHour ?? 8} required /></div>
              <div className="space-y-2"><Label htmlFor="taskTimezone">{english ? 'Timezone' : 'Fuseau horaire'}</Label><Input id="taskTimezone" name="timezone" defaultValue={taskPreferences?.timezone ?? timezone} required /></div>
              <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="mentionNotifications" defaultChecked={taskPreferences?.mentionNotifications ?? true} /> {english ? 'Email me when a member mentions me' : 'M’envoyer un email lorsqu’un membre me mentionne'}</label>
              <Button type="submit" variant="outline" className="md:col-span-2 xl:col-span-2">{english ? 'Save my preferences' : 'Enregistrer mes préférences'}</Button>
            </form>
            {taskPreferences?.lastDigestAt && <p className="mt-3 text-xs text-muted-foreground">{english ? 'Last digest processed' : 'Dernier digest traité'} : {taskPreferences.lastDigestAt.toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: taskPreferences.timezone })}</p>}
            {taskPreferences?.lastError && <p role="status" className="mt-3 rounded-lg y-status-warning px-3 py-2 text-xs text-[var(--y-warning)]">{english ? 'Your last notification could not be confirmed. Contact your workspace administrator if this persists.' : 'Votre dernière notification n’a pas pu être confirmée. Contactez l’administrateur de votre espace si cela persiste.'}</p>}
  </>
}
