export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'

// 3个月 = 90天
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000

/**
 * 判断用户是否可管理项目维护人
 * - ADMIN / INVESTMENT_PARTNER / 项目主维护人
 */
function canManageMaintainers(user: PermissionUser | null | undefined, createdById: string): boolean {
  if (!user) return false
  if (user.role === 'ADMIN') return true
  if (user.role === 'INVESTMENT_PARTNER') return true
  return createdById === user.id
}

/**
 * PATCH /api/projects/[id]/owner
 * 主动变更项目主维护人
 * body: { newOwnerId }
 *
 * 行为：
 * - 校验新维护人是 ACTIVE 状态的投资经理
 * - 变更 createdById 为新维护人
 * - 重置保护期（+3个月）
 * - 若新维护人原为辅助维护人，则从辅助维护人列表中移除
 * - 自动添加一条 AUTO_COMPLETED 接手记录，便于审计
 */
export async function PATCH(
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

    const projectId = params.id
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, createdById: true },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    if (!canManageMaintainers(currentUser, project.createdById)) {
      return NextResponse.json(
        { error: '无权变更主维护人，仅当前主维护人/管理员/投资合伙人可操作' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const newOwnerId = typeof body.newOwnerId === 'string' ? body.newOwnerId.trim() : ''

    if (!newOwnerId) {
      return NextResponse.json({ error: 'newOwnerId 不能为空' }, { status: 400 })
    }

    // 不能变更为当前主维护人
    if (newOwnerId === project.createdById) {
      return NextResponse.json(
        { error: '该用户已是当前主维护人' },
        { status: 400 }
      )
    }

    // 不能变更为自己（如果是当前主维护人本人调用）
    if (newOwnerId === session.user.id) {
      return NextResponse.json(
        { error: '不能将主维护人变更为自己' },
        { status: 400 }
      )
    }

    // 校验目标用户存在且为投资经理
    const targetUser = await prisma.user.findUnique({
      where: { id: newOwnerId },
      select: { id: true, name: true, email: true, username: true, role: true, status: true },
    })

    if (!targetUser) {
      return NextResponse.json({ error: '目标用户不存在' }, { status: 404 })
    }

    if (targetUser.role !== 'INVESTMENT_MANAGER') {
      return NextResponse.json(
        { error: '仅可变更为投资经理账号' },
        { status: 400 }
      )
    }

    if (targetUser.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: '目标用户账号非活跃状态，无法变更' },
        { status: 400 }
      )
    }

    const now = new Date()
    const newProtectionExpiresAt = new Date(now.getTime() + THREE_MONTHS_MS)
    const oldOwnerId = project.createdById

    // 事务：变更主维护人 + 重置保护期 + 移除新维护人的辅助维护人记录 + 创建审计记录
    await prisma.$transaction([
      prisma.project.update({
        where: { id: projectId },
        data: {
          createdById: newOwnerId,
          protectionExpiresAt: newProtectionExpiresAt,
        },
      }),
      // 若新维护人原为辅助维护人，移除该记录
      prisma.projectMember.deleteMany({
        where: { projectId, userId: newOwnerId },
      }),
      // 创建 AUTO_COMPLETED 接手记录便于审计
      prisma.takeoverRequest.create({
        data: {
          projectId,
          requesterId: newOwnerId,
          currentOwnerId: oldOwnerId,
          status: 'AUTO_COMPLETED',
          comment: '原维护人主动变更',
          reviewerComment: `由 ${session.user.name || session.user.email} 主动变更主维护人`,
          reviewedAt: now,
        },
      }),
    ])

    return NextResponse.json({
      message: '主维护人变更成功',
      newOwner: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        username: targetUser.username,
      },
      protectionExpiresAt: newProtectionExpiresAt,
    })
  } catch (error) {
    console.error('Change project owner error:', error)
    return NextResponse.json(
      { error: '变更主维护人失败' },
      { status: 500 }
    )
  }
}
