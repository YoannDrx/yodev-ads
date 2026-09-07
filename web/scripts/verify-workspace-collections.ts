import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { workspaces, clients, monitoringAgents, workspaceTasks, supportTickets, approvalRequests, alertIncidents } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { listApiAlerts, listApiApprovals, listApiReports } from '../src/lib/api-v1-repository'
import { listAuditPage, listAlertPage, listTaskPage, listApprovalPage, listSupportPage, listDiscussionPage, type DiscussionKind } from '../src/lib/workspace-collections'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '78000000-0000-4000-8000-000000000001', foreignId = '78000000-0000-4000-8000-000000000002'
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
async function main() {
  for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
  try {
    await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId, foreignId].map((id) => ({ id, ownerUserId: 'collection-fixture', name: 'Collection fixture', slug: `collection-${id}`, accessState: 'internal', plan: 'internal' }))))
    const [client] = await withSystemTransaction((db) => db.insert(clients).values({ workspaceId, googleCustomerId: '7800000000', name: 'Collection client' }).returning())
    const [agent] = await withSystemTransaction((db) => db.insert(monitoringAgents).values({ workspaceId, createdBy: 'fixture', name: 'Collection monitor', kind: 'budget_guard', description: 'Fixture', threshold: '1' }).returning())
    await withSystemTransaction(async (db) => {
      await db.execute(sql`insert into audit_events(workspace_id,actor_user_id,action,entity_type,created_at) select ${workspaceId},'fixture','collection.event','fixture',now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,521) n`)
      await db.execute(sql`insert into workspace_tasks(workspace_id,created_by,title,description,created_at) select ${workspaceId},'fixture','Task '||n,'Fixture',now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,521) n`)
      await db.execute(sql`insert into support_tickets(workspace_id,requested_by,subject,category,created_at) select ${workspaceId},'fixture','Ticket '||n,'technical',now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,521) n`)
      await db.execute(sql`insert into approval_requests(workspace_id,client_id,requested_by,kind,title,payload,expires_at,created_at) select ${workspaceId},${client.id},'fixture','campaign_status','Approval '||n,'{}',now()+interval '1 day',now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,521) n`)
      await db.execute(sql`insert into alert_incidents(workspace_id,client_id,agent_id,fingerprint,title,description,created_at) select ${workspaceId},${client.id},${agent.id},'collection-'||n,'Alert '||n,'Fixture',now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,521) n`)
    })
    const runs = [
      ['audit', (workspace: string, cursor?: string) => listAuditPage(workspace, { cursor })],
      ['alerts', (workspace: string, cursor?: string) => listAlertPage(workspace, { cursor })],
      ['tasks', (workspace: string, cursor?: string) => listTaskPage(workspace, { cursor })],
      ['approvals', (workspace: string, cursor?: string) => listApprovalPage(workspace, { cursor })],
      ['support', (workspace: string, cursor?: string) => listSupportPage(workspace, undefined, { cursor })],
    ] as const
    for (const [kind, list] of runs) {
      let cursor: string | undefined, count = 0
      const seen = new Set<string>()
      do {
        const page = await list(workspaceId, cursor)
        assert(!page.invalidCursor, `${kind}: invalid cursor in traversal`)
        assert.equal(page.total, 521)
        for (const item of page.items) {
          const id = 'incident' in item ? item.incident.id : 'task' in item ? item.task.id : 'request' in item ? item.request.id : 'ticket' in item ? item.ticket.id : item.id
          assert(!seen.has(id), `${kind}: duplicate record`); seen.add(id)
        }
        count += page.items.length
        if (!cursor && page.nextCursor) {
          assert((await list(foreignId, page.nextCursor)).invalidCursor, `${kind}: foreign cursor accepted`)
          assert((await list(workspaceId, page.nextCursor.slice(0, -5) + 'xxxxx')).invalidCursor, `${kind}: forged cursor accepted`)
          if (kind === 'audit') await withSystemTransaction((db) => db.execute(sql`insert into audit_events(workspace_id,actor_user_id,action,entity_type) values(${workspaceId},'fixture','after.snapshot','fixture')`))
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      assert.equal(count, 521, `${kind}: missing records at microsecond boundaries`)
    }
    await withSystemTransaction((db) => db.execute(sql`insert into share_links(workspace_id,client_id,created_by,label,token_hash,token_prefix,created_at) select ${workspaceId},${client.id},'fixture','Report '||n,md5(${workspaceId}||':'||n),'fixture',now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,521) n`))
    for (const [kind, list] of [['alerts', listApiAlerts], ['approvals', listApiApprovals], ['reports', listApiReports]] as const) {
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const page = await list({ workspaceId, actorId: 'api-key:fixture', cursor, limit: 37 })
        assert(page.data.length <= 37)
        for (const row of page.data) {
          const id = 'alert' in row ? row.alert.id : 'approval' in row ? row.approval.id : row.report.id
          assert(!('cursorAt' in row)); assert(!seen.has(id), `${kind} API duplicate`); seen.add(id)
        }
        if (!cursor && page.nextCursor) {
          for (const change of [{ workspaceId: foreignId }, { actorId: 'api-key:foreign' }, { cursor: 'forged' }]) {
            await assert.rejects(list({ workspaceId, actorId: 'api-key:fixture', cursor: page.nextCursor, limit: 37, ...change }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_CURSOR')
          }
          if (kind === 'alerts') {
            await assert.rejects(listApiAlerts({ workspaceId, actorId: 'api-key:fixture', cursor: page.nextCursor, limit: 37, status: 'resolved' }))
            // DetectedAt changes during monitoring; creation ordering must remain stable.
            await withSystemTransaction((db) => db.update(alertIncidents).set({ detectedAt: new Date() }).where(eq(alertIncidents.workspaceId, workspaceId)))
          }
          if (kind === 'reports') await withSystemTransaction((db) => db.execute(sql`insert into share_links(workspace_id,client_id,created_by,label,token_hash,token_prefix) values(${workspaceId},${client.id},'fixture','After snapshot',md5(${workspaceId}||':after'),'fixture')`))
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      assert.equal(seen.size, 521, `${kind} API missing records at microsecond boundaries`)
    }
    const firstTasks = await listTaskPage(workspaceId)
    assert((await listTaskPage(workspaceId, { cursor: firstTasks.nextCursor!, q: 'Task 1' })).invalidCursor)
    assert((await listSupportPage(workspaceId, 'other-reader', (await listSupportPage(workspaceId, undefined)).nextCursor ? { cursor: (await listSupportPage(workspaceId, undefined)).nextCursor! } : {})).invalidCursor)
    await withSystemTransaction((db) => db.insert(workspaceTasks).values({ workspaceId, createdBy: 'fixture', title: 'literal %_ needle', description: 'Fixture' }))
    assert.equal((await listTaskPage(workspaceId, { q: '%_' })).total, 1, 'Search treats wildcard characters literally')
    assert.equal((await listTaskPage(workspaceId, { status: 'done' })).total, 0)
    const [task] = await withSystemTransaction((db) => db.select().from(workspaceTasks).where(eq(workspaceTasks.workspaceId, workspaceId)).limit(1))
    const [ticket] = await withSystemTransaction((db) => db.select().from(supportTickets).where(eq(supportTickets.workspaceId, workspaceId)).limit(1))
    const [approval] = await withSystemTransaction((db) => db.select().from(approvalRequests).where(eq(approvalRequests.workspaceId, workspaceId)).limit(1))
    const [alert] = await withSystemTransaction((db) => db.select().from(alertIncidents).where(eq(alertIncidents.workspaceId, workspaceId)).limit(1))
    await withSystemTransaction(async (db) => {
      await db.execute(sql`insert into task_comments(workspace_id,task_id,author_user_id,body,created_at) select ${workspaceId},${task.id},'fixture','MESSAGE_'||n,now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,701) n`)
      await db.execute(sql`insert into support_messages(workspace_id,ticket_id,author_user_id,author_kind,body,created_at) select ${workspaceId},${ticket.id},'fixture','customer','MESSAGE_'||n,now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,701) n`)
      await db.execute(sql`insert into support_messages(workspace_id,ticket_id,author_user_id,author_kind,body,internal) values(${workspaceId},${ticket.id},'fixture','support','PRIVATE_INTERNAL_NOTE',true)`)
      await db.execute(sql`insert into approval_comments(workspace_id,approval_id,author_user_id,body,created_at) select ${workspaceId},${approval.id},'fixture','MESSAGE_'||n,now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,701) n`)
      await db.execute(sql`insert into alert_comments(workspace_id,incident_id,author_user_id,body,created_at) select ${workspaceId},${alert.id},'fixture','MESSAGE_'||n,now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,701) n`)
    })
    for (const [kind, id] of [['tasks', task.id], ['support', ticket.id], ['approvals', approval.id], ['alerts', alert.id]] as [DiscussionKind, string][]) {
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const page = await listDiscussionPage(workspaceId, kind, id, undefined, { cursor })
        assert(page); assert.equal(page.total, 701)
        for (const item of page.items) { assert(!seen.has(item.id)); assert(!item.body.includes('PRIVATE')); seen.add(item.id) }
        if (!cursor && page.nextCursor) {
          assert.equal(await listDiscussionPage(foreignId, kind, id, undefined, { cursor: page.nextCursor }), null)
          assert.equal(await listDiscussionPage(workspaceId, kind, randomUUID()), null)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      assert.equal(seen.size, 701)
      assert.equal((await listDiscussionPage(workspaceId, kind, id, undefined, { q: 'MESSAGE_701' }))?.items.length, 1)
    }
    assert.equal(await listDiscussionPage(workspaceId, 'support', ticket.id, 'other-reader'), null)
    const taskPreview = (await listTaskPage(workspaceId, { id: task.id })).items.find((item) => item.task.id === task.id)!
    assert(taskPreview.hasMoreComments); assert.equal(taskPreview.comments.length, 5)
    assert(taskPreview.comments.some((comment) => Number(comment.body.split('_')[1]) >= 699), 'Latest messages must be in the preview')
    const supportPreview = (await listSupportPage(workspaceId, undefined, { id: ticket.id })).items.find((item) => item.ticket.id === ticket.id)!
    assert(supportPreview.hasMoreComments); assert.equal(supportPreview.messages.length, 5)
    assert(supportPreview.messages.every((comment) => !comment.body.includes('PRIVATE')))
    console.log(JSON.stringify({ ok: true, collections: 5, apiCollections: 3, recordsPerCollection: 521, discussions: 4, messagesPerDiscussion: 701, verified: ['microsecond_and_uuid_ordering', 'concurrent_insert_excluded_from_existing_page_walk', 'tenant_filter_and_reader_bound_cursor', 'forged_cursor_denied', 'literal_search', 'latest_five_previews', 'complete_discussion_history', 'internal_support_messages_hidden'], providerCalls: 0 }))
  } finally { for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id))) }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
