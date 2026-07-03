import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@/lib/auth'

const allowedRoles: UserRole[] = ['ADMIN', 'INVESTMENT_MANAGER', 'INVESTMENT_PARTNER', 'POST_INVESTMENT_OFFICER', 'TEMP_VISITOR']

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password, name, role = 'TEMP_VISITOR' } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: '邮箱和密码是必填项' },
        { status: 400 }
      )
    }

    if (!allowedRoles.includes(role as UserRole)) {
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

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    )
  }
}
