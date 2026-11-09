export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'

/**
 * GET /api/dd/research/[projectId]/status
 * 轮询最新研究任务进度
 */
export async function GET(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'view')
  if (!access.ok) return access.response

  try {
    const run = await prisma.dDResearchRun.findFirst({
      where: { projectId: params.projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        modules: {
          orderBy: { moduleKey: 'asc' },
        },
      },
    })

    if (!run) {
      return NextResponse.json({ run: null, modules: [] })
    }

    let stats: Record<string, unknown> | null = null
    if (run.statsJson) {
      try {
        stats = JSON.parse(run.statsJson) as Record<string, unknown>
      } catch {
        stats = null
      }
    }

    return NextResponse.json({
      run: {
        id: run.id,
        status: run.status,
        phase: run.phase,
        progress: run.progress,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
      },
      modules: run.modules,
      stats,
    })
  } catch (error) {
    console.error('[dd-research] 查询状态失败:', error)
    return NextResponse.json({ error: '查询研究状态失败' }, { status: 500 })
  }
}
