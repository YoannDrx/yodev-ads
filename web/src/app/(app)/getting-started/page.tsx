import Link from 'next/link'
import { Check, Circle, Rocket } from 'lucide-react'
import { PageHeading } from '@/components/page-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getClientGoalAndPacing, getWorkspaceConnection, listMonitoringAgents, listShareLinks, listWorkspaceClients } from '@/lib/data'
import { requireWorkspace } from '@/lib/workspace'

export default async function GettingStartedPage() {
  const { workspace } = await requireWorkspace()
  const english = workspace.locale === 'en'
  const [connection, clients, agents, reports] = await Promise.all([
    getWorkspaceConnection(workspace.id),
    listWorkspaceClients(workspace.id),
    listMonitoringAgents(workspace.id),
    listShareLinks(workspace.id),
  ])
  const client = clients.find((item) => !item.isManager)
  const goal = client ? await getClientGoalAndPacing(workspace.id, client.id, client.timezone) : undefined
  const steps = [
    { key: 'workspace', title: english ? 'Organization created' : 'Organisation créée', description: english ? 'The tenant-isolated workspace is ready.' : 'Le workspace tenanté est prêt.', complete: true, href: '/settings', action: english ? 'View settings' : 'Voir les réglages' },
    { key: 'legal', title: english ? 'Commercial terms accepted' : 'Cadre commercial accepté', description: english ? 'The terms and privacy versions have been recorded.' : 'Versions des CGV et de la confidentialité enregistrées.', complete: Boolean(workspace.termsVersion && workspace.privacyVersion), href: '/billing', action: english ? 'Configure account' : 'Configurer le compte' },
    { key: 'google', title: english ? 'Google Ads connected' : 'Google Ads connecté', description: english ? 'OAuth and MCC are active for this workspace.' : 'OAuth et MCC actifs pour cet espace.', complete: connection?.status === 'active', href: '/settings', action: english ? 'Connect Google Ads' : 'Connecter Google Ads' },
    { key: 'client', title: english ? 'First account synchronized' : 'Premier compte synchronisé', description: english ? 'At least one non-manager advertiser account is available.' : 'Au moins un compte annonceur non-MCC est disponible.', complete: Boolean(client), href: '/accounts', action: english ? 'Synchronize accounts' : 'Synchroniser les comptes' },
    { key: 'goal', title: english ? 'Client goal defined' : 'Objectif client défini', description: english ? 'KPI, budget and target now drive pacing.' : 'KPI, budget et cible alimentent le pacing.', complete: Boolean(goal?.goal), href: client ? `/dashboard?client=${client.id}` : '/dashboard', action: english ? 'Define goal' : 'Définir l’objectif' },
    { key: 'monitoring', title: english ? 'First monitor active' : 'Première vigie active', description: english ? 'An explainable monitoring rule is configured.' : 'Une surveillance explicable est configurée.', complete: agents.some(({ agent }) => agent.enabled), href: '/agents', action: english ? 'Create a monitor' : 'Créer une vigie' },
    { key: 'report', title: english ? 'First report created' : 'Premier rapport créé', description: english ? 'A revocable client portal has been generated.' : 'Un portail client révocable a été généré.', complete: reports.length > 0, href: '/reports', action: english ? 'Create a report' : 'Créer un rapport' },
  ]
  const completed = steps.filter((step) => step.complete).length
  const progress = Math.round(completed / steps.length * 100)
  const next = steps.find((step) => !step.complete)

  return (
    <>
      <PageHeading eyebrow={english ? 'Guided onboarding' : 'Onboarding guidé'} title={english ? 'Bring the workspace online' : 'Mettre le workspace en service'} description={english ? 'A verifiable path from account setup to the first report. Visual progress never replaces server-side controls.' : 'Une progression vérifiable du compte jusqu’au premier rapport. Aucune étape visuelle ne remplace les contrôles serveur.'} actions={next ? <Button asChild><Link href={next.href}>{next.action}</Link></Button> : undefined} />
      <Card className="mb-6 overflow-hidden border-[#dce5e7] shadow-none"><CardContent className="p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Rocket className="size-5" /></span><div><p className="font-semibold">{english ? 'Activation' : 'Activation'} {completed}/{steps.length}</p><p className="text-sm text-muted-foreground">{next ? `${english ? 'Next step' : 'Prochaine étape'} : ${next.title}` : english ? 'Initial journey complete.' : 'Parcours initial terminé.'}</p></div></div><Badge variant="outline">{progress} %</Badge></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></div></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {steps.map((step, index) => <Card key={step.key} className={`shadow-none ${step.complete ? 'border-emerald-200 bg-emerald-50/30' : 'border-[#dce5e7]'}`}><CardContent className="flex gap-4 p-5"><span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${step.complete ? 'bg-emerald-600 text-white' : 'border bg-white text-slate-400'}`}>{step.complete ? <Check className="size-4" /> : <Circle className="size-4" />}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-muted-foreground">{english ? 'Step' : 'Étape'} {index + 1}</p><h2 className="mt-1 font-semibold">{step.title}</h2><p className="mt-1 text-sm text-muted-foreground">{step.description}</p><Button asChild variant="link" className="mt-2 h-auto p-0"><Link href={step.href}>{step.complete ? english ? 'Review' : 'Consulter' : step.action}</Link></Button></div></CardContent></Card>)}
      </div>
    </>
  )
}
