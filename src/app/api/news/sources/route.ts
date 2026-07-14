import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/news/sources — 获取所有自定义来源
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const sources = await prisma.newsSource.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ sources: sources.map(s => ({ id: s.id, name: s.name })) })
  } catch (error) {
    console.error('News sources GET error:', error)
    return NextResponse.json({ error: '获取来源失败' }, { status: 500 })
  }
}

/**
 * POST /api/news/sources — 添加自定义来源
 * body: { name: string }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name = body.name?.trim()

    if (!name) {
      return NextResponse.json({ error: '来源名称不能为空' }, { status: 400 })
    }

    const result = await prisma.newsSource.upsert({
      where: { name },
      update: {},
      create: { name },
    })

    return NextResponse.json({ source: { id: result.id, name: result.name } })
  } catch (error) {
    console.error('News sources POST error:', error)
    return NextResponse.json({ error: '添加来源失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/news/sources?id=xxx — 删除自定义来源
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
      return NextResponse.json({ error: '缺少来源 ID' }, { status: 400 })
    }

    await prisma.newsSource.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('News sources DELETE error:', error)
    return NextResponse.json({ error: '删除来源失败' }, { status: 500 })
  }
}
