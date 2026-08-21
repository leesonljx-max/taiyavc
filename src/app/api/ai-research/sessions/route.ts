export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * AI行研会话管理
 *
 * GET  /api/ai-research/sessions          → 当前用户会话列表（updatedAt 倒序）
 * POST /api/ai-research/sessions          → 创建新会话（title 默认"新对话"，首条消息后自动生成）
 * DELETE /api/ai-research/sessions?id=xxx  → 删除会话（级联消息）
 */

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const sessions = await prisma.aIChatSession.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
      take: 50,
    })

    return NextResponse.json({
      sessions: sessions.map(s => ({
        id: s.id,
        title: s.title,
        messageCount: s._count.messages,
        updatedAt: s.updatedAt,
      })),
    })
  } catch (error) {
    console.error('AI research sessions GET error:', error)
    return NextResponse.json({ error: '获取会话列表失败' }, { status: 500 })
  }
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const created = await prisma.aIChatSession.create({
      data: { userId: session.user.id },
    })

    return NextResponse.json({ session: { id: created.id, title: created.title, updatedAt: created.updatedAt } })
  } catch (error) {
    console.error('AI research sessions POST error:', error)
    return NextResponse.json({ error: '创建会话失败' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 })
    }

    // 只能删自己的会话
    const existing = await prisma.aIChatSession.findUnique({ where: { id } })
    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: '会话不存在或无权操作' }, { status: 404 })
    }

    await prisma.aIChatSession.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('AI research sessions DELETE error:', error)
    return NextResponse.json({ error: '删除会话失败' }, { status: 500 })
  }
}
