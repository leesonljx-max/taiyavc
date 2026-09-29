export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject } from '@/lib/research-permissions'
import { getProjectModuleResources, isModuleComplete, isReportReady } from '@/lib/dd-workbench/resources'

/**
 * GET /api/dd/resources/[projectId]
 * 尽调工作台资料中心：九大模块资料（文档/文本框/截图/报告）+ 完整性与报告状态
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

    const resources = await getProjectModuleResources(params.projectId)
    return NextResponse.json({
      resources,
      allComplete: resources.every(isModuleComplete),
      reportReady: isReportReady(resources),
    })
  } catch (error) {
    console.error('DD resources error:', error)
    return NextResponse.json({ error: '获取资料中心失败' }, { status: 500 })
  }
}
