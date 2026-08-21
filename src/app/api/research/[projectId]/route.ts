export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import {
  canViewResearchProject,
  ALL_MODULE_TYPES,
  type ResearchModuleType,
} from '@/lib/research-permissions'

/**
 * GET /api/research/[projectId]
 * 获取项目的所有 9 个投研分析模块数据（含文档）
 *
 * 自动创建缺失的模块行
 */
export async function GET(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
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

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: {
        id: true,
        name: true,
        companyFullName: true,
        industry: true,
        companyPosition: true,
        mainProducts: true,
        coreAdvantage: true,
        coreTeam: true,
        competitors: true,
        description: true,
        totalAmount: true,
        raisedAmount: true,
        followStage: true,
        createdById: true,
        manualHighlights: true,
        aiHighlightsJson: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 权限校验
    const memberIds = project.members.map(m => m.userId)
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    // 查询已有模块
    const existingModules = await prisma.researchModule.findMany({
      where: { projectId: params.projectId },
      include: {
        documents: {
          select: {
            id: true,
            fileName: true,
            fileUrl: true,
            fileType: true,
            fileSize: true,
            createdAt: true,
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    // 自动创建缺失的模块行
    const existingTypes = new Set(existingModules.map(m => m.moduleType))
    const missingTypes = ALL_MODULE_TYPES.filter(t => !existingTypes.has(t))

    if (missingTypes.length > 0) {
      await prisma.researchModule.createMany({
        data: missingTypes.map((moduleType: ResearchModuleType) => ({
          projectId: params.projectId,
          moduleType,
        })),
      })

      // 重新查询
      const newModules = await prisma.researchModule.findMany({
        where: {
          projectId: params.projectId,
          moduleType: { in: missingTypes },
        },
        include: {
          documents: {
            select: {
              id: true,
              fileName: true,
              fileUrl: true,
              fileType: true,
              fileSize: true,
              createdAt: true,
              uploadedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      })
      existingModules.push(...newModules)
    }

    // 按 ALL_MODULE_TYPES 顺序排序
    const moduleOrder = ALL_MODULE_TYPES
    existingModules.sort((a, b) => moduleOrder.indexOf(a.moduleType as ResearchModuleType) - moduleOrder.indexOf(b.moduleType as ResearchModuleType))

    // 服务端计算当前用户是否维护人（不暴露成员ID列表）
    const isMaintainer =
      project.createdById === session.user.id || memberIds.includes(session.user.id)

    return NextResponse.json({
      project: {
        ...project,
        members: undefined, // 不暴露 memberIds
        isMaintainer,
      },
      modules: existingModules,
    })
  } catch (error) {
    console.error('Research detail error:', error)
    return NextResponse.json(
      { error: '获取投研分析数据失败' },
      { status: 500 }
    )
  }
}
