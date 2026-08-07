import { neonConfig, Pool } from '@neondatabase/serverless'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { workspaces } from '../src/db/schema'

type ClerkOrganizationMapping = {
  legacyOrganizationId: string
  newOrganizationId: string
}

function readMappings(): ClerkOrganizationMapping[] {
  const value = process.env.YODEV_ADS_CLERK_ORG_MAPPINGS
  if (!value) throw new Error('YODEV_ADS_CLERK_ORG_MAPPINGS is required')

  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('YODEV_ADS_CLERK_ORG_MAPPINGS must be a non-empty JSON array')
  }

  return parsed.map((mapping) => {
    if (
      typeof mapping !== 'object' ||
      mapping === null ||
      typeof (mapping as ClerkOrganizationMapping).legacyOrganizationId !== 'string' ||
      typeof (mapping as ClerkOrganizationMapping).newOrganizationId !== 'string'
    ) {
      throw new Error('Each Clerk mapping must contain legacyOrganizationId and newOrganizationId')
    }
    return mapping as ClerkOrganizationMapping
  })
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const newOwnerUserId = process.env.YODEV_ADS_CLERK_OWNER_USER_ID
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured')
  if (!newOwnerUserId) throw new Error('YODEV_ADS_CLERK_OWNER_USER_ID is required')

  const mappings = readMappings()
  const uniqueLegacyIds = new Set(mappings.map((mapping) => mapping.legacyOrganizationId))
  const uniqueNewIds = new Set(mappings.map((mapping) => mapping.newOrganizationId))
  if (uniqueLegacyIds.size !== mappings.length || uniqueNewIds.size !== mappings.length) {
    throw new Error('Clerk organization mappings must be one-to-one')
  }

  neonConfig.webSocketConstructor ??= WebSocket
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    const db = drizzle(pool)
    const updated = await db.transaction(async (tx) => {
      let count = 0
      for (const mapping of mappings) {
        const rows = await tx
          .update(workspaces)
          .set({
            clerkOrganizationId: mapping.newOrganizationId,
            ownerUserId: newOwnerUserId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workspaces.clerkOrganizationId, mapping.legacyOrganizationId),
              eq(workspaces.ownerUserId, 'user_3GeQHPC2lgeBgSG0Jgbl2hfJMtl'),
            ),
          )
          .returning({ id: workspaces.id })

        if (rows.length !== 1) {
          throw new Error(
            `Expected exactly one workspace for legacy organization ${mapping.legacyOrganizationId}; found ${rows.length}`,
          )
        }
        count += rows.length
      }
      return count
    })

    process.stdout.write(`Remapped ${updated} workspace identity record(s).\n`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  process.stderr.write(`Clerk identity remap failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
