import assert from 'node:assert/strict'
import { Client } from 'pg'
import { eq } from 'drizzle-orm'
import { approvalRequests, dailyAccountMetrics, mutationExecutions, shareLinks, googleAdsConnections, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { getWorkspaceAccountSelection, reconcileManagedAccountSelection, saveManagedAccountSelection } from '../src/lib/account-selection'
import { getPublicShare } from '../src/lib/public-share-repository'
import { hashToken } from '../src/lib/tokens'
import { markGoogleMutationSubmitted } from '../src/lib/google-approval-management'
import { getWorkspaceClient, getWorkspaceConnection, googleConnectionVersion, saveWorkspaceGoogleConnection } from '../src/lib/data'
import { googleInventoryConnectionIdentity, persistTenantGoogleAccountInventory, type ManagedGoogleCustomer } from '../src/lib/google-account-sync'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '74000000-0000-4000-8000-000000000001'
const foreignId = '74000000-0000-4000-8000-000000000002'
const owner = 'account-selection-fixture'
globalThis.fetch = async () => { throw new Error('Provider calls are forbidden in this fixture') }
const inventory: ManagedGoogleCustomer[] = Array.from({ length: 57 }, (_, index) => ({ customerId: String(7400000000 + index), name: `Account ${index}`, currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: index < 2 }))
async function main() {
  const identity = new Client({ connectionString: url.href })
  await identity.connect()
  try {
    await identity.query('delete from auth_organizations where id=$1', [owner])
    await identity.query('delete from auth_users where id=$1', [owner])
    await identity.query("insert into auth_users(id,name,email,email_verified) values($1::text,$1::text,'account-selection@example.test',true)", [owner])
    await identity.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [owner])
    await identity.query("insert into auth_members(id,organization_id,user_id,role) values($1,$1,$1,'owner')", [owner])
    for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
    await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId, foreignId].map((id) => ({ id, authOrganizationId: id === workspaceId ? owner : null, ownerUserId: owner, name: 'Selection fixture', slug: `selection-${id}`, plan: 'agency', accessState: 'active' }))))
    const [connection] = await withSystemTransaction((db) => db.insert(googleAdsConnections).values({ workspaceId, managerCustomerId: inventory[0].customerId, encryptedRefreshToken: 'fixture-only', connectedBy: owner }).returning())
    let clock = Date.now() - 60_000
    const base = { workspaceId, actorUserId: owner, connectionId: connection.id, connectionIdentity: googleInventoryConnectionIdentity(connection), action: 'google_ads.accounts_synced' as const, recordActivation: false }
    const sync = (customers = inventory) => persistTenantGoogleAccountInventory({ ...base, managedCustomers: customers, observedAt: new Date(clock += 100) })
    await sync()
    let stored = await getWorkspaceAccountSelection(workspaceId)
    assert.equal(stored.accounts.length, 57)
    assert.equal(stored.accounts.filter((account) => account.active).length, 2, 'Nested managers are free; discovery does not select advertisers')
    const allIds = stored.accounts.filter((account) => !account.isManager).sort((a, b) => b.googleCustomerId.localeCompare(a.googleCustomerId)).map((account) => account.id)
    const selectedIds = allIds.slice(0, 50)
    await assert.rejects(saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: allIds, version: stored.version }), /limit/)
    await saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: selectedIds, version: stored.version })
    await withSystemTransaction((db) => db.insert(dailyAccountMetrics).values({ workspaceId, clientId: selectedIds[0], metricDate: '2026-08-01', currencyCode: 'EUR', costMicros: '123456' }))
    await sync([...inventory, { ...inventory[2], customerId: '7499999999', name: 'New advertiser' }])
    stored = await getWorkspaceAccountSelection(workspaceId)
    assert.equal(stored.accounts.find((account) => account.googleCustomerId === '7499999999')?.managedSelected, false)
    assert.equal(stored.accounts.filter((account) => account.active && !account.isManager).length, 50)
    const priorities = stored.accounts.filter((account) => account.managedSelected).sort((a, b) => a.managementPriority - b.managementPriority).map((account) => account.id)
    assert.deepEqual(priorities, selectedIds, 'MCC sync preserves the exact user priority')
    async function plan(plan: string, limit: number) {
      return withSystemTransaction(async (db) => {
        await db.update(workspaces).set({ plan }).where(eq(workspaces.id, workspaceId))
        return reconcileManagedAccountSelection(db, workspaceId, limit)
      })
    }
    for (const [name, limit] of [['studio', 15], ['solo', 3], ['agency', 50]] as const) {
      const result = await plan(name, limit)
      assert.deepEqual(result.includedAdvertisers.map((account) => account.id), selectedIds.slice(0, limit))
      assert.equal((await getWorkspaceAccountSelection(workspaceId)).accounts.filter((account) => account.managedSelected).length, 50)
    }
    await plan('solo', 3)
    stored = await getWorkspaceAccountSelection(workspaceId)
    await assert.rejects(saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: selectedIds, version: stored.version }), /limit/)
    const reordered = [selectedIds[49], ...selectedIds.slice(0, 49)]
    const ordered = await saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: reordered, version: stored.version, priorityOnly: true })
    assert.deepEqual(ordered.includedAdvertisers.map((account) => account.id), reordered.slice(0, 3))
    assert.equal(await getWorkspaceClient(workspaceId, selectedIds[4]), undefined, 'Explicit inactive ID never falls back to another client')
    assert.equal(await getWorkspaceClient(workspaceId, foreignId), undefined, 'Foreign ID never falls back')
    assert.equal(await getWorkspaceClient(workspaceId, stored.accounts.find((account) => account.isManager)!.id), undefined, 'Manager is not an advertiser cockpit')
    assert.equal(await getWorkspaceClient(workspaceId, 'invalid'), undefined, 'Malformed client never reaches the UUID query')
    stored = await getWorkspaceAccountSelection(workspaceId)
    const concurrent = await Promise.allSettled([selectedIds.slice(0, 3), selectedIds.slice(3, 6)].map((clientIds) => saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds, version: stored.version })))
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(concurrent.filter((result) => result.status === 'rejected' && /changed/.test(String(result.reason))).length, 1)
    stored = await getWorkspaceAccountSelection(workspaceId)
    await assert.rejects(saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: [foreignId], version: stored.version }), /Invalid/)
    await assert.rejects(saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: [stored.accounts.find((account) => account.isManager)!.id], version: stored.version }), /Invalid/)
    const oldObservedAt = new Date(clock - 1)
    await sync([])
    assert.equal((await getWorkspaceAccountSelection(workspaceId)).accounts.filter((account) => account.active).length, 0)
    assert.equal((await persistTenantGoogleAccountInventory({ ...base, managedCustomers: inventory, observedAt: oldObservedAt })).skipped, true)
    assert.equal((await getWorkspaceAccountSelection(workspaceId)).accounts.filter((account) => account.active).length, 0)
    await sync()
    assert.equal((await getWorkspaceAccountSelection(workspaceId)).accounts.filter((account) => account.active && !account.isManager).length, 3)
    const beforeBilling = await getWorkspaceAccountSelection(workspaceId)
    let acquired!: () => void, release!: () => void
    const ready = new Promise<void>((resolve) => { acquired = resolve }), continueBilling = new Promise<void>((resolve) => { release = resolve })
    const billing = withSystemTransaction(async (db) => {
      await db.update(workspaces).set({ plan: 'studio' }).where(eq(workspaces.id, workspaceId))
      acquired()
      await continueBilling
      await reconcileManagedAccountSelection(db, workspaceId, 15)
    })
    await ready
    const saving = saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: selectedIds.slice(0, 3), version: beforeBilling.version })
    release()
    await billing
    await assert.rejects(saving, /changed/)
    const activeClient = (await getWorkspaceAccountSelection(workspaceId)).accounts.find((account) => account.active && !account.isManager)!
    const inactiveClient = (await getWorkspaceAccountSelection(workspaceId)).accounts.find((account) => !account.active && !account.isManager)!
    async function executionFor(clientId: string, kind: string) {
      return withSystemTransaction(async (db) => {
        const [approval] = await db.insert(approvalRequests).values({ workspaceId, clientId, requestedBy: owner, kind, title: 'Admission fixture', payload: {}, status: 'executing', expiresAt: new Date(Date.now() + 60_000) }).returning()
        const [execution] = await db.insert(mutationExecutions).values({ workspaceId, approvalId: approval.id, attempt: 1, state: 'claimed' }).returning()
        return execution
      })
    }
    const token = 'local-selection-report-token'
    const [share] = await withSystemTransaction((db) => db.insert(shareLinks).values({ workspaceId, clientId: inactiveClient.id, createdBy: owner, label: 'Selection report fixture', tokenHash: hashToken(token), tokenPrefix: 'fixture' }).returning())
    assert.equal(await getPublicShare(token), undefined, 'A live public report cannot collect an inactive account')
    await withSystemTransaction((db) => db.update(shareLinks).set({ clientId: activeClient.id }).where(eq(shareLinks.id, share.id)))
    assert.equal((await getPublicShare(token))?.client.id, activeClient.id)
    await withSystemTransaction((db) => db.update(googleAdsConnections).set({ status: 'revoked' }).where(eq(googleAdsConnections.id, connection.id)))
    assert.equal((await getPublicShare(token))?.client.id, activeClient.id, 'A stored report context does not require provider credentials')
    await withSystemTransaction((db) => db.update(googleAdsConnections).set({ status: 'active' }).where(eq(googleAdsConnections.id, connection.id)))
    const pausedExecution = await executionFor(inactiveClient.id, 'campaign_status')
    await assert.rejects(markGoogleMutationSubmitted({ workspaceId, actorUserId: owner, executionId: pausedExecution.id, validationRequestId: 'fixture-validation' }), /plus disponible/)
    assert.equal((await withSystemTransaction((db) => db.query.mutationExecutions.findFirst({ where: eq(mutationExecutions.id, pausedExecution.id) })))?.state, 'claimed')
    const advancedExecution = await executionFor(activeClient.id, 'keyword_status')
    await plan('solo', 3)
    await assert.rejects(markGoogleMutationSubmitted({ workspaceId, actorUserId: owner, executionId: advancedExecution.id, validationRequestId: 'fixture-validation' }))
    const basicExecution = await executionFor(activeClient.id, 'campaign_status')
    await markGoogleMutationSubmitted({ workspaceId, actorUserId: owner, executionId: basicExecution.id, validationRequestId: 'fixture-validation' })
    assert.equal((await withSystemTransaction((db) => db.query.mutationExecutions.findFirst({ where: eq(mutationExecutions.id, basicExecution.id) })))?.state, 'submitted')
    // Only the admission marker was tested; no Google mutation is dispatched.
    await saveWorkspaceGoogleConnection({ workspaceId, userId: owner, managerCustomerId: connection.managerCustomerId, googleEmail: null, encryptedRefreshToken: 'new-fixture-credential', scopes: [], expectedConnectionVersion: googleConnectionVersion(await getWorkspaceConnection(workspaceId)), authorizationExpiresAt: new Date(Date.now() + 60_000) })
    assert.equal((await getWorkspaceAccountSelection(workspaceId)).accounts.filter((account) => account.active).length, 0)
    await assert.rejects(sync(), /connection changed/)
    const history = await withSystemTransaction((db) => db.query.dailyAccountMetrics.findMany({ where: eq(dailyAccountMetrics.workspaceId, workspaceId) }))
    assert.equal(history.length, 1)
    assert.equal(history[0].costMicros, '123456')
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'grace' }).where(eq(workspaces.id, workspaceId)))
    stored = await getWorkspaceAccountSelection(workspaceId)
    await assert.rejects(saveManagedAccountSelection({ workspaceId, actorUserId: owner, clientIds: [], version: stored.version }))
    console.log(JSON.stringify({ ok: true, verified: ['explicit_selection_after_mcc_discovery', 'nested_managers_free', 'quota_3_15_50', 'new_account_unselected', 'sync_preserves_priority', 'downgrade_preserves_preferences', 'upgrade_restores_selection', 'priority_only_above_quota', 'concurrent_selection_conflict', 'foreign_and_manager_rejected', 'inactive_explicit_client_never_falls_back', 'empty_inventory_blocks_older_read', 'access_restoration', 'billing_row_serialization', 'new_credentials_require_inventory', 'history_preserved', 'grace_read_without_selection_write', 'final_mutation_admission_checks_active_account_and_current_plan', 'stored_report_requires_active_account_without_provider_credentials'], providerCalls: 0 }))
  } finally {
    for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
    await identity.query('delete from auth_organizations where id=$1', [owner])
    await identity.query('delete from auth_users where id=$1', [owner]); await identity.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
