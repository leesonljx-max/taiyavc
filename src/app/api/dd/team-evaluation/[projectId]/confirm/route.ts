export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { parseEvaluation, validateEvaluation, computeEvaluation, scoreColor } from '@/lib/dd-workbench/team-evaluation'

/**
 * POST /api/dd/team-evaluation/[projectId]/confirm
 * 确认团队评价：校验全部维度已评分 → 计算最终得分（10 分制）→ CONFIRMED
 * 已确认状态再次调用 → 重新打开为 DRAFT（可编辑）
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

    const record = await prisma.dDTeamEvaluation.findUnique({ where: { projectId: params.projectId } })
    if (!record) {
      return NextResponse.json({ error: '评价表尚未生成，请先生成团队评价表' }, { status: 400 })
    }

    // 已确认 → 重新打开为 DRAFT
    if (record.status === 'CONFIRMED') {
      await prisma.dDTeamEvaluation.update({
        where: { id: record.id },
        data: { status: 'DRAFT', finalScore: null, confirmedAt: null },
      })
      return NextResponse.json({ ok: true, reopened: true })
    }

    // DRAFT → 校验并确认
    const data = parseEvaluation(record.membersJson, record.teamJson)
    const check = validateEvaluation(data, true)
    if (!check.ok) {
      return NextResponse.json({ error: check.errors.join('；') }, { status: 400 })
    }
    const result = computeEvaluation(data)
    if (!result.allScored) {
      return NextResponse.json({ error: '存在未评分的维度，请完成全部评分后确认' }, { status: 400 })
    }

    await prisma.dDTeamEvaluation.update({
      where: { id: record.id },
      data: { status: 'CONFIRMED', finalScore: result.finalScore, confirmedAt: new Date() },
    })

    return NextResponse.json({
      ok: true,
      finalScore: result.finalScore,
      color: scoreColor(result.finalScore),
      detail: result,
    })
  } catch (error) {
    console.error('Team evaluation confirm error:', error)
    return NextResponse.json({ error: '确认团队评价失败' }, { status: 500 })
  }
}
