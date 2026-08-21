export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runAIResearchChat } from '@/lib/ai-research-runner'

/**
 * AI行研消息
 *
 * GET  /api/ai-research/messages?sessionId=xxx → 会话消息列表（时序）
 * POST /api/ai-research/messages               → 发送提问，同步返回 AI 回答
 *      body: { sessionId, content }
 *      - 会话标题为"新对话"时自动从首条提问生成
 *      - 记忆召回 + Harness（内部库+联网）+ 异步记忆提取
 */

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) {
      return NextResponse.json({ error: '缺少 sessionId' }, { status: 400 })
    }

    // 权限：只能看自己的会话
    const chatSession = await prisma.aIChatSession.findUnique({ where: { id: sessionId } })
    if (!chatSession || chatSession.userId !== session.user.id) {
      return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 })
    }

    const messages = await prisma.aIChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })

    return NextResponse.json({
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sourcesJson ? JSON.parse(m.sourcesJson) : [],
        projects: m.projectsJson ? JSON.parse(m.projectsJson) : [],
        createdAt: m.createdAt,
      })),
    })
  } catch (error) {
    console.error('AI research messages GET error:', error)
    return NextResponse.json({ error: '获取消息失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const content = typeof body.content === 'string' ? body.content.trim() : ''

    if (!sessionId || !content) {
      return NextResponse.json({ error: '缺少 sessionId 或提问内容' }, { status: 400 })
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: '提问内容过长（限 2000 字）' }, { status: 400 })
    }

    // 权限：只能在自己的会话中提问
    const chatSession = await prisma.aIChatSession.findUnique({ where: { id: sessionId } })
    if (!chatSession || chatSession.userId !== session.user.id) {
      return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 })
    }

    // 保存用户消息
    await prisma.aIChatMessage.create({
      data: { sessionId, role: 'user', content },
    })

    // 工作记忆：最近 2 轮（4 条，不含刚插入的这条 user）
    const recent = await prisma.aIChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 4,
    })
    const recentMessages = recent
      .reverse()
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    // 最后一条是刚存的本次提问，从工作记忆里去掉（已作为 userMessage 传入）
    const workMemory = recentMessages.filter((_, i, arr) => !(i === arr.length - 1))

    // Harness 执行（记忆召回 → 内部库+联网 → 回答）
    const result = await runAIResearchChat(content, {
      sessionId,
      recentMessages: workMemory,
    })

    // 保存 AI 回答（含溯源）
    const saved = await prisma.aIChatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: result.content,
        sourcesJson: JSON.stringify(result.citations),
        projectsJson: JSON.stringify(result.projectHits),
      },
    })

    // 会话标题：首条提问时自动生成（取前 20 字）
    let title = chatSession.title
    if (title === '新对话') {
      title = content.substring(0, 20) + (content.length > 20 ? '…' : '')
    }

    await prisma.aIChatSession.update({
      where: { id: sessionId },
      data: { title, updatedAt: new Date() },
    })

    return NextResponse.json({
      message: {
        id: saved.id,
        role: 'assistant',
        content: result.content,
        sources: result.citations,
        projects: result.projectHits,
        createdAt: saved.createdAt,
      },
    })
  } catch (error) {
    console.error('AI research messages POST error:', error)
    return NextResponse.json(
      { error: 'AI 回答失败：' + (error instanceof Error ? error.message : '未知错误') },
      { status: 500 }
    )
  }
}
