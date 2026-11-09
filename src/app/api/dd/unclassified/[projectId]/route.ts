export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import {
  createAsset,
  listAssets,
  validateAsset,
} from '@/lib/dd-ingest/unclassified'
import { enqueueAssetOcr } from '@/lib/dd-ingest/ocr-queue'

/**
 * GET /api/dd/unclassified/[projectId]
 * 非分类资料列表
 */
export async function GET(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'view')
  if (!access.ok) return access.response

  try {
    const assets = await listAssets(params.projectId)
    return NextResponse.json({ assets })
  } catch (error) {
    console.error('[dd-ingest] 查询非分类资料失败:', error)
    return NextResponse.json({ error: '查询非分类资料失败' }, { status: 500 })
  }
}

/**
 * POST /api/dd/unclassified/[projectId]
 * 上传非分类资料：快速入库，扫描件后台 OCR
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'edit')
  if (!access.ok) return access.response

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '未找到上传文件' }, { status: 400 })

    const validation = validateAsset(file.name, file.size)
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await createAsset({
      projectId: params.projectId,
      userId: access.userId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      buffer,
    })

    if (result.needsOcr) {
      enqueueAssetOcr(result.asset.id)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[dd-ingest] 上传非分类资料失败:', error)
    return NextResponse.json({ error: '上传资料失败' }, { status: 500 })
  }
}
