export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import bcrypt from 'bcryptjs'

/**
 * PATCH /api/user/password
 * 修改当前登录用户的密码（需验证旧密码）
 */
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { currentPassword, newPassword } = body

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: '当前密码和新密码均为必填' }, { status: 400 })
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: '新密码长度至少 6 位' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!isCurrentValid) {
      return NextResponse.json({ error: '当前密码错误' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({
      where: { id: session.user.id },
      data: { passwordHash },
    })

    return NextResponse.json({ message: '密码修改成功' })
  } catch (error) {
    return NextResponse.json(
      { error: '修改密码失败' },
      { status: 500 }
    )
  }
}
