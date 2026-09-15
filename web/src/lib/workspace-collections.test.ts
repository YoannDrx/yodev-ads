import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ databases: [] as unknown[], contexts: [] as unknown[] }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (context: unknown, action: (db: unknown) => Promise<unknown>) => { mocks.contexts.push(context); return action(mocks.databases.shift()) } }))
import { listAuditPage, listAlertPage, listTaskPage, listSupportPage, listApprovalPage, listDiscussionPage } from './workspace-collections'
const workspaceId = '78000000-0000-4000-8000-000000000001', parentId = '78000000-0000-4000-8000-000000000002', at = '2026-09-06T12:00:00.123456Z'
const timestamp = { rows: [{ at: '2026-09-07T12:00:00.123456Z' }] }
const comment = { id: 'comment-1', body: 'Latest', authorUserId: 'member', createdAt: new Date(at), at, mentions: [], authorKind: 'customer' }
function db(...statementResults: unknown[]) { const value = databaseDouble({ statementResults }); mocks.databases.push(value.db); return value }
beforeEach(() => { mocks.databases.length = 0; mocks.contexts.length = 0; vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64url')); vi.stubEnv('APP_ENCRYPTION_KEYS', ''); vi.stubEnv('APP_ENCRYPTION_CURRENT_KID', '') })
afterEach(() => vi.unstubAllEnvs())
describe('workspace collection orchestration', () => {
  it('returns exact audit timestamps and a next-page cursor without exposing the extra row', async () => {
    db(timestamp, [{ total: 200 }], Array.from({ length: 26 }, () => ({ event: { id: parentId, action: 'event' }, at })))
    const page = await listAuditPage(workspaceId, { q: 'event', id: parentId })
    expect(page.items).toHaveLength(25); expect(page.total).toBe(200); expect(page.nextCursor).toBeTruthy()
    expect(page.items[0]).toMatchObject({ at, action: 'event' })
    expect(mocks.contexts).toEqual([{ workspaceId, userId: 'system:collection-read' }])
  })
  it('returns whole-filter alert totals independently of the displayed page', async () => {
    db(timestamp, [{ total: 521, open: 400, critical: 350, resolved: 121 }], [{ incident: { id: parentId }, client: {}, agent: {}, at }])
    const page = await listAlertPage(workspaceId, { status: 'open', severity: 'critical', assignee: 'member', client: parentId, q: 'needle' })
    expect(page.items).toHaveLength(1); expect(page.summary.critical).toBe(350); expect(page.total).toBe(521)
  })
  it.each(['open', 'done', 'invalid'])('returns bounded per-task previews with status %s', async (status) => {
    db(timestamp, [{ total: 1, open: 1, overdue: 1, dueSoon: 0 }], [{ task: { id: parentId }, client: null, at }], [], Array.from({ length: 6 }, (_, index) => ({ parentId, comment: { ...comment, id: String(index) } })))
    const page = await listTaskPage(workspaceId, { status, client: parentId, assignee: 'member', q: 'needle' })
    expect(page.items[0].hasMoreComments).toBe(true)
    expect(page.items[0].comments.map((item) => item.id)).toEqual(['4', '3', '2', '1', '0'])
    expect(page.summary.overdue).toBe(1)
  })
  it('reads support message previews for the selected tickets', async () => {
    db(timestamp, [{ total: 1, open: 1 }], [{ ticket: { id: parentId }, at }], [], [{ parentId, comment }])
    const page = await listSupportPage(workspaceId, 'reader', { status: 'awaiting_support', q: 'needle' })
    expect(page.items[0].messages).toEqual([comment]); expect(page.open).toBe(1)
  })
  it('selects the latest approval feedback and observation only for the visible requests', async () => {
    const observation = { approvalId: parentId, status: 'pending', baselineMetrics: {}, observedMetrics: null, outcome: null }
    db(timestamp, [{ total: 1 }], [{ request: { id: parentId }, client: {}, at }], [], [{ parentId, comment }], [{ approvalId: parentId, decision: 'approved' }], [observation])
    const page = await listApprovalPage(workspaceId, { status: 'pending', client: parentId, q: 'needle' })
    expect(page.items[0].clientFeedback?.decision).toBe('approved'); expect(page.items[0].observation).toEqual(observation)
  })
  it('handles approval rows without feedback, comments or observations', async () => {
    db(timestamp, [{ total: 1 }], [{ request: { id: parentId }, client: {}, at }], [], [{ parentId, comment: null }], [], [])
    const page = await listApprovalPage(workspaceId)
    expect(page.items[0]).toMatchObject({ comments: [], hasMoreComments: false, clientFeedback: undefined, observation: undefined })
  })
  it.each([listAuditPage, listAlertPage, listTaskPage, listApprovalPage, (id: string, query = {}) => listSupportPage(id, undefined, query)])('rejects invalid cursors before collection queries', async (list) => {
    db()
    expect(await list(workspaceId, { cursor: 'forged' })).toMatchObject({ invalidCursor: true, items: [], total: 0 })
  })
  it.each([listAuditPage, listAlertPage, listTaskPage, listApprovalPage, (id: string) => listSupportPage(id, undefined)])('handles an empty collection', async (list) => {
    db(timestamp, [{ total: 0, open: 0 }], [], [])
    expect(await list(workspaceId)).toMatchObject({ items: [], total: 0, nextCursor: null })
  })
  it.each(['tasks', 'approvals', 'support', 'alerts'] as const)('loads a bounded searchable %s discussion', async (kind) => {
    db([{ id: parentId, title: 'Discussion' }], timestamp, [{ total: 1 }], [comment])
    const page = await listDiscussionPage(workspaceId, kind, parentId, 'reader', { q: 'Latest' })
    expect(page?.items).toEqual([comment]); expect(page?.record.title).toBe('Discussion')
  })
  it('does not enumerate an invalid, foreign or restricted parent', async () => {
    expect(await listDiscussionPage(workspaceId, 'tasks', 'invalid')).toBeNull()
    expect(mocks.contexts).toHaveLength(0)
    db([]); expect(await listDiscussionPage(workspaceId, 'support', parentId, 'restricted-reader')).toBeNull()
  })
  it('retains the authorized parent title when its pagination cursor expires', async () => {
    db([{ id: parentId, title: 'Discussion' }])
    expect(await listDiscussionPage(workspaceId, 'tasks', parentId, undefined, { cursor: 'expired' })).toMatchObject({ record: { title: 'Discussion' }, invalidCursor: true, items: [] })
  })
})
