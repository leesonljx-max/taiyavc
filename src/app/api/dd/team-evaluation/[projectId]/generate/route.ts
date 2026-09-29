export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { runMemberExtraction } from '@/lib/dd-workbench/team-evaluation'

/**
 * POST /api/dd/team-evaluation/[projectId]/generate
 * AI 从「团队与治理」模块上传的简历资料识别核心成员，生成团队评价打分表
 * 实控人/CEO 独占 60 分；团队整体独占 20 分；联创&核心高管共享 20 分（取平均）
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

    const existing = await prisma.dDTeamEvaluation.findUnique({ where: { projectId: params.projectId } })
    if (existing?.status === 'CONFIRMED') {
      return NextResponse.json({ error: '评价表已确认，如需重新生成请先点击"重新编辑"' }, { status: 409 })
    }

    const result = await runMemberExtraction(params.projectId)
    if (!result.ok || !result.data) {
      return NextResponse.json({ error: result.error || '生成失败' }, { status: 400 })
    }

    const data = result.data
    await prisma.dDTeamEvaluation.upsert({
      where: { projectId: params.projectId },
      create: { projectId: params.projectId, membersJson: JSON.stringify(data.members), teamJson: JSON.stringify(data.team) },
      update: { membersJson: JSON.stringify(data.members), teamJson: JSON.stringify(data.team) },
    })

    return NextResponse.json({ ok: true, members: data.members, team: data.team })
  } catch (error) {
    console.error('Team evaluation generate error:', error)
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `生成团队评价表失败：${detail}` }, { status: 500 })
  }
}
