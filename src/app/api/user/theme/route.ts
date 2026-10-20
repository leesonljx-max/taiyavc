export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { THEME_IDS, DEFAULT_THEME_ID } from '@/lib/themes'

/**
 * GET /api/user/theme
 * 当前登录用户的底色主题（未设置时返回默认）
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { themeColor: true },
    })

    return NextResponse.json({ themeId: user?.themeColor || DEFAULT_THEME_ID })
  } catch (error) {
    return NextResponse.json({ error: '获取主题失败' }, { status: 500 })
  }
}

/**
 * PATCH /api/user/theme  Body: { themeId: "c1" | "g3" | "default" | ... }
 * 保存当前登录用户的底色主题（按账户持久化，跨设备生效）
 */
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const themeId = String(body?.themeId || '')
    if (!THEME_IDS.includes(themeId)) {
      return NextResponse.json({ error: '不支持的主题' }, { status: 400 })
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { themeColor: themeId },
    })

    return NextResponse.json({ themeId })
  } catch (error) {
    return NextResponse.json({ error: '保存主题失败' }, { status: 500 })
  }
}
