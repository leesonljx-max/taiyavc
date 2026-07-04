import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * PATCH /api/user/profile
 * 修改当前登录用户的姓名和头像
 */
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { name, avatar } = body

    const data: { name?: string; avatar?: string | null } = {}

    if (name !== undefined) {
      const trimmedName = String(name).trim()
      if (!trimmedName) {
        return NextResponse.json({ error: '姓名不能为空' }, { status: 400 })
      }
      if (trimmedName.length > 50) {
        return NextResponse.json({ error: '姓名不能超过 50 个字符' }, { status: 400 })
      }
      data.name = trimmedName
    }

    if (avatar !== undefined) {
      if (avatar && !avatar.startsWith('/avatars/') && !avatar.startsWith('https://')) {
        return NextResponse.json({ error: '头像地址格式无效' }, { status: 400 })
      }
      // avatar 可以是 null（清除头像）或字符串（头像 URL）
      data.avatar = avatar
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '未提供要更新的字段' }, { status: 400 })
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: {
        id: true,
        name: true,
        avatar: true,
        email: true,
        username: true,
      },
    })

    return NextResponse.json({ user: updatedUser })
  } catch (error) {
    return NextResponse.json(
      { error: '更新个人信息失败' },
      { status: 500 }
    )
  }
}
