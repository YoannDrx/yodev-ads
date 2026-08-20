import { CalendarClock, FileText, Link2, LockKeyhole, Plus, Power, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  createReportSchedule,
  createReportTemplate,
  createShareLink,
  deactivateReportTemplate,
  revokeShareLink,
  rotateScheduledReportToken,
  toggleReportSchedule,
  updateReportTemplate,
} from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { SecretRevelation } from '@/components/api-key-revelation'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { listReportAutomation, listShareLinks, listWorkspaceClients } from '@/lib/data'
import { featureEnabled } from '@/lib/feature-flags'
import { permissionsForRole } from '@/lib/permissions'
import { requireWorkspacePermission } from '@/lib/workspace'

const weekdays: Record<'fr' | 'en', Record<number, string>> = {
  fr: { 1: 'lundi', 2: 'mardi', 3: 'mercredi', 4: 'jeudi', 5: 'vendredi', 6: 'samedi', 7: 'dimanche' },
  en: { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' },
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; reveal?: string }>
}) {
  const query = await searchParams
  const { workspace, role } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const [links, clients, automation] = await Promise.all([
    listShareLinks(workspace.id),
    listWorkspaceClients(workspace.id),
    listReportAutomation(workspace.id),
  ])
  const advertiserClients = clients.filter((client) => !client.isManager)
  const canManage = permissionsForRole(role).has('reports:manage')
  const schedulesEnabled = featureEnabled('scheduler') && featureEnabled('notifications')

  return (
    <>
      <PageHeading
        eyebrow={english ? 'Client portal' : 'Portail client'}
        title={english ? 'Shareable reports' : 'Rapports partageables'}
        description={english ? 'Create an up-to-date portal, apply an editorial template and schedule delivery without exposing its token in internal screens.' : 'Créez un portail actualisé, appliquez un modèle éditorial et programmez sa diffusion sans exposer le token dans les écrans internes.'}
      />
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      {query.reveal === 'report-url' && (
        <SecretRevelation title={english ? 'New report link · one-time reveal' : 'Nouveau lien de rapport · révélation unique'} buttonLabel={english ? 'Reveal link now' : 'Révéler le lien maintenant'} />
      )}

      {canManage && schedulesEnabled && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-[#dde4e7] shadow-none">
            <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-5 text-[#176646]" />{english ? 'Create one-off report' : 'Créer un rapport ponctuel'}</CardTitle></CardHeader>
            <CardContent>
              <form action={createShareLink} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={english ? 'Internal name' : 'Nom interne'} htmlFor="report-label"><Input id="report-label" name="label" placeholder={english ? 'ACME monthly report' : 'Reporting mensuel ACME'} required /></Field>
                  <Field label={english ? 'Client account' : 'Compte client'} htmlFor="report-client"><select id="report-client" name="clientId" className="h-10 w-full rounded-lg border bg-white px-3 text-sm" required>{advertiserClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field>
                  <Field label={english ? 'Language' : 'Langue'} htmlFor="report-locale"><select id="report-locale" name="locale" className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="fr">Français</option><option value="en">English</option></select></Field>
                  <Field label={english ? 'Period' : 'Période'} htmlFor="report-period"><select id="report-period" name="periodDays" className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="7">7 {english ? 'days' : 'jours'}</option><option value="30">30 {english ? 'days' : 'jours'}</option><option value="90">90 {english ? 'days' : 'jours'}</option></select></Field>
                </div>
                <Field label={english ? 'Editorial comment' : 'Commentaire éditorial'} htmlFor="report-comment"><Textarea id="report-comment" name="editorialComment" maxLength={5000} placeholder={english ? 'What the client should take away from this period…' : 'Ce que le client doit retenir de la période…'} /></Field>
                <Field label={english ? 'Action plan' : 'Plan d’action'} htmlFor="report-plan"><Textarea id="report-plan" name="actionPlan" maxLength={5000} placeholder={english ? 'Decisions and next steps…' : 'Décisions et prochaines étapes…'} /></Field>
                <Button type="submit" className="w-full"><Link2 className="mr-2 size-4" />{english ? 'Generate link' : 'Générer le lien'}</Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-[#dde4e7] shadow-none">
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="size-5 text-[#176646]" />{english ? 'Create editorial template' : 'Créer un modèle éditorial'}</CardTitle></CardHeader>
            <CardContent>
              <form action={createReportTemplate} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={english ? 'Template name' : 'Nom du modèle'} htmlFor="template-name"><Input id="template-name" name="name" placeholder={english ? 'Monthly review' : 'Bilan mensuel'} required /></Field>
                  <Field label={english ? 'Language' : 'Langue'} htmlFor="template-locale"><select id="template-locale" name="locale" className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="fr">Français</option><option value="en">English</option></select></Field>
                  <Field label={english ? 'Period' : 'Période'} htmlFor="template-period"><select id="template-period" name="periodDays" className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="7">7 {english ? 'days' : 'jours'}</option><option value="30">30 {english ? 'days' : 'jours'}</option><option value="90">90 {english ? 'days' : 'jours'}</option></select></Field>
                </div>
                <Field label={english ? 'Reusable comment' : 'Commentaire réutilisable'} htmlFor="template-comment"><Textarea id="template-comment" name="editorialComment" maxLength={5000} placeholder={english ? 'Editorial context shared by each delivery…' : 'Contexte éditorial commun à chaque envoi…'} /></Field>
                <Field label={english ? 'Reusable action plan' : 'Plan d’action réutilisable'} htmlFor="template-plan"><Textarea id="template-plan" name="actionPlan" maxLength={5000} placeholder={english ? 'Next-step structure…' : 'Structure des prochaines étapes…'} /></Field>
                <Button type="submit" variant="outline" className="w-full">{english ? 'Save template' : 'Enregistrer le modèle'}</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {canManage && automation.templates.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{english ? 'Active templates and versions' : 'Modèles actifs et versions'}</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {automation.templates.map((template) => (
              <Card key={template.id} className="border-[#dde4e7] shadow-none">
                <CardContent className="p-5">
                  <form action={updateReportTemplate} className="space-y-3">
                    <input type="hidden" name="templateId" value={template.id} />
                    <input type="hidden" name="expectedVersion" value={template.currentVersion} />
                    <div className="flex items-center justify-between gap-3"><strong className="text-sm">Version {template.currentVersion}</strong><span className="text-xs text-muted-foreground">{english ? 'Existing deliveries remain frozen' : 'Les envois existants restent figés'}</span></div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Input name="name" defaultValue={template.name} required aria-label={english ? 'Template name' : 'Nom du modèle'} />
                      <select name="locale" defaultValue={template.locale} aria-label={english ? 'Template language' : 'Langue du modèle'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="fr">Français</option><option value="en">English</option></select>
                      <select name="periodDays" defaultValue={template.periodDays} aria-label={english ? 'Template period' : 'Période du modèle'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="7">7 {english ? 'days' : 'jours'}</option><option value="30">30 {english ? 'days' : 'jours'}</option><option value="90">90 {english ? 'days' : 'jours'}</option></select>
                    </div>
                    <Textarea name="editorialComment" defaultValue={template.editorialComment ?? ''} maxLength={5000} aria-label={english ? 'Template editorial comment' : 'Commentaire éditorial du modèle'} />
                    <Textarea name="actionPlan" defaultValue={template.actionPlan ?? ''} maxLength={5000} aria-label={english ? 'Template action plan' : 'Plan d’action du modèle'} />
                    <div className="flex justify-between gap-2"><Button type="submit" size="sm" variant="outline">{english ? 'Save new version' : 'Enregistrer une version'}</Button></div>
                  </form>
                  <form action={deactivateReportTemplate} className="mt-2"><input type="hidden" name="templateId" value={template.id} /><Button type="submit" size="sm" variant="ghost"><Trash2 className="mr-2 size-4" />{english ? 'Deactivate' : 'Désactiver'}</Button></form>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {canManage && (
        <Card className="mt-6 border-[#dce5e7] shadow-none">
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-[#176646]" />{english ? 'Schedule delivery' : 'Programmer un envoi'}</CardTitle></CardHeader>
          <CardContent>
            <form action={createReportSchedule} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label={english ? 'Name' : 'Nom'} htmlFor="schedule-name"><Input id="schedule-name" name="name" placeholder={english ? 'ACME monthly review' : 'Bilan mensuel ACME'} required /></Field>
              <Field label={english ? 'Account' : 'Compte'} htmlFor="schedule-client"><select id="schedule-client" name="clientId" className="h-10 w-full rounded-lg border bg-white px-3 text-sm" required>{advertiserClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field>
              <Field label={english ? 'Template' : 'Modèle'} htmlFor="schedule-template"><select id="schedule-template" name="templateId" className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="">{english ? 'Standard 30-day report' : 'Rapport standard 30 jours'}</option>{automation.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
              <Field label={english ? 'Cadence' : 'Cadence'} htmlFor="schedule-cadence"><select id="schedule-cadence" name="cadence" className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="monthly">{english ? 'Monthly' : 'Mensuelle'}</option><option value="weekly">{english ? 'Weekly' : 'Hebdomadaire'}</option></select></Field>
              <Field label={english ? 'Weekday (1–7)' : 'Jour semaine (1–7)'} htmlFor="schedule-weekday"><Input id="schedule-weekday" name="scheduleWeekday" type="number" min={1} max={7} defaultValue={1} required /></Field>
              <Field label={english ? 'Day of month (1–28)' : 'Jour du mois (1–28)'} htmlFor="schedule-monthday"><Input id="schedule-monthday" name="scheduleMonthday" type="number" min={1} max={28} defaultValue={1} required /></Field>
              <Field label={english ? 'Local hour' : 'Heure locale'} htmlFor="schedule-hour"><Input id="schedule-hour" name="sendHour" type="number" min={0} max={23} defaultValue={8} required /></Field>
              <Field label={english ? 'Timezone' : 'Fuseau'} htmlFor="schedule-timezone"><Input id="schedule-timezone" name="timezone" defaultValue={workspace.timezone} required /></Field>
              <div className="md:col-span-2 xl:col-span-4"><Field label={english ? 'Recipients (comma or newline separated)' : 'Destinataires (séparés par virgule ou ligne)'} htmlFor="schedule-recipients"><Textarea id="schedule-recipients" name="recipients" placeholder="client@example.com, direction@example.com" maxLength={5000} required /></Field></div>
              <Button type="submit" className="md:col-span-2 xl:col-span-4">{english ? 'Create schedule' : 'Créer la planification'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {schedulesEnabled && <section className="mt-8">
        <h2 className="text-lg font-semibold">{english ? 'Scheduled deliveries' : 'Envois planifiés'}</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {automation.schedules.map(({ schedule, client, template }) => (
            <Card key={schedule.id} className="border-[#dde4e7] shadow-none">
              <CardContent className="flex h-full flex-col justify-between gap-4 p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={schedule.enabled ? 'active' : 'paused'} locale={locale} /><span className="text-xs text-muted-foreground">{template?.name ?? (english ? 'Standard template' : 'Modèle standard')}</span></div>
                  <h3 className="mt-3 font-semibold">{schedule.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{client.name} · {schedule.cadence === 'weekly' ? `${english ? 'every' : 'chaque'} ${weekdays[locale][schedule.scheduleWeekday ?? 1]}` : english ? `on day ${schedule.scheduleMonthday} of the month` : `le ${schedule.scheduleMonthday} du mois`} {english ? 'at' : 'à'} {String(schedule.sendHour).padStart(2, '0')}:00 · {schedule.timezone}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{schedule.recipientEmails.length} {english ? `recipient${schedule.recipientEmails.length === 1 ? '' : 's'}` : `destinataire${schedule.recipientEmails.length > 1 ? 's' : ''}`}{schedule.lastDeliveredAt ? ` · ${english ? 'last delivery' : 'dernier envoi'} ${schedule.lastDeliveredAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}` : english ? ' · no delivery yet' : ' · aucun envoi'}</p>
                  {schedule.lastError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{schedule.lastError}</p>}
                </div>
                {canManage && <div className="flex flex-wrap gap-2"><form action={toggleReportSchedule}><input type="hidden" name="scheduleId" value={schedule.id} /><input type="hidden" name="operation" value={schedule.enabled ? 'disable' : 'enable'} /><Button type="submit" size="sm" variant="outline"><Power className="mr-2 size-4" />{schedule.enabled ? english ? 'Suspend and revoke' : 'Suspendre et révoquer' : english ? 'Reactivate' : 'Réactiver'}</Button></form>{schedule.enabled && <form action={rotateScheduledReportToken}><input type="hidden" name="scheduleId" value={schedule.id} /><Button type="submit" size="sm" variant="ghost">{english ? 'Renew link' : 'Renouveler le lien'}</Button></form>}</div>}
              </CardContent>
            </Card>
          ))}
          {automation.schedules.length === 0 && <div className="rounded-3xl border border-dashed bg-white p-10 text-center text-muted-foreground">{english ? 'No scheduled delivery.' : 'Aucun envoi planifié.'}</div>}
        </div>
      </section>}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{english ? 'Active and historical links' : 'Liens actifs et historiques'}</h2>
        <div className="mt-3 space-y-3">
          {links.map(({ share, client }) => (
            <Card key={share.id} className="border-[#dde4e7] shadow-none"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><StatusBadge status={share.active ? 'active' : 'revoked'} locale={locale} /><span className="font-mono text-[10px] text-muted-foreground">{share.tokenPrefix}••••</span></div><h3 className="mt-3 font-semibold">{share.label}</h3><p className="mt-1 text-xs text-muted-foreground">{client.name} · {share.locale.toUpperCase()} · {share.periodDays} {english ? 'days' : 'jours'} · {english ? 'created on' : 'créé le'} {share.createdAt.toLocaleDateString(english ? 'en-GB' : 'fr-FR')}{share.expiresAt ? ` · ${english ? 'expires on' : 'expire le'} ${share.expiresAt.toLocaleDateString(english ? 'en-GB' : 'fr-FR')}` : ''}</p></div>{share.active && canManage && <form action={revokeShareLink}><input type="hidden" name="shareId" value={share.id} /><Button type="submit" size="sm" variant="ghost"><Trash2 className="mr-2 size-4" />{english ? 'Revoke' : 'Révoquer'}</Button></form>}</CardContent></Card>
          ))}
          {links.length === 0 && <div className="rounded-3xl border border-dashed bg-white p-12 text-center text-muted-foreground">{english ? 'No shared report yet.' : 'Aucun rapport partagé pour le moment.'}</div>}
        </div>
      </section>

      <div className="mt-6 flex gap-3 rounded-xl bg-[#f4f7f8] p-3 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#176646]" />{english ? 'Tokens stay out of internal URLs and logs. Scheduled deliveries use an idempotency key and their link is revoked as soon as they are suspended.' : 'Les tokens restent hors des URL internes et des journaux. Un envoi planifié utilise une clé d’idempotence et le lien est révoqué dès sa suspension.'}</div>
    </>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return <div><label className="mb-2 block text-sm font-medium" htmlFor={htmlFor}>{label}</label>{children}</div>
}
