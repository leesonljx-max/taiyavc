export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'

/**
 * GET /api/dd/research/[projectId]
 * 最新一轮研究的模块、来源与事实明细
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
        modules: true,
        sources: {
          select: {
            id: true,
            moduleKey: true,
            url: true,
            title: true,
            domain: true,
            grade: true,
            sourceType: true,
            snippet: true,
            fetchedAt: true,
          },
          orderBy: { fetchedAt: 'asc' },
        },
        facts: {
          include: {
            source: { select: { url: true, title: true, grade: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!run) {
      return NextResponse.json({ run: null, modules: [], sources: [], facts: [] })
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
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        stats,
      },
      modules: run.modules,
      sources: run.sources,
      facts: run.facts,
    })
  } catch (error) {
    console.error('[dd-research] 查询研究明细失败:', error)
    return NextResponse.json({ error: '查询研究明细失败' }, { status: 500 })
  }
}
