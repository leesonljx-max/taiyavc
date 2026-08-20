export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject } from '@/lib/research-permissions'

/**
 * GET /api/research/[projectId]/questions
 * 可视化报告页：聚合项目全部模块的提问（含回复），供右侧问答面板使用
 *
 * 返回：{
 *   questions: [{
 *     id, content, quoteText, quoteField,
 *     moduleType, createdAt, updatedAt,
 *     user: { id, name, email },
 *     replies: [{ id, content, createdAt, user: {...} }]
 *   }]
 * }
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

    const { projectId } = params

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
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    // 查询项目全部模块的一级点评及回复
    const modules = await prisma.researchModule.findMany({
      where: { projectId },
      select: { id: true, moduleType: true },
    })
    const moduleIds = modules.map(m => m.id)
    const moduleTypeById = new Map(modules.map(m => [m.id, m.moduleType]))

    const allComments = await prisma.researchComment.findMany({
      where: { moduleId: { in: moduleIds } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })

    const topLevel = allComments.filter(c => !c.parentId)
    const repliesByParent = new Map<string, typeof allComments>()
    for (const c of allComments) {
      if (c.parentId) {
        const arr = repliesByParent.get(c.parentId) || []
        arr.push(c)
        repliesByParent.set(c.parentId, arr)
      }
    }

    const questions = topLevel
      .map(c => ({
        id: c.id,
        content: c.content,
        quoteText: c.quoteText,
        quoteField: c.quoteField,
        moduleType: moduleTypeById.get(c.moduleId) || '',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        user: c.user,
        replies: (repliesByParent.get(c.id) || []).map(r => ({
          id: r.id,
          content: r.content,
          createdAt: r.createdAt,
          user: r.user,
        })),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json({ questions })
  } catch (error) {
    console.error('Research questions list error:', error)
    return NextResponse.json(
      { error: '获取问题列表失败' },
      { status: 500 }
    )
  }
}
