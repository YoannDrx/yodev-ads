export type AccountSelection = {
  id: string
  googleCustomerId: string
  isManager: boolean
  googleAccessible: boolean
  managedSelected: boolean
  managementPriority: number
  active: boolean
}

/** Preferences survive a quota reduction; only the effective managed set changes. */
export function selectedAccountsWithinLimit<T extends AccountSelection>(accounts: T[], limit: number | null) {
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new Error('Invalid account quota')
  const ordered = [...accounts].sort((left, right) => left.managementPriority - right.managementPriority || left.googleCustomerId.localeCompare(right.googleCustomerId) || left.id.localeCompare(right.id))
  const managers = ordered.filter((account) => account.isManager && account.googleAccessible)
  const chosen = ordered.filter((account) => !account.isManager && account.googleAccessible && account.managedSelected)
  const includedAdvertisers = limit === null ? chosen : chosen.slice(0, limit)
  const excluded = limit === null ? [] : chosen.slice(limit)
  return { included: [...managers, ...includedAdvertisers], includedAdvertisers, excluded, limit }
}

export function accountSelectionPreview<T extends AccountSelection>(accounts: T[], limit: number | null) {
  const selection = selectedAccountsWithinLimit(accounts, limit)
  const effective = new Set(selection.included.map((account) => account.id))
  return { ...selection,
    deactivated: accounts.filter((account) => !account.isManager && account.active && !effective.has(account.id)),
    activated: accounts.filter((account) => !account.isManager && !account.active && effective.has(account.id)),
  }
}
