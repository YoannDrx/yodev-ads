import { and, eq, isNull, like } from 'drizzle-orm'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { getDb } from '../src/db'
import { apiKeys, shareLinks } from '../src/db/schema'
import { createApiToken, createShareToken, hashToken } from '../src/lib/tokens'

type RotatedCredential = {
  kind: 'api_key' | 'share_link'
  recordId: string
  workspaceId: string
  token: string
}

async function main() {
  const outputPath = process.env.YODEV_ADS_ROTATION_OUTPUT
  if (!outputPath || !isAbsolute(outputPath)) {
    throw new Error('YODEV_ADS_ROTATION_OUTPUT must be an absolute path outside application logs')
  }

  const db = getDb()
  const rotated = await db.transaction(async (tx) => {
    const credentials: RotatedCredential[] = []
    const legacyKeys = await tx
      .select()
      .from(apiKeys)
      .where(and(isNull(apiKeys.revokedAt), like(apiKeys.tokenPrefix, 'vgh_%')))

    for (const legacy of legacyKeys) {
      const token = createApiToken()
      await tx.update(apiKeys).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(apiKeys.id, legacy.id))
      const [replacement] = await tx
        .insert(apiKeys)
        .values({
          workspaceId: legacy.workspaceId,
          createdBy: legacy.createdBy,
          name: `${legacy.name} — Yodev`,
          tokenHash: hashToken(token),
          tokenPrefix: token.slice(0, 16),
        })
        .returning({ id: apiKeys.id })
      credentials.push({ kind: 'api_key', recordId: replacement.id, workspaceId: legacy.workspaceId, token })
    }

    const legacyShares = await tx.select().from(shareLinks).where(like(shareLinks.tokenPrefix, 'vgh_%'))
    for (const share of legacyShares) {
      const token = createShareToken()
      await tx
        .update(shareLinks)
        .set({ tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), updatedAt: new Date() })
        .where(eq(shareLinks.id, share.id))
      credentials.push({ kind: 'share_link', recordId: share.id, workspaceId: share.workspaceId, token })
    }
    return credentials
  })

  await writeFile(outputPath, `${JSON.stringify({ rotated }, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  process.stdout.write(`Rotated ${rotated.length} credential(s); one-time values were written to the protected output file.\n`)
}

main().catch((error) => {
  process.stderr.write(`Credential rotation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
