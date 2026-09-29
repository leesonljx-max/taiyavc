export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { runPostInvestAnalysis } from '@/lib/post-investment/analysis'
import { isValidPeriod } from '@/lib/post-investment/calc'

/**
 * POST /api/post-investment/[projectId]/analyze
 * 触发本期 AI 投后分析：指标提取 → 程序计算同比/环比 → AI 结构化分析（财务/异常/现金流/业务/风险）
 * body: { period: "2026Q1" }
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权分析该项目' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { period?: string }
    const period = String(body.period || '')
    if (!isValidPeriod(period)) {
      return NextResponse.json({ error: '无效的报告期（格式：2026Q1 / 2026H1 / 2026FY）' }, { status: 400 })
    }

    const result = await runPostInvestAnalysis(params.projectId, period)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true, metricCount: result.metricCount, analysis: result.analysis })
  } catch (error) {
    console.error('Post-investment analyze error:', error)
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `投后分析失败：${detail}` }, { status: 500 })
  }
}
