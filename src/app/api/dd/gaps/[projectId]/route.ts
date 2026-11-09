export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import { getGapOverview } from '@/lib/dd-research/gap'
import { DD_MODULE_NAME_LABELS } from '@/lib/dd-workbench/template'

/**
 * GET /api/dd/gaps/[projectId]
 * 缺口清单与汇总（BLOCKING 优先）
 */
export async function GET(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'view')
  if (!access.ok) return access.response

  try {
    const overview = await getGapOverview(params.projectId)
    return NextResponse.json({
      ...overview,
      gaps: overview.gaps.map(g => ({
        ...g,
        moduleName: DD_MODULE_NAME_LABELS[g.moduleKey] || g.moduleKey,
      })),
    })
  } catch (error) {
    console.error('[dd-gap] 查询缺口失败:', error)
    return NextResponse.json({ error: '查询缺口失败' }, { status: 500 })
  }
}
