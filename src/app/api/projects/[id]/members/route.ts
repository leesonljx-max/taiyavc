export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'

/**
 * 判断用户是否可管理项目维护人（主动变更主维护人 / 添加删除辅助维护人）
 * - ADMIN
 * - INVESTMENT_PARTNER
 * - 项目主维护人（createdById === user.id）
 */
function canManageMaintainers(user: PermissionUser | null | undefined, createdById: string): boolean {
  if (!user) return false
  if (user.role === 'ADMIN') return true
  if (user.role === 'INVESTMENT_PARTNER') return true
  return createdById === user.id
}

/**
 * POST /api/projects/[id]/members
 * 添加项目辅助维护人
 * body: { userId }
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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
      where: { id: params.id },
      select: { id: true, createdById: true, name: true },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    if (!canManageMaintainers(currentUser, project.createdById)) {
      return NextResponse.json(
        { error: '无权管理维护人，仅主维护人/管理员/投资合伙人可操作' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''

    if (!userId) {
      return NextResponse.json({ error: 'userId 不能为空' }, { status: 400 })
    }

    // 不能将主维护人添加为辅助维护人
    if (userId === project.createdById) {
      return NextResponse.json(
        { error: '该用户已是主维护人，无需添加为辅助维护人' },
        { status: 400 }
      )
    }

    // 校验目标用户存在且为投资经理
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, username: true, role: true, status: true },
    })

    if (!targetUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    if (targetUser.role !== 'INVESTMENT_MANAGER') {
      return NextResponse.json(
        { error: '仅可添加投资经理为辅助维护人' },
        { status: 400 }
      )
    }

    if (targetUser.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: '该用户账号非活跃状态，无法添加' },
        { status: 400 }
      )
    }

    // 创建辅助维护人（若已存在则忽略 - @@unique 约束）
    const existing = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId: params.id } },
    })
    if (existing) {
      return NextResponse.json(
        { error: '该用户已是项目辅助维护人' },
        { status: 400 }
      )
    }

    const member = await prisma.projectMember.create({
      data: { userId, projectId: params.id },
      include: {
        user: { select: { id: true, name: true, email: true, username: true } },
      },
    })

    return NextResponse.json(
      { member: member.user, message: '辅助维护人添加成功' },
      { status: 201 }
    )
  } catch (error) {
    console.error('Add project member error:', error)
    return NextResponse.json(
      { error: '添加辅助维护人失败' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/projects/[id]/members
 * 获取项目辅助维护人列表
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: { id: true, createdById: true },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const members = await prisma.projectMember.findMany({
      where: { projectId: params.id },
      include: { user: { select: { id: true, name: true, email: true, username: true } } },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      members: members.map(m => m.user),
      owner: { id: project.createdById },
    })
  } catch (error) {
    console.error('Get project members error:', error)
    return NextResponse.json(
      { error: '获取辅助维护人列表失败' },
      { status: 500 }
    )
  }
}
