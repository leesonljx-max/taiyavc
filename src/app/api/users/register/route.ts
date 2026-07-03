import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@/lib/auth'

// 自助注册允许的角色（限制为投资经理、投资合伙人、投后专员、临时访客；管理员不可自助注册）
const selfRegisterRoles: UserRole[] = ['INVESTMENT_MANAGER', 'INVESTMENT_PARTNER', 'POST_INVESTMENT_OFFICER', 'TEMP_VISITOR']

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password, name, role = 'INVESTMENT_MANAGER' } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: '邮箱和密码是必填项' },
        { status: 400 }
      )
    }

    if (!selfRegisterRoles.includes(role as UserRole)) {
      return NextResponse.json(
        { error: '无效的角色类型' },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: '该邮箱已被注册' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    // 自助注册用户默认 PENDING 状态，需管理员审批
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
        status: 'PENDING',
      },
      select: {
        id: true,
        email: true,
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
