export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { canWaive, requireProjectAccess } from '@/lib/dd-research/api-auth'
import { waiveGap } from '@/lib/dd-research/gap'

/**
 * POST /api/dd/gaps/[projectId]/[gapId]/waive
 * 合伙人/管理员豁免阻塞缺口，必须填写理由
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string; gapId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'view')
  if (!access.ok) return access.response
  if (!canWaive(access.role)) {
    return NextResponse.json({ error: '仅投资合伙人或管理员可豁免缺口' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({})) as { reason?: unknown }
    const reason = String(body.reason || '').trim()
    if (reason.length < 4) {
      return NextResponse.json({ error: '请填写不少于 4 个字的豁免理由' }, { status: 400 })
    }

    await waiveGap(params.projectId, params.gapId, access.userId, reason)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[dd-gap] 豁免失败:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '豁免失败' },
      { status: 400 }
    )
  }
}
