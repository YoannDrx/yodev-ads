import { eq } from 'drizzle-orm'
import { auditEvents, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'

const configuredAuthOrganizationId = process.env.YODEV_INTERNAL_AUTH_ORGANIZATION_ID
if (!configuredAuthOrganizationId) throw new Error('YODEV_INTERNAL_AUTH_ORGANIZATION_ID is required')
const authOrganizationId: string = configuredAuthOrganizationId

async function main() {
  const workspace = await withSystemTransaction(async (transaction) => {
    const [updated] = await transaction
      .update(workspaces)
      .set({
        plan: 'internal',
        accessState: 'internal',
        trialStartedAt: null,
        trialEndsAt: null,
        graceEndsAt: null,
        requiredApprovals: 1,
        allowSelfApproval: true,
        mutationsEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.authOrganizationId, authOrganizationId))
      .returning({ id: workspaces.id })
    if (!updated) throw new Error('No workspace matches YODEV_INTERNAL_AUTH_ORGANIZATION_ID')
    await transaction.insert(auditEvents).values({
      workspaceId: updated.id,
      actorUserId: 'system:provisioning',
      action: 'workspace.internal_plan_provisioned',
      entityType: 'workspace',
      entityId: updated.id,
      metadata: { source: 'scripts/provision-internal-workspace.ts' },
    })
    return updated
  })

  console.log(JSON.stringify({ ok: true, workspaceId: workspace.id }))
}

void main()
