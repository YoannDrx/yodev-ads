'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { updateManagedAccounts } from '@/app/account-selection-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { accountSelectionPreview, type AccountSelection } from '@/lib/account-selection-model'
import { formatCustomerId } from '@/lib/ids'

type Account = AccountSelection & { name: string; currencyCode: string; timezone: string; inventoryObservedAt: string | null }
function SaveButtons({ english, overQuota, sameSelection }: { english: boolean; overQuota: boolean; sameSelection: boolean }) {
  const { pending } = useFormStatus()
  return <div className="flex flex-wrap gap-2">
    <Button name="mode" value="selection" disabled={pending || overQuota}>{pending ? (english ? 'Saving…' : 'Enregistrement…') : (english ? 'Save selection' : 'Enregistrer la sélection')}</Button>
    {overQuota && <Button name="mode" value="priorities" variant="outline" disabled={pending || !sameSelection}>{english ? 'Save priorities only' : 'Enregistrer uniquement les priorités'}</Button>}
  </div>
}

export function AccountSelectionEditor({ accounts, limit, version, workspaceId, canManage, locale }: { workspaceId: string; accounts: Account[]; limit: number | null; version: string; canManage: boolean; locale: 'fr' | 'en' }) {
  const english = locale === 'en'
  const initial = [...accounts].filter((account) => !account.isManager && account.managedSelected).sort((a, b) => a.managementPriority - b.managementPriority || a.googleCustomerId.localeCompare(b.googleCustomerId)).map((account) => account.id)
  const [selected, setSelected] = useState(initial)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const priorities = new Map(selected.map((id, index) => [id, index]))
  const draft = accounts.map((account) => ({ ...account, managedSelected: priorities.has(account.id), managementPriority: priorities.get(account.id) ?? account.managementPriority }))
  const preview = accountSelectionPreview(draft, limit)
  const activeIds = new Set(preview.includedAdvertisers.map((account) => account.id))
  const overQuota = limit !== null && selected.length > limit
  const sameSelection = selected.length === initial.length && initial.every((id) => priorities.has(id))
  const filtered = [...accounts].filter((account) => `${account.name} ${account.googleCustomerId} ${formatCustomerId(account.googleCustomerId)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const pages = Math.max(1, Math.ceil(filtered.length / 25))
  const visible = filtered.slice(page * 25, (page + 1) * 25)
  function move(id: string, direction: number) {
    setSelected((current) => {
      const next = [...current], index = next.indexOf(id), destination = index + direction
      if (index >= 0 && destination >= 0 && destination < next.length) [next[index], next[destination]] = [next[destination], next[index]]
      return next
    })
  }
  return <form action={updateManagedAccounts} className="space-y-6">
    <input type="hidden" name="workspaceId" value={workspaceId} />
    <input type="hidden" name="version" value={version} />
    <input type="hidden" name="clientIds" value={JSON.stringify(selected)} />
    <section className="rounded-2xl border bg-white p-5" aria-labelledby="managed-selection-title">
      <h2 id="managed-selection-title" className="font-semibold">{english ? 'Managed selection and priorities' : 'Sélection gérée et priorités'}</h2>
      <p className="mt-2 text-sm">{english ? `${preview.includedAdvertisers.length} accounts managed with this selection · ${selected.length} selected · quota ${limit ?? 'unlimited'}.` : `${preview.includedAdvertisers.length} comptes gérés avec cette sélection · ${selected.length} sélectionnés · quota ${limit ?? 'illimité'}.`}</p>
      <p className="mt-2 text-sm text-muted-foreground">{english ? 'Accounts are activated in this order, within the plan quota and Google access. A downgrade preserves your choices and history. New MCC accounts require selection. Managers do not consume quota.' : 'Les comptes sont activés dans cet ordre, selon le quota et l’accès Google. Une baisse de forfait conserve vos choix et l’historique. Les nouveaux comptes du MCC doivent être sélectionnés. Les comptes administrateurs ne consomment pas de quota.'}</p>
      {overQuota && <p role="status" className="mt-3 text-sm text-amber-800">{english ? 'Your retained selection exceeds the current quota. You can reorder it without removing choices, or reduce it before saving a new selection.' : 'Votre sélection conservée dépasse le quota actuel. Vous pouvez changer son ordre sans supprimer vos choix, ou la réduire avant d’enregistrer une nouvelle sélection.'}</p>}
      <ol className="my-4 divide-y">
        {selected.map((id, index) => { const account = byId.get(id)!; return <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <span className="min-w-0 break-words">{index + 1}. {account.name} <span className="text-muted-foreground">· {activeIds.has(id) ? (english ? 'Managed' : 'Géré') : !account.googleAccessible ? (english ? 'Google access unavailable' : 'Accès Google indisponible') : (english ? 'Outside quota' : 'Hors quota')}</span></span>
          {canManage && <span className="flex shrink-0 gap-1"><Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => move(id, -1)} aria-label={`${english ? 'Move up' : 'Monter'} ${account.name}`}>↑</Button><Button type="button" size="sm" variant="outline" disabled={index === selected.length - 1} onClick={() => move(id, 1)} aria-label={`${english ? 'Move down' : 'Descendre'} ${account.name}`}>↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelected((current) => current.filter((value) => value !== id))} aria-label={`${english ? 'Remove' : 'Retirer'} ${account.name}`}>{english ? 'Remove' : 'Retirer'}</Button></span>}
        </li> })}
      </ol>
      {canManage && <><div className="mb-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSelected(accounts.filter((account) => account.active && !account.isManager && account.googleAccessible).sort((a, b) => a.managementPriority - b.managementPriority).map((account) => account.id))}>{english ? 'Keep currently managed accounts' : 'Garder les comptes actuellement gérés'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>{english ? 'Clear selection' : 'Vider la sélection'}</Button></div>
        <p className="mb-3 text-sm" aria-live="polite">{english ? `On save: ${preview.deactivated.length} accounts paused, ${preview.activated.length} activated. History is retained; paused accounts stop collection and automation.` : `À l’enregistrement : ${preview.deactivated.length} comptes mis en pause, ${preview.activated.length} activés. L’historique est conservé ; les comptes en pause ne sont plus collectés ni automatisés.`}</p>
        <SaveButtons english={english} overQuota={overQuota} sameSelection={sameSelection} /></>}
    </section>
    <section className="rounded-2xl border bg-white p-5" aria-labelledby="account-inventory-title">
      <h2 id="account-inventory-title" className="font-semibold">{english ? 'MCC inventory' : 'Inventaire du MCC'} · {accounts.length}</h2>
      <label className="mt-4 block text-sm" htmlFor="account-inventory-search">{english ? 'Search by name or account ID' : 'Rechercher par nom ou identifiant'}</label>
      <Input id="account-inventory-search" value={search} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} onChange={(event) => { setSearch(event.target.value); setPage(0) }} className="mt-2 max-w-lg" />
      <ul className="my-4 divide-y">{visible.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0"><label className="flex items-start gap-3 text-sm font-medium">{canManage && !account.isManager && <input type="checkbox" className="mt-1 size-4" checked={priorities.has(account.id)} disabled={!priorities.has(account.id) && (!account.googleAccessible || (limit !== null && selected.length >= limit))} onChange={(event) => setSelected((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} />}<span className="break-words">{account.name}{account.isManager ? ' · MCC' : ''}</span></label><p className="mt-1 text-xs text-muted-foreground">{formatCustomerId(account.googleCustomerId)} · {account.currencyCode} · {account.timezone}</p><p className="mt-1 text-xs text-muted-foreground">{!account.googleAccessible ? (english ? 'Unavailable in the last verified inventory; history retained.' : 'Absent du dernier inventaire vérifié ; historique conservé.') : account.isManager ? (english ? 'Manager · no quota used' : 'Administrateur · hors quota') : account.active ? (english ? 'Currently managed' : 'Actuellement géré') : account.managedSelected ? (english ? 'Selected · paused by quota' : 'Sélectionné · en pause par quota') : (english ? 'Available · not selected' : 'Disponible · non sélectionné')}{account.inventoryObservedAt && ` · ${new Date(account.inventoryObservedAt).toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: account.timezone })}`}</p></div>
        {account.active && !account.isManager && <Button asChild size="sm" variant="outline"><Link href={`/dashboard?client=${account.id}`}>{english ? 'View dashboard' : 'Voir le tableau de bord'}</Link></Button>}
      </li>)}</ul>
      {filtered.length === 0 && <p className="py-4 text-sm text-muted-foreground">{english ? 'No matching accounts. Sync the connection to refresh the inventory.' : 'Aucun compte correspondant. Synchronisez la connexion pour actualiser l’inventaire.'}</p>}
      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={english ? 'Inventory pages' : 'Pages de l’inventaire'}><Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{english ? 'Previous' : 'Précédent'}</Button><span className="text-sm">{page + 1} / {pages} · {filtered.length} {english ? 'accounts' : 'comptes'}</span><Button type="button" variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>{english ? 'Next' : 'Suivant'}</Button></nav>
    </section>
  </form>
}
