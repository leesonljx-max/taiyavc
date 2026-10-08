export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { verifyTextClaims } from '@/lib/dd-workbench/claim-verifier'
import { saveVerifiedClaims } from '@/lib/knowledge-base'

/**
 * POST /api/ai-research/messages/verify
 * AI行研回答关键数据按需核验（P2.3）：提取回答中的关键声明（【】数据等）→ 双源搜索 → 四级裁决
 * body: { messageId }；结果写入 AIChatMessage.verificationJson；已核验结论沉淀知识库
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const messageId = typeof body.messageId === 'string' ? body.messageId : ''
    if (!messageId) {
      return NextResponse.json({ error: '缺少 messageId' }, { status: 400 })
    }

    // 权限：消息所属会话必须是自己的
    const message = await prisma.aIChatMessage.findUnique({
      where: { id: messageId },
      include: { session: { select: { userId: true } } },
    })
    if (!message || message.session.userId !== session.user.id) {
      return NextResponse.json({ error: '消息不存在或无权访问' }, { status: 404 })
    }
    if (message.role !== 'assistant') {
      return NextResponse.json({ error: '仅支持核验 AI 回答' }, { status: 400 })
    }

    const verification = await verifyTextClaims(message.content, { module: 'ai-research' })

    // 落库 + 知识沉淀（✅/⚠️/❌ 结论入知识库，主体优先声明自身 entity，无行业上下文）
    const [, kbSaved] = await Promise.all([
      prisma.aIChatMessage.update({
        where: { id: messageId },
        data: { verificationJson: JSON.stringify(verification) },
      }),
      saveVerifiedClaims({
        claims: verification.claims,
        industry: null, // 行研无显式行业上下文，由声明自身 entity 归档（公司主体）
        sourceFeature: 'ai-research',
      }).catch(() => 0),
    ])

    return NextResponse.json({ ok: true, verification, kbSaved })
  } catch (error) {
    console.error('AI research verify error:', error)
    return NextResponse.json({ error: '数据核验失败，请稍后重试' }, { status: 500 })
  }
}
