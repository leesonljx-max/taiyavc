export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject } from '@/lib/research-permissions'

/**
 * GET /api/research
 * 项目尽调列表（尽调阶段 DUE_DILIGENCE）+ 统计
 *
 * 权限：
 * - ADMIN / INVESTMENT_PARTNER：可见所有尽调阶段项目
 * - 其他角色：仅可见自己维护的尽调阶段项目
 *
 * 返回：
 * - projects：项目列表（长条卡片字段：名称/定位/融资金额/模块进度）
 * - stats.myProjects：我的尽调项目数
 * - stats.completedReports：已生成完整尽调报告（COMPLETED 且无资料缺口）的项目数
 * - stats.pendingItems：待办事项（各项目需补充资料的模块清单）
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

    // 查询所有尽调阶段项目（含尽调报告缺口）
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
        ddReport: {
          select: {
            id: true,
            status: true,
            gapsJson: true,
            moduleResults: {
              select: { status: true, missing: true, moduleName: true },
            },
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

    // 待办：解析各项目缺口清单（INSUFFICIENT_DATA 模块）
    const pendingItems: Array<{
      projectId: string
      projectName: string
      moduleName: string
      missing: string
    }> = []

    // 计算每个项目的模块完成情况 + 尽调报告状态
    const projectsWithProgress = visibleProjects.map(project => {
      const moduleCount = project.researchModules.length
      const analyzedCount = project.researchModules.filter(m => m.analyzedAt).length

      // 尽调报告：完成 = 报告 COMPLETED 且无 INSUFFICIENT_DATA 模块
      const dd = project.ddReport
      const insufficientModules = dd?.moduleResults.filter(m => m.status === 'INSUFFICIENT_DATA') || []
      const hasCompletedReport =
        !!dd && dd.status === 'COMPLETED' && insufficientModules.length === 0

      // 待办事项：缺口模块（需补充资料）
      if (dd && dd.status !== 'FAILED') {
        for (const m of insufficientModules) {
          pendingItems.push({
            projectId: project.id,
            projectName: project.name,
            moduleName: m.moduleName,
            missing: (m.missing || '资料不足，需补充').substring(0, 120),
          })
        }
      }

      return {
        ...project,
        moduleProgress: {
          total: 9,
          created: moduleCount,
          analyzed: analyzedCount,
        },
        ddReportStatus: dd ? dd.status : null,
        hasCompletedReport,
        pendingCount: insufficientModules.length,
        members: undefined, // 不暴露 memberIds
        ddReport: undefined,
      }
    })

    return NextResponse.json({
      projects: projectsWithProgress,
      total: projectsWithProgress.length,
      stats: {
        myProjects: projectsWithProgress.length,
        completedReports: projectsWithProgress.filter(p => p.hasCompletedReport).length,
        pendingItems,
      },
    })
  } catch (error) {
    console.error('Research list error:', error)
    return NextResponse.json(
      { error: '获取项目尽调列表失败' },
      { status: 500 }
    )
  }
}
