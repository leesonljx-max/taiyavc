import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canManageUsers, type PermissionUser } from '@/lib/permissions'

// GET: 获取所有用户列表（仅管理员）
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    if (!canManageUsers(currentUser)) {
      return NextResponse.json({ error: '无权访问，仅管理员可管理用户' }, { status: 403 })
    }

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // 统计待审批用户数
    const pendingCount = users.filter(u => u.status === 'PENDING').length

    return NextResponse.json({ users, pendingCount })
  } catch (error) {
    return NextResponse.json(
      { error: '获取用户列表失败' },
      { status: 500 }
    )
  }
}

// PATCH: 更新用户角色或状态（仅管理员）
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    if (!canManageUsers(currentUser)) {
      return NextResponse.json({ error: '无权操作，仅管理员可管理用户' }, { status: 403 })
    }

    const body = await request.json()
    const { id, role, status } = body

    if (!id) {
      return NextResponse.json({ error: '用户 ID 必填' }, { status: 400 })
    }

    // 防止管理员修改自己的角色（避免误锁定）
    if (id === session.user.id && role && role !== 'ADMIN') {
      return NextResponse.json(
        { error: '不能修改自己的管理员角色' },
        { status: 400 }
      )
    }

    const validRoles: UserRole[] = ['ADMIN', 'INVESTMENT_MANAGER', 'INVESTMENT_PARTNER', 'POST_INVESTMENT_OFFICER', 'TEMP_VISITOR']
    const validStatuses = ['ACTIVE', 'PENDING', 'REJECTED', 'DISABLED']

    const data: { role?: string; status?: string } = {}
    if (role !== undefined) {
      if (!validRoles.includes(role as UserRole)) {
        return NextResponse.json({ error: '无效的角色' }, { status: 400 })
      }
      data.role = role
    }
    if (status !== undefined) {
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: '无效的状态' }, { status: 400 })
      }
      data.status = status
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '未提供要更新的字段' }, { status: 400 })
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ user: updatedUser })
  } catch (error) {
    return NextResponse.json(
      { error: '更新用户失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
