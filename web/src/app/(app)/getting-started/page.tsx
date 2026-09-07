import Link from 'next/link'
import { Check, Circle, Rocket } from 'lucide-react'
import { PageHeading } from '@/components/page-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { notFound } from 'next/navigation'
import { getGettingStartedEvidence } from '@/lib/getting-started-data'
import { gettingStartedSteps } from '@/lib/getting-started-model'
import { workspaceDecision } from '@/lib/workspace-decision'
import { featureEnabled } from '@/lib/feature-flags'
import { requireWorkspacePagePermission } from '@/lib/workspace'

export default async function GettingStartedPage() {
  const { workspace, role, session, entitlements } = await requireWorkspacePagePermission('portfolio:read', '/getting-started')
  const english = workspace.locale === 'en'
  const evidence = await getGettingStartedEvidence(workspace.id, session.userId)
  if (!evidence) notFound()
  const base = { role, state: workspace.accessState, entitlements }
  const access = {
    settings: workspaceDecision({ ...base, permission: 'workspace:read' }),
    google: workspaceDecision({ ...base, permission: 'google:connect', capability: 'google.read', features: ['googleReads'] }),
    accounts: workspaceDecision({ ...base, permission: 'google:connect' }),
    goal: workspaceDecision({ ...base, permission: 'workspace:admin' }),
    monitor: workspaceDecision({ ...base, permission: 'monitoring:run', capability: 'monitoring' }),
    report: workspaceDecision({ ...base, permission: 'reports:manage', capability: 'monitoring' }),
    legal: workspaceDecision({ ...base, permission: 'billing:manage', features: ['stripeCheckout'] }),
  }
  const steps = gettingStartedSteps(evidence, access, english, featureEnabled('googleReads') && featureEnabled('scheduler'))
  const required = steps.filter((step) => step.required)
  const completed = required.filter((step) => step.complete).length
  const progress = Math.round(completed / required.length * 100)
  const next = required.find((step) => !step.complete)

  return (
    <>
      <PageHeading eyebrow={english ? 'Guided setup' : 'Démarrage guidé'} title={english ? 'Set up your agency' : 'Préparer votre agence'} description={english ? 'Follow the setup steps and the evidence of your first analysis and published report.' : 'Suivez la configuration de l’agence et les preuves de votre première analyse et de votre premier rapport publié.'} actions={next?.href ? <Button asChild><Link href={next.href}>{next.action}</Link></Button> : undefined} />
      <Card className="mb-6 overflow-hidden border-[#dce5e7] shadow-none"><CardContent className="p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Rocket className="size-5" /></span><div><p className="font-semibold">{english ? 'Product setup' : 'Démarrage produit'} {completed}/{required.length}</p><p className="text-sm text-muted-foreground">{next ? `${english ? 'Next step' : 'Prochaine étape'} : ${next.title}` : english ? 'Initial setup and publication milestones reached. Check current service and link availability before use.' : 'Configuration initiale et jalons de publication atteints. Vérifiez la disponibilité actuelle des services et des liens avant utilisation.'}</p></div></div><Badge variant="outline">{progress} %</Badge></div><progress aria-label={english ? 'Product setup progress' : 'Progression du démarrage produit'} value={completed} max={required.length} className="mt-5 h-2 w-full accent-emerald-500" />{next?.help && <p className="mt-3 text-sm text-muted-foreground">{next.help}</p>}</CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {steps.map((step, index) => <Card key={step.key} data-setup-step={step.key} data-complete={String(step.complete)} className={`shadow-none ${step.complete ? 'border-emerald-200 bg-emerald-50/30' : 'border-[#dce5e7]'}`}><CardContent className="flex gap-4 p-5"><span aria-hidden="true" className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${step.complete ? 'bg-emerald-600 text-white' : 'border bg-white text-slate-400'}`}>{step.complete ? <Check className="size-4" /> : <Circle className="size-4" />}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-muted-foreground">{step.required ? `${english ? 'Step' : 'Étape'} ${index + 1}` : english ? 'Before subscribing · outside product progress' : 'Avant abonnement · hors progression produit'} · {step.complete ? english ? 'Completed' : 'Validé' : english ? 'To complete' : 'À réaliser'}</p><h2 className="mt-1 font-semibold">{step.title}</h2><p className="mt-1 text-sm text-muted-foreground">{step.description}</p>{step.help && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">{english ? 'Help with this step' : 'Aide pour cette étape'}</summary><p className="mt-2 text-muted-foreground">{step.help}</p></details>}{step.href && <Button asChild variant="link" className="mt-2 h-auto whitespace-normal p-0 text-left"><Link href={step.href}>{step.complete ? english ? 'Review' : 'Consulter' : step.action}</Link></Button>}</div></CardContent></Card>)}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">{english ? 'Still stuck? Open a support request with the step and the account concerned. Never include passwords or access tokens.' : 'Toujours bloqué ? Ouvrez une demande de support en indiquant l’étape et le compte concernés. N’incluez jamais de mots de passe ou de jetons d’accès.'} <Link href="/support" className="underline">{english ? 'Contact support' : 'Contacter le support'}</Link></p>
    </>
  )
}
