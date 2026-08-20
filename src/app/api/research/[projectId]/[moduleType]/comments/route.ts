export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import {
  canViewResearchProject,
  isValidModuleType,
} from '@/lib/research-permissions'

/**
 * GET /api/research/[projectId]/[moduleType]/comments
 * 获取模块的所有点评（含回复，树形结构）
 *
 * 返回结构：
 * [
 *   {
 *     id, content, createdAt, updatedAt,
 *     user: { id, name, email },
 *     replies: [
 *       { id, content, createdAt, updatedAt, user: { id, name, email } },
 *       ...
 *     ]
 *   },
 *   ...
 * ]
 */
export async function GET(
  _request: Request,
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
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    // 查找模块
    const module = await prisma.researchModule.findUnique({
      where: { projectId_moduleType: { projectId, moduleType } },
      select: { id: true },
    })

    if (!module) {
      return NextResponse.json({ comments: [] })
    }

    // 查询所有点评（含回复）
    const allComments = await prisma.researchComment.findMany({
      where: { moduleId: module.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // 构建树形结构：一级点评 + 回复
    const topLevel = allComments.filter(c => !c.parentId)
    const repliesByParent = new Map<string, typeof allComments>()
    for (const c of allComments) {
      if (c.parentId) {
        const arr = repliesByParent.get(c.parentId) || []
        arr.push(c)
        repliesByParent.set(c.parentId, arr)
      }
    }

    const tree = topLevel.map(c => ({
      id: c.id,
      content: c.content,
      quoteText: c.quoteText,
      quoteField: c.quoteField,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      user: c.user,
      replies: (repliesByParent.get(c.id) || []).map(r => ({
        id: r.id,
        content: r.content,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        user: r.user,
      })),
    }))

    return NextResponse.json({ comments: tree })
  } catch (error) {
    console.error('Research comments list error:', error)
    return NextResponse.json(
      { error: '获取点评列表失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/research/[projectId]/[moduleType]/comments
 * 创建一级点评
 *
 * body: { content: string }
 *
 * 权限：所有可查看项目的用户均可发布点评
 * （ADMIN / INVESTMENT_PARTNER / 项目主维护人 / 辅助维护人）
 */
export async function POST(
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
    // 发布点评权限：与查看权限一致（可查看即可点评）
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权发布点评' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const content = typeof body.content === 'string' ? body.content.trim() : ''

    if (!content) {
      return NextResponse.json({ error: '点评内容不能为空' }, { status: 400 })
    }

    if (content.length > 2000) {
      return NextResponse.json({ error: '点评内容不能超过 2000 字' }, { status: 400 })
    }

    // 框选提问锚点（可视化报告页）
    const quoteText = typeof body.quoteText === 'string' && body.quoteText.trim()
      ? body.quoteText.trim().substring(0, 500)
      : null
    const quoteField = typeof body.quoteField === 'string' && body.quoteField.trim()
      ? body.quoteField.trim().substring(0, 200)
      : null

    // 获取或创建模块
    const module = await prisma.researchModule.upsert({
      where: { projectId_moduleType: { projectId, moduleType } },
      create: { projectId, moduleType },
      update: {},
      select: { id: true },
    })

    const comment = await prisma.researchComment.create({
      data: {
        moduleId: module.id,
        userId: session.user.id,
        content,
        quoteText,
        quoteField,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          content: comment.content,
          quoteText: comment.quoteText,
          quoteField: comment.quoteField,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          user: comment.user,
          replies: [],
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Research comment create error:', error)
    return NextResponse.json(
      { error: '创建点评失败' },
      { status: 500 }
    )
  }
}
