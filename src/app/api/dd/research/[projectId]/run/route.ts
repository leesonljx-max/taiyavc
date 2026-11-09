export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import { createResearchRun } from '@/lib/dd-research/orchestrator'
import { enqueueResearch } from '@/lib/dd-research/queue'
import { DD_MODULE_KEYS } from '@/lib/dd-research/constants'

/**
 * POST /api/dd/research/[projectId]/run
 * 手动触发九大模块全网研究（24h 幂等，force 可重跑）
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'edit')
  if (!access.ok) return access.response

  try {
    let body: { modules?: unknown; force?: unknown } = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const modules = Array.isArray(body.modules)
      ? body.modules.map(String).filter(k => (DD_MODULE_KEYS as readonly string[]).includes(k))
      : undefined

    const result = await createResearchRun(params.projectId, {
      modules,
      force: Boolean(body.force),
      userId: access.userId,
    })
    enqueueResearch(result.runId)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[dd-research] 创建研究任务失败:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建研究任务失败' },
      { status: 500 }
    )
  }
}
