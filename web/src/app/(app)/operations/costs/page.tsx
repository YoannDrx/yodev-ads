import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { OperatingCostForm } from '@/components/operating-cost-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { COST_CATEGORIES, COST_PLANS, COST_PLAN_LABELS, costMonthSchema, unitsToDecimal } from '@/lib/operating-cost-model'
import { OperatingCostAccessDenied, getOperatingCostSnapshot } from '@/lib/operating-costs'
import { requireWorkspace } from '@/lib/workspace'
import { permissionsForRole } from '@/lib/permissions'

function money(value: bigint | null, currency: string) { return value === null ? 'Non renseigné' : `${unitsToDecimal(value)} ${currency}` }
export default async function OperatingCostsPage({ searchParams }: { searchParams: Promise<{ month?: string; after?: string; notice?: string; error?: string }> }) {
  const query = await searchParams
  const { workspace, session, role } = await requireWorkspace()
  if (workspace.accessState !== 'internal' || !permissionsForRole(role).has('workspace:admin')) notFound()
  const parsed = costMonthSchema.safeParse(query.month ?? new Date().toISOString().slice(0, 7))
  if (!parsed.success || parsed.data > new Date().toISOString().slice(0, 7) || (query.after?.length ?? 0) > 100) notFound()
  const snapshot = await getOperatingCostSnapshot({ operatorWorkspaceId: workspace.id, actorUserId: session.userId, month: parsed.data, after: query.after }).catch((error) => {
    if (error instanceof OperatingCostAccessDenied) notFound()
    throw error
  })
  return <>
    <PageHeading eyebrow="Exploitation Yodev" title="Coûts par offre" description="Contributions documentées, répartitions et estimations. Les données manquantes ne valent pas zéro ; aucun total ne certifie la réception de toutes les factures." />
    <Link href="/operations" className="text-sm underline">Retour aux opérations</Link>
    <FlashMessage notice={query.notice} error={query.error} />
    <form className="my-5 flex flex-wrap items-end gap-3"><label className="text-sm">Mois observé (UTC)<input className="ml-2 rounded-lg border p-2" type="month" name="month" min="2000-01" max={new Date().toISOString().slice(0, 7)} defaultValue={snapshot.month} required /></label><button className="rounded-lg border px-4 py-2 text-sm">Afficher</button></form>
    <p className="mb-4 text-sm text-muted-foreground">Situation au {snapshot.asOf} · {snapshot.activeReferences} références actives sur {snapshot.totalReferences}. Le mois courant est incomplet. Les offres d’essai et internes sont séparées des offres vendues ; les monnaies restent séparées.</p>
    <Card className="mb-6 shadow-none"><CardHeader><CardTitle>Contributions au coût mensuel</CardTitle></CardHeader><CardContent>
      <p className="mb-4 text-sm text-muted-foreground">Les parts réparties proviennent d’un montant justifié, mais leur attribution dépend de la méthode choisie. Une répartition manuelle reste estimée. Les dépenses publicitaires Google ne sont jamais des coûts d’exploitation Yodev. Les postes facturés ensemble doivent être saisis une seule fois pour éviter les doublons entre collectes et fonctions.</p>
      <div role="region" aria-label="Coûts par offre et par poste" tabIndex={0} className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr>{['Poste / devise','Offre','Documenté direct / non réparti','Documenté réparti','Estimé','Minutes documentées / estimées','Références'].map((label) => <th scope="col" key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{snapshot.cells.map((cell) => <tr key={`${cell.currency}:${cell.category}:${cell.plan}`} data-cost-cell={`${cell.currency}:${cell.category}:${cell.plan}`} className="border-t"><th scope="row" className="p-3">{COST_CATEGORIES[cell.category]} / {cell.currency}</th><td className="p-3">{COST_PLAN_LABELS[cell.plan]}</td><td className="p-3">{money(cell.documentedDirect, cell.currency)}</td><td className="p-3">{money(cell.documentedAllocated, cell.currency)}</td><td className="p-3">{money(cell.estimated, cell.currency)}</td><td className="p-3">{cell.supportHundredths === null ? '—' : unitsToDecimal(cell.supportHundredths, 2)} / {cell.estimatedSupportHundredths === null ? '—' : unitsToDecimal(cell.estimatedSupportHundredths, 2)}{cell.unpricedSupport && <span className="block">Valorisation incomplète</span>}</td><td className="p-3">{cell.sources}</td></tr>)}</tbody></table></div>
      {!snapshot.cells.length && <p className="mt-4">Aucune contribution renseignée pour cette période.</p>}
      <p className="mt-4 text-sm">Postes sans observation active : {Object.entries(COST_CATEGORIES).filter(([key]) => !snapshot.cells.some((cell) => cell.category === key)).map(([, label]) => label).join(', ') || 'aucun ; vérifier encore la couverture des justificatifs'}. Un poste présent peut rester incomplet pour certaines offres.</p>
    </CardContent></Card>
    <Card className="mb-6 shadow-none"><CardHeader><CardTitle>Usages observés dans les traitements conservés</CardTitle></CardHeader><CardContent>
      <p className="mb-4 text-sm text-muted-foreground">Forfait capturé au démarrage des nouvelles tentatives. L’historique antérieur reste inconnu ; les tâches système restent non réparties. Ces compteurs incluent les reprises et les échecs. Le temps écoulé comprend les attentes réseau et ne représente pas du temps de calcul facturé. Les lectures Google peuvent être bloquées avant tout appel. La rétention ou la suppression d’un workspace peut réduire ces observations ; elles ne constituent pas une archive de facturation.</p>
      <div role="region" aria-label="Usages des traitements par forfait" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead><tr>{['Forfait au démarrage','Tentatives','Dont lectures Google','Terminées avec durée valide','Durée cumulée (ms)'].map((label) => <th scope="col" className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.usage.map((row) => <tr key={row.plan} data-cost-usage={row.plan} className="border-t"><th scope="row" className="p-2">{COST_PLANS.includes(row.plan as typeof COST_PLANS[number]) ? COST_PLAN_LABELS[row.plan as typeof COST_PLANS[number]] : 'Historique inconnu'}</th><td className="p-2">{row.attempts}</td><td className="p-2">{row.googleReadAttempts}</td><td className="p-2">{row.finishedAttempts}</td><td className="p-2">{row.elapsedMs ?? 'Non renseignée'}</td></tr>)}</tbody></table></div>
      {!snapshot.usage.length && <p>Aucune tentative conservée pour ce mois.</p>}
    </CardContent></Card>
    <Card className="mb-6 shadow-none"><CardHeader><CardTitle>Ajouter une observation</CardTitle></CardHeader><CardContent><OperatingCostForm month={snapshot.month} /></CardContent></Card>
    <Card className="mb-6 shadow-none"><CardHeader><CardTitle>Justificatifs et corrections</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm">25 références maximum par page, actives ou retirées. Les contributions ci-dessus couvrent toutes les pages du mois. Corriger une référence conserve son audit ; la retirer l’exclut des calculs sans effacer la preuve.</p>
      {snapshot.entries.map((entry) => <details key={entry.id} className="rounded-xl border p-4"><summary className="cursor-pointer break-all text-sm font-medium">{entry.sourceKey} · v{entry.version} · {entry.voided ? 'Retirée' : 'Active'}</summary><div className="mt-4"><OperatingCostForm entry={entry} month={snapshot.month} /></div></details>)}
      <nav aria-label="Pages des justificatifs" className="flex gap-4">{query.after && <Link className="underline" href={`/operations/costs?month=${snapshot.month}`}>Première page</Link>}{snapshot.next && <Link className="underline" href={`/operations/costs?${new URLSearchParams({ month: snapshot.month, after: snapshot.next })}`}>Page suivante</Link>}</nav>
    </CardContent></Card>
  </>
}
