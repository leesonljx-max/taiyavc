export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/news/keywords — 获取所有自定义关键字
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const keywords = await prisma.newsKeyword.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ keywords: keywords.map(k => ({ id: k.id, keyword: k.keyword })) })
  } catch (error) {
    console.error('News keywords GET error:', error)
    return NextResponse.json({ error: '获取关键字失败' }, { status: 500 })
  }
}

/**
 * POST /api/news/keywords — 添加自定义关键字
 * body: { keyword: string }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const keyword = body.keyword?.trim()

    if (!keyword) {
      return NextResponse.json({ error: '关键字不能为空' }, { status: 400 })
    }

    // upsert：已存在则不重复创建
    const result = await prisma.newsKeyword.upsert({
      where: { keyword },
      update: {},
      create: { keyword },
    })

    return NextResponse.json({ keyword: { id: result.id, keyword: result.keyword } })
  } catch (error) {
    console.error('News keywords POST error:', error)
    return NextResponse.json({ error: '添加关键字失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/news/keywords?id=xxx — 删除自定义关键字
 */
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: '缺少关键字 ID' }, { status: 400 })
    }

    await prisma.newsKeyword.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('News keywords DELETE error:', error)
    return NextResponse.json({ error: '删除关键字失败' }, { status: 500 })
  }
}
