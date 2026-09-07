import { recordOperatingCost } from '@/app/(app)/operations/costs/actions'
import { COST_CATEGORIES, COST_METHODS, COST_PLANS, COST_PLAN_LABELS, unitsToDecimal, type CostEntry } from '@/lib/operating-cost-model'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const selectClass = 'h-10 w-full rounded-lg border bg-white px-3 text-sm'
export function OperatingCostForm({ entry, month }: { entry?: CostEntry; month: string }) {
  return <form action={recordOperatingCost} className="space-y-4" aria-label={entry ? `Corriger ${entry.sourceKey}` : 'Ajouter une observation de coût'}>
    <input type="hidden" name="expectedVersion" value={entry?.version ?? 0} />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">Référence opaque du justificatif<Input name="sourceKey" required minLength={3} maxLength={100} pattern="[a-zA-Z0-9][a-zA-Z0-9_.:\-]{2,99}" defaultValue={entry?.sourceKey} readOnly={Boolean(entry)} placeholder="facture-2026-09-ligne-1" /></label>
      <label className="text-sm">Mois du service (UTC)<Input name="month" type="month" required min="2000-01" max={new Date().toISOString().slice(0, 7)} defaultValue={entry?.month ?? month} /></label>
      <label className="text-sm">Poste<select className={selectClass} name="category" defaultValue={entry?.category ?? 'collections'}>{Object.entries(COST_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-sm">Devise ISO<Input name="currency" required pattern="[A-Z]{3}" maxLength={3} defaultValue={entry?.currency ?? 'EUR'} /></label>
      <label className="text-sm">Origine du montant / de la durée<select name="basis" className={selectClass} defaultValue={entry?.basis ?? 'documented'}><option value="documented">Justificatif disponible</option><option value="estimated">Estimation</option></select></label>
      <label className="text-sm">Montant hors taxes<Input name="amount" inputMode="decimal" defaultValue={entry?.amountMicros === null || !entry ? '' : unitsToDecimal(entry.amountMicros)} placeholder="12.345678" /></label>
      <label className="text-sm">Minutes de support, si applicable<Input name="supportMinutes" type="number" min="0" step="0.01" defaultValue={entry?.supportMinutes ?? ''} /></label>
      <label className="text-sm">Méthode de répartition<select name="allocationMethod" className={selectClass} defaultValue={entry?.allocationMethod ?? 'unallocated'}>{Object.entries(COST_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {entry ? <label className="text-sm">Prise en compte<select name="voided" className={selectClass} defaultValue={String(entry.voided)}><option value="false">Active</option><option value="true">Retirée des totaux, preuve conservée</option></select></label> : <input type="hidden" name="voided" value="false" />}
    </div>
    <fieldset className="rounded-xl border p-3"><legend className="px-1 text-sm font-medium">Répartition par forfait pendant le mois du service — total 100 %</legend><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{COST_PLANS.map((plan) => <label key={plan} className="text-sm">{COST_PLAN_LABELS[plan]} (%)<Input name={`${plan}Weight`} type="number" min="0" max="100" step="0.01" required defaultValue={entry ? entry[`${plan}Weight`] / 100 : plan === 'unallocated' ? 100 : 0} /></label>)}</div></fieldset>
    <p className="text-xs text-muted-foreground">Une référence par ligne de justificatif, réutilisée pour chaque correction. Aucun nom de client, secret, URL privée ni contenu de facture. Conservez le justificatif et le calcul de répartition dans votre dossier comptable. Montants décimaux avec un point, jusqu’à 6 décimales ; avoirs négatifs admis. Pour le support non valorisé, laissez le montant vide. Une valeur 0 signifie un zéro documenté ou estimé, selon l’origine choisie.</p>
    <Button type="submit">{entry ? `Enregistrer la correction (v${entry.version})` : 'Enregistrer l’observation'}</Button>
  </form>
}
