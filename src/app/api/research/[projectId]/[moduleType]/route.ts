export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import {
  canEditResearchProject,
  isValidModuleType,
} from '@/lib/research-permissions'

/**
 * PUT /api/research/[projectId]/[moduleType]
 * 更新模块的手动输入内容（content 字段）
 *
 * 用于：融资规划、投资建议等纯手动模块，以及其他模块的补充输入
 */
export async function PUT(
  request: Request,
  { params }: { params: { projectId: string; moduleType: string } }
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

    const { projectId, moduleType } = params

    // 验证 moduleType
    if (!isValidModuleType(moduleType)) {
      return NextResponse.json(
        { error: `无效的模块类型: ${moduleType}` },
        { status: 400 }
      )
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        createdById: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    // 解析请求体
    const body = await request.json()
    const { content } = body as { content: Record<string, unknown> }

    if (content === undefined || content === null) {
      return NextResponse.json({ error: '缺少 content 字段' }, { status: 400 })
    }

    // 序列化为 JSON 字符串存储
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)

    // upsert 模块（如果不存在则创建）
    const module = await prisma.researchModule.upsert({
      where: {
        projectId_moduleType: { projectId, moduleType },
      },
      create: {
        projectId,
        moduleType,
        content: contentStr,
      },
      update: {
        content: contentStr,
      },
    })

    return NextResponse.json({
      moduleId: module.id,
      moduleType: module.moduleType,
      content: content,
      updatedAt: module.updatedAt,
    })
  } catch (error) {
    console.error('Research module update error:', error)
    return NextResponse.json(
      { error: '更新模块内容失败' },
      { status: 500 }
    )
  }
}
