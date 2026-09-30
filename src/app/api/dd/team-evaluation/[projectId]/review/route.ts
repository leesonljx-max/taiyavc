export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { runScoringReview } from '@/lib/dd-workbench/team-evaluation'

/**
 * POST /api/dd/team-evaluation/[projectId]/review
 * 重新执行 AI 审评分（确认状态下；校验各维度打分与简历描述的一致性）
 */
export async function POST(
  _request: Request,
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
      return NextResponse.json({ error: '无权操作该项目' }, { status: 403 })
    }

    const record = await prisma.dDTeamEvaluation.findUnique({ where: { projectId: params.projectId }, select: { status: true } })
    if (!record || record.status !== 'CONFIRMED') {
      return NextResponse.json({ error: '评价表未确认，确认后才会进行 AI 审评分' }, { status: 400 })
    }

    const result = await runScoringReview(params.projectId)
    if (!result.ok || !result.review) {
      return NextResponse.json({ error: result.error || 'AI 审评分失败，请稍后重试' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, review: result.review })
  } catch (error) {
    console.error('Team evaluation review error:', error)
    return NextResponse.json({ error: 'AI 审评分失败' }, { status: 500 })
  }
}
