export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { runModuleAnalysis } from '@/lib/dd-workbench/module-report'
import { isValidModuleKey } from '@/lib/dd-workbench/resources'

/**
 * POST /api/dd/resources/[projectId]/[moduleKey]/analyze
 * 单模块分析：AI 从该模块上传的资料提取事实卡（facts）与下一步行动（actions）
 * 事实卡状态默认待确认，由维护人在事实卡中逐条确认/标记冲突
 */
export async function POST(
  _request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const { projectId, moduleKey } = params
    if (!isValidModuleKey(moduleKey)) {
      return NextResponse.json({ error: `无效的模块标识: ${moduleKey}` }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权分析该项目' }, { status: 403 })
    }

    const result = await runModuleAnalysis(projectId, moduleKey)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true, analysis: result.analysis })
  } catch (error) {
    console.error('DD module analyze error:', error)
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `单模块分析失败：${detail}` }, { status: 500 })
  }
}
