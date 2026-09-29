export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { runModuleReportGeneration } from '@/lib/dd-workbench/module-report'

/**
 * POST /api/dd/resources/[projectId]/report
 * 生成尽调报告：九大模块资料完整才可生成（不完整返回 400 + 缺失清单）
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
      select: { name: true, createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权生成报告' }, { status: 403 })
    }

    const result = await runModuleReportGeneration(params.projectId, project.name)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, missing: result.missing },
        { status: result.missing.length > 0 ? 400 : 502 }
      )
    }

    return NextResponse.json({ ok: true, resources: result.resources })
  } catch (error) {
    console.error('DD report generation error:', error)
    return NextResponse.json({ error: '生成尽调报告失败' }, { status: 500 })
  }
}
