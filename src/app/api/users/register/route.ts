export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import bcrypt from 'bcryptjs'

/**
 * POST /api/users/register
 * 用户自助注册（提交后由管理员审批）
 * 必填：姓名、账户名、邮箱、密码、确认密码
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, username, email, password, confirmPassword } = body

    // 校验必填字段
    if (!name || !username || !email || !password) {
      return NextResponse.json(
        { error: '姓名、账户名、邮箱、密码均为必填项' },
        { status: 400 }
      )
    }

    // 校验确认密码
    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: '两次输入的密码不一致' },
        { status: 400 }
      )
    }

    // 校验密码长度
    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码长度至少 6 位' },
        { status: 400 }
      )
    }

    // 校验邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: '邮箱格式不正确' },
        { status: 400 }
      )
    }

    // 检查邮箱是否已存在
    const existingEmail = await prisma.user.findUnique({ where: { email } })
    if (existingEmail) {
      return NextResponse.json(
        { error: '该邮箱已被注册' },
        { status: 409 }
      )
    }

    // 检查账户名是否已存在
    const existingUsername = await prisma.user.findUnique({ where: { username } })
    if (existingUsername) {
      return NextResponse.json(
        { error: '该账户名已被使用' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    // 自助注册用户默认 PENDING 状态，需管理员审批
    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        name,
        role: 'TEMP_VISITOR', // 注册时默认临时访客，管理员审批时分配权限
        status: 'PENDING',
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
    })

    return NextResponse.json(
      { user, message: '注册成功，请等待管理员审批后登录' },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    )
  }
}
