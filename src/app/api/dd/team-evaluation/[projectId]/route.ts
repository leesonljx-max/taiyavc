export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject, canEditResearchProject } from '@/lib/research-permissions'
import { parseEvaluation, validateEvaluation, type TeamEvaluationData } from '@/lib/dd-workbench/team-evaluation'

/**
 * GET /api/dd/team-evaluation/[projectId]
 * 获取团队评价表（无记录时返回 { evaluation: null }）
 */
export async function GET(
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
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const record = await prisma.dDTeamEvaluation.findUnique({ where: { projectId: params.projectId } })
    if (!record) return NextResponse.json({ evaluation: null })
    const data = parseEvaluation(record.membersJson, record.teamJson)
    return NextResponse.json({
      evaluation: {
        ...data,
        status: record.status,
        finalScore: record.finalScore,
        confirmedAt: record.confirmedAt?.toISOString() || null,
      },
    })
  } catch (error) {
    console.error('Team evaluation get error:', error)
    return NextResponse.json({ error: '获取团队评价表失败' }, { status: 500 })
  }
}

/**
 * PUT /api/dd/team-evaluation/[projectId]
 * 保存团队评价（权重 + 评分草稿）
 * body: { members: TeamMember[], team: TeamDimension[] }
 */
export async function PUT(
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
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    const existing = await prisma.dDTeamEvaluation.findUnique({ where: { projectId: params.projectId } })
    if (existing?.status === 'CONFIRMED') {
      return NextResponse.json({ error: '评价表已确认，如需修改请先点击"重新编辑"' }, { status: 409 })
    }

    const body = (await request.json().catch(() => ({}))) as { members?: unknown; team?: unknown }
    const data: TeamEvaluationData = {
      members: Array.isArray(body.members) ? (body.members as TeamEvaluationData['members']) : [],
      team: Array.isArray(body.team) ? (body.team as TeamEvaluationData['team']) : [],
    }
    if (data.members.length === 0 || data.team.length === 0) {
      return NextResponse.json({ error: '评价表数据不完整' }, { status: 400 })
    }
    // 保存草稿：允许未评分，但权重与评分范围必须合法
    const check = validateEvaluation(data, false)
    if (!check.ok) {
      return NextResponse.json({ error: check.errors.join('；') }, { status: 400 })
    }

    await prisma.dDTeamEvaluation.upsert({
      where: { projectId: params.projectId },
      create: { projectId: params.projectId, membersJson: JSON.stringify(data.members), teamJson: JSON.stringify(data.team) },
      update: { membersJson: JSON.stringify(data.members), teamJson: JSON.stringify(data.team) },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Team evaluation save error:', error)
    return NextResponse.json({ error: '保存团队评价表失败' }, { status: 500 })
  }
}
