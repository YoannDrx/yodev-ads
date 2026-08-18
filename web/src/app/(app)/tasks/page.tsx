import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot, MessageCircle, UserRound, Workflow } from 'lucide-react'
import Link from 'next/link'
import { addWorkspaceTaskComment, createWorkspaceTask, updateWorkspaceTask } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { listTaskMentionDirectory, listWorkspaceClients, listWorkspaceTasks } from '@/lib/data'
import { permissionsForRole } from '@/lib/permissions'
import { taskTiming } from '@/lib/task-workflow'
import { requireWorkspacePermission } from '@/lib/workspace'

const statusLabels: Record<'fr' | 'en', Record<string, string>> = {
  fr: { todo: 'À faire', in_progress: 'En cours', blocked: 'Bloquée', done: 'Terminée', cancelled: 'Annulée' },
  en: { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' },
}
const priorityLabels: Record<'fr' | 'en', Record<string, string>> = {
  fr: { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' },
  en: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' },
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; status?: string }> }) {
  const query = await searchParams
  const { workspace, role, session } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const [rows, clients, mentionDirectory] = await Promise.all([
    listWorkspaceTasks(workspace.id),
    listWorkspaceClients(workspace.id),
    listTaskMentionDirectory(workspace.id),
  ])
  const permissions = permissionsForRole(role)
  const canManage = permissions.has('tasks:manage')
  const canComment = permissions.has('tasks:comment')
  const allowedStatus = ['open', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'].includes(query.status ?? '') ? query.status : 'open'
  const tasks = allowedStatus === 'open'
    ? rows.filter(({ task }) => !['done', 'cancelled'].includes(task.status))
    : rows.filter(({ task }) => task.status === allowedStatus)
  const overdue = rows.filter(({ task }) => taskTiming(task.status, task.dueAt) === 'overdue').length
  const dueSoon = rows.filter(({ task }) => taskTiming(task.status, task.dueAt) === 'due_soon').length

  return (
    <>
      <PageHeading eyebrow={english ? 'Agency workflow' : 'Workflow agence'} title={english ? 'Tasks and SLA' : 'Tâches et SLA'} description={english ? 'Turn alerts, approvals and manual actions into assigned, scheduled and auditable commitments.' : 'Transformez alertes, approbations et actions manuelles en engagements assignés, échéancés et auditables.'} />
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <Summary label={english ? 'Open' : 'Ouvertes'} value={rows.filter(({ task }) => !['done', 'cancelled'].includes(task.status)).length} icon={CircleDot} />
        <Summary label={english ? 'Due within 24h' : 'À moins de 24 h'} value={dueSoon} icon={CalendarClock} />
        <Summary label={english ? 'Overdue' : 'En retard'} value={overdue} icon={AlertTriangle} critical={overdue > 0} />
      </section>
      {mentionDirectory.length > 0 && <p className="mb-4 text-xs text-muted-foreground">{english ? 'Available mentions' : 'Mentions disponibles'} : {mentionDirectory.map((member) => `@${member.mentionHandle}`).join(', ')}</p>}
      {canManage && (
        <Card className="mb-6 border-[#dce5e7] shadow-none">
          <CardHeader><CardTitle>{english ? 'Create a manual task' : 'Créer une tâche manuelle'}</CardTitle></CardHeader>
          <CardContent><form action={createWorkspaceTask} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input type="hidden" name="sourceType" value="manual" /><input type="hidden" name="returnTo" value="tasks" />
            <Input name="title" placeholder={english ? 'Operational title' : 'Titre opérationnel'} minLength={2} maxLength={220} required className="md:col-span-2" />
            <select name="clientId" aria-label={english ? 'Client account' : 'Compte client'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="">{english ? 'No account' : 'Aucun compte'}</option>{clients.filter((client) => !client.isManager).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
            <select name="priority" aria-label={english ? 'Priority' : 'Priorité'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="normal">{english ? 'Normal priority' : 'Priorité normale'}</option><option value="high">{english ? 'High priority' : 'Priorité haute'}</option><option value="urgent">{english ? 'Urgent priority' : 'Priorité urgente'}</option><option value="low">{english ? 'Low priority' : 'Priorité basse'}</option></select>
            <Textarea name="description" placeholder={english ? 'Context, expected outcome and completion criteria' : 'Contexte, résultat attendu et critères de fin'} maxLength={5000} className="md:col-span-2" />
            <Input name="dueDate" type="date" aria-label={english ? 'Explicit due date' : 'Échéance explicite'} />
            <select name="slaHours" aria-label="SLA" className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="">{english ? 'No automatic SLA' : 'Sans SLA automatique'}</option><option value="4">SLA 4 {english ? 'hours' : 'heures'}</option><option value="24">SLA 24 {english ? 'hours' : 'heures'}</option><option value="72">SLA 3 {english ? 'days' : 'jours'}</option><option value="168">SLA 7 {english ? 'days' : 'jours'}</option></select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="assignSelf" /> {english ? 'Assign to me' : 'Me l’assigner'}</label>
            <Button type="submit"><Workflow className="mr-2 size-4" />{english ? 'Create task' : 'Créer la tâche'}</Button>
          </form></CardContent>
        </Card>
      )}
      <form className="mb-5 flex flex-wrap gap-2">{['open', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'].map((status) => <Button key={status} name="status" value={status} type="submit" size="sm" variant={allowedStatus === status ? 'default' : 'outline'}>{status === 'open' ? english ? 'Open' : 'Ouvertes' : statusLabels[locale][status]}</Button>)}</form>
      <div className="space-y-4">
        {tasks.map(({ task, client, comments }) => {
          const timing = taskTiming(task.status, task.dueAt)
          const sourceHref = task.sourceType === 'alert' ? '/alerts' : task.sourceType === 'approval' ? '/approvals' : task.sourceType === 'report' ? '/reports' : null
          return <Card key={task.id} className={`[content-visibility:auto] shadow-none ${timing === 'overdue' ? 'border-red-300' : timing === 'due_soon' ? 'border-amber-300' : 'border-[#dce5e7]'}`}><CardContent className="p-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:justify-between">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><StatusBadge status={task.status} locale={locale} /><Badge variant={task.priority === 'urgent' ? 'destructive' : 'outline'}>{priorityLabels[locale][task.priority] ?? task.priority}</Badge>{timing === 'overdue' && <Badge variant="destructive">{english ? 'SLA breached' : 'SLA dépassé'}</Badge>}{timing === 'due_soon' && <Badge className="bg-amber-100 text-amber-900">{english ? 'Due soon' : 'Échéance proche'}</Badge>}</div><h2 className="mt-3 font-semibold">{task.title}</h2>{task.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{task.description}</p>}<p className="mt-3 text-xs text-muted-foreground">{client?.name ?? (english ? 'No account' : 'Sans compte')} · {sourceHref ? <Link href={sourceHref} className="underline underline-offset-2">source {task.sourceType}</Link> : `source ${task.sourceType}`}{task.dueAt ? ` · ${english ? 'due' : 'échéance'} ${task.dueAt.toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: workspace.timezone })}` : ''}{task.slaMinutes ? ` · ${english ? 'initial SLA' : 'SLA initial'} ${Math.round(task.slaMinutes / 60)} h` : ''}</p><div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">{task.assignedTo && <span className="inline-flex items-center gap-1"><UserRound className="size-3" />{task.assignedTo === session.userId ? english ? 'Assigned to me' : 'Assignée à moi' : english ? 'Assigned to a member' : 'Assignée à un membre'}</span>}<span>{statusLabels[locale][task.status] ?? task.status}</span></div></div>
              {canManage && <div className="grid min-w-64 gap-2"><form action={updateWorkspaceTask} className="grid gap-2"><input type="hidden" name="taskId" value={task.id} /><select name="operation" aria-label={english ? 'Transition' : 'Transition'} className="h-9 rounded-lg border bg-white px-3 text-xs">{task.status === 'todo' && <option value="start">{english ? 'Start' : 'Démarrer'}</option>}{task.status === 'blocked' && <option value="start">{english ? 'Resume' : 'Reprendre'}</option>}{['todo', 'in_progress'].includes(task.status) && <option value="block">{english ? 'Block' : 'Bloquer'}</option>}{['todo', 'in_progress', 'blocked'].includes(task.status) && <option value="complete">{english ? 'Complete' : 'Terminer'}</option>}{['done', 'cancelled'].includes(task.status) && <option value="reopen">{english ? 'Reopen' : 'Rouvrir'}</option>}{!['done', 'cancelled'].includes(task.status) && <option value="cancel">{english ? 'Cancel' : 'Annuler'}</option>}<option value={task.assignedTo === session.userId ? 'unassign' : 'assign_self'}>{task.assignedTo === session.userId ? english ? 'Remove my assignment' : 'Retirer mon assignation' : english ? 'Assign to me' : 'Me l’assigner'}</option></select><Button type="submit" size="sm" variant="outline">{english ? 'Apply' : 'Appliquer'}</Button></form><form action={updateWorkspaceTask} className="flex gap-2"><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="operation" value="update_due" /><Input name="dueDate" type="date" defaultValue={task.dueAt?.toLocaleDateString('en-CA', { timeZone: workspace.timezone })} required className="h-9" /><Button type="submit" size="sm" variant="outline">{english ? 'Due date' : 'Échéance'}</Button></form>{task.dueAt && <form action={updateWorkspaceTask}><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="operation" value="clear_due" /><Button type="submit" size="sm" variant="ghost" className="w-full">{english ? 'Remove due date' : 'Retirer l’échéance'}</Button></form>}</div>}
            </div>
            <div className="mt-5 border-t pt-4"><div className="space-y-2">{comments.map((comment) => <div key={comment.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm"><p className="whitespace-pre-wrap">{comment.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{comment.authorUserId === session.userId ? english ? 'Me' : 'Moi' : english ? 'Member' : 'Membre'} · {comment.createdAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}{comment.mentions.length ? ` · mentions ${comment.mentions.join(', ')}` : ''}</p></div>)}</div>{canComment && <form action={addWorkspaceTaskComment} className="mt-3 flex gap-2"><input type="hidden" name="taskId" value={task.id} /><Input name="body" aria-label={english ? 'Task comment' : 'Commentaire de tâche'} placeholder={english ? 'Comment; mention someone with @handle' : 'Commenter, mention possible avec @identifiant'} maxLength={4000} required /><Button type="submit" variant="outline" aria-label={english ? 'Add comment' : 'Ajouter le commentaire'}><MessageCircle className="size-4" /></Button></form>}</div>
          </CardContent></Card>
        })}
        {!tasks.length && <div className="rounded-3xl border border-dashed bg-white p-14 text-center"><CheckCircle2 className="mx-auto size-8 text-emerald-500" /><h2 className="mt-4 font-semibold">{english ? 'No task in this view' : 'Aucune tâche dans cette vue'}</h2><p className="mt-2 text-sm text-muted-foreground">{english ? 'Create a manual task or turn an alert into a tracked action.' : 'Créez une tâche manuelle ou transformez une alerte en action suivie.'}</p></div>}
      </div>
    </>
  )
}

function Summary({ label, value, icon: Icon, critical = false }: { label: string; value: number; icon: typeof CircleDot; critical?: boolean }) {
  return <Card className="shadow-none"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div><span className={`grid size-11 place-items-center rounded-2xl ${critical ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}><Icon className="size-5" /></span></CardContent></Card>
}
