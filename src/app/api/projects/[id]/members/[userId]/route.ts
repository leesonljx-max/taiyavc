export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'

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
 * DELETE /api/projects/[id]/members/[userId]
 * 移除项目辅助维护人
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; userId: string } }
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

    const { id: projectId, userId } = params

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, createdById: true },
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

    // 不能移除主维护人
    if (userId === project.createdById) {
      return NextResponse.json(
        { error: '不能移除主维护人，请使用"变更维护人"功能' },
        { status: 400 }
      )
    }

    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
    })

    if (!member) {
      return NextResponse.json(
        { error: '该用户不是项目辅助维护人' },
        { status: 404 }
      )
    }

    await prisma.projectMember.delete({
      where: { id: member.id },
    })

    return NextResponse.json({ message: '辅助维护人已移除' })
  } catch (error) {
    console.error('Remove project member error:', error)
    return NextResponse.json(
      { error: '移除辅助维护人失败' },
      { status: 500 }
    )
  }
}
