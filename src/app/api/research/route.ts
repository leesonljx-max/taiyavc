export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject } from '@/lib/research-permissions'

/**
 * GET /api/research
 * 获取投研分析项目列表（尽调阶段 DUE_DILIGENCE）
 *
 * 权限：
 * - ADMIN / INVESTMENT_PARTNER：可见所有尽调阶段项目
 * - 其他角色：仅可见自己维护的尽调阶段项目
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    // 查询所有尽调阶段项目
    const allDueDiligenceProjects = await prisma.project.findMany({
      where: { followStage: 'DUE_DILIGENCE' },
      select: {
        id: true,
        name: true,
        companyFullName: true,
        industry: true,
        companyPosition: true,
        totalAmount: true,
        raisedAmount: true,
        targetDate: true,
        createdAt: true,
        createdById: true,
        createdBy: { select: { id: true, name: true, email: true } },
        members: { select: { userId: true } },
        researchModules: {
          select: {
            id: true,
            moduleType: true,
            analyzedAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // 权限筛选
    const visibleProjects = allDueDiligenceProjects.filter(project => {
      const memberIds = project.members.map(m => m.userId)
      return canViewResearchProject(currentUser, {
        createdById: project.createdById,
        memberIds,
      })
    })

    // 计算每个项目的模块完成情况
    const projectsWithProgress = visibleProjects.map(project => {
      const moduleCount = project.researchModules.length
      const analyzedCount = project.researchModules.filter(m => m.analyzedAt).length
      return {
        ...project,
        moduleProgress: {
          total: 9,
          created: moduleCount,
          analyzed: analyzedCount,
        },
        members: undefined, // 不暴露 memberIds
      }
    })

    return NextResponse.json({
      projects: projectsWithProgress,
      total: projectsWithProgress.length,
    })
  } catch (error) {
    console.error('Research list error:', error)
    return NextResponse.json(
      { error: '获取投研分析项目列表失败' },
      { status: 500 }
    )
  }
}
