import { get } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { requireWorkspacePermission } from '@/lib/workspace'
import { getDownloadableWorkspaceExport } from '@/lib/data'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ exportId: string }> },
) {
  const { workspace, session } = await requireWorkspacePermission('workspace:export')
  const { exportId } = await params
  const artifact = await getDownloadableWorkspaceExport(workspace.id, session.userId, exportId)
  if (!artifact?.artifactKey) return NextResponse.json({ error: 'Export unavailable' }, { status: 404 })
  const blob = await get(artifact.artifactKey, { access: 'private', useCache: false })
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: 'Export unavailable' }, { status: 404 })
  return new Response(blob.stream, {
    headers: {
      'Content-Type': blob.blob.contentType || 'application/zip',
      'Content-Disposition': `attachment; filename="ads-by-yodev-export-${exportId}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': artifact.artifactHash ?? '',
    },
  })
}
