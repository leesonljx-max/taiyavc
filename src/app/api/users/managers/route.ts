import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'

/**
 * 获取投资经理列表（供投资合伙人/管理员在工作台筛选项目使用）
 * 仅 ADMIN / INVESTMENT_PARTNER 可访问
 * 返回所有 INVESTMENT_MANAGER 角色且状态为 ACTIVE 的用户
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const role = session.user.role as UserRole
    if (role !== 'ADMIN' && role !== 'INVESTMENT_PARTNER') {
      return NextResponse.json({ error: '无权访问' }, { status: 403 })
    }

    const managers = await prisma.user.findMany({
      where: {
        role: 'INVESTMENT_MANAGER',
        status: 'ACTIVE',
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
      },
    })

    return NextResponse.json({ managers })
  } catch (error) {
    return NextResponse.json(
      { error: '获取投资经理列表失败' },
      { status: 500 }
    )
  }
}
