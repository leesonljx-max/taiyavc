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
 * POST /api/research/[projectId]/[moduleType]/comments/[commentId]/replies
 * 对一级点评进行回复
 *
 * body: { content: string }
 *
 * 权限：仅项目主维护人 / 辅助维护人 / ADMIN / INVESTMENT_PARTNER 可回复
 * （即 canEditResearchProject 权限）
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string; moduleType: string; commentId: string } }
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

    const { projectId, moduleType, commentId } = params

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
    // 回复权限：仅主维护人 / 辅助维护人 / ADMIN / INVESTMENT_PARTNER 可回复
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json(
        { error: '无权回复点评，仅项目维护人/管理员/投资合伙人可回复' },
        { status: 403 }
      )
    }

    // 查找父点评，验证它属于当前项目的当前模块
    const parentComment = await prisma.researchComment.findUnique({
      where: { id: commentId },
      include: {
        module: {
          select: {
            id: true,
            projectId: true,
            moduleType: true,
          },
        },
      },
    })

    if (!parentComment) {
      return NextResponse.json({ error: '父点评不存在' }, { status: 404 })
    }

    if (parentComment.module.projectId !== projectId) {
      return NextResponse.json({ error: '点评不属于该项目' }, { status: 403 })
    }

    if (parentComment.module.moduleType !== moduleType) {
      return NextResponse.json({ error: '点评不属于该模块' }, { status: 403 })
    }

    // 仅一级点评（parentId 为空）可以被回复，不允许回复回复
    if (parentComment.parentId !== null) {
      return NextResponse.json(
        { error: '不支持对回复再次回复，请直接回复一级点评' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const content = typeof body.content === 'string' ? body.content.trim() : ''

    if (!content) {
      return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 })
    }

    if (content.length > 2000) {
      return NextResponse.json({ error: '回复内容不能超过 2000 字' }, { status: 400 })
    }

    const reply = await prisma.researchComment.create({
      data: {
        moduleId: parentComment.moduleId,
        userId: session.user.id,
        parentId: commentId,
        content,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(
      {
        reply: {
          id: reply.id,
          content: reply.content,
          createdAt: reply.createdAt,
          updatedAt: reply.updatedAt,
          user: reply.user,
          parentId: reply.parentId,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Research reply create error:', error)
    return NextResponse.json(
      { error: '创建回复失败' },
      { status: 500 }
    )
  }
}
