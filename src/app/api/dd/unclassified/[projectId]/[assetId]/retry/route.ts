export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import { getAsset } from '@/lib/dd-ingest/unclassified'
import { retryAssetOcr } from '@/lib/dd-ingest/ocr-queue'

/**
 * POST /api/dd/unclassified/[projectId]/[assetId]/retry
 * 重试 OCR
 */
export async function POST(
  _request: Request,
  { params }: { params: { projectId: string; assetId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'edit')
  if (!access.ok) return access.response

  try {
    const asset = await getAsset(params.projectId, params.assetId)
    if (!asset) return NextResponse.json({ error: '资料不存在' }, { status: 404 })
    if (asset.ocrStatus === 'PROCESSING') {
      return NextResponse.json({ error: 'OCR 正在处理中，请稍候' }, { status: 400 })
    }

    await retryAssetOcr(params.assetId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[dd-ingest] 重试 OCR 失败:', error)
    return NextResponse.json({ error: '重试 OCR 失败' }, { status: 500 })
  }
}
