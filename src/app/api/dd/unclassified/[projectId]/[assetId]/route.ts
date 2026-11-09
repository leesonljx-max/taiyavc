export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import {
  applyAssetToModule,
  deleteAsset,
  getAsset,
  toAssetView,
} from '@/lib/dd-ingest/unclassified'

/**
 * PATCH /api/dd/unclassified/[projectId]/[assetId]
 * 确认/修改归类；moduleKey=null 表示取消归类
 */
export async function PATCH(
  request: Request,
  { params }: { params: { projectId: string; assetId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'edit')
  if (!access.ok) return access.response

  try {
    const asset = await getAsset(params.projectId, params.assetId)
    if (!asset) return NextResponse.json({ error: '资料不存在' }, { status: 404 })

    const body = await request.json().catch(() => ({})) as { moduleKey?: unknown }
    const moduleKey = body.moduleKey === null || body.moduleKey === undefined || body.moduleKey === ''
      ? null
      : String(body.moduleKey)

    await applyAssetToModule(params.projectId, params.assetId, moduleKey)
    const updated = await getAsset(params.projectId, params.assetId)
    return NextResponse.json({ asset: updated ? toAssetView(updated) : null })
  } catch (error) {
    console.error('[dd-ingest] 归类失败:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '归类失败' },
      { status: 400 }
    )
  }
}

/**
 * DELETE /api/dd/unclassified/[projectId]/[assetId]
 * 删除资料并移除模块引用
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { projectId: string; assetId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'edit')
  if (!access.ok) return access.response

  try {
    await deleteAsset(params.projectId, params.assetId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[dd-ingest] 删除非分类资料失败:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '删除失败' },
      { status: 400 }
    )
  }
}
