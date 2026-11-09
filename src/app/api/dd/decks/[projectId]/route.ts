export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import { blockingGapsForProject } from '@/lib/dd-research/gap'
import { createDeck, enqueueDeck } from '@/lib/dd-deck/queue'

/**
 * GET /api/dd/decks/[projectId]
 * 报告列表
 */
export async function GET(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'view')
  if (!access.ok) return access.response

  try {
    const decks = await prisma.dDSlideDeck.findMany({
      where: { projectId: params.projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        slideCount: true,
        pptxUrl: true,
        generatedAt: true,
        error: true,
        createdAt: true,
      },
      take: 20,
    })
    return NextResponse.json({ decks })
  } catch (error) {
    console.error('[dd-deck] 查询报告列表失败:', error)
    return NextResponse.json({ error: '查询报告列表失败' }, { status: 500 })
  }
}

/**
 * POST /api/dd/decks/[projectId]
 * 生成资料简报（BRIEF）或尽调报告（FINAL）
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  const access = await requireProjectAccess(params.projectId, 'edit')
  if (!access.ok) return access.response

  try {
    const body = await request.json().catch(() => ({})) as { type?: unknown }
    const type = String(body.type || '').toUpperCase()
    if (type !== 'BRIEF' && type !== 'FINAL') {
      return NextResponse.json({ error: 'type 仅支持 BRIEF / FINAL' }, { status: 400 })
    }

    if (type === 'FINAL') {
      // 尽调报告必须建立在至少一轮完成的全网研究之上，避免无证据空报告
      const research = await prisma.dDResearchRun.findFirst({
        where: { projectId: params.projectId, status: { in: ['DONE', 'PARTIAL'] } },
        select: { id: true },
      })
      if (!research) {
        return NextResponse.json(
          { error: '请先完成一次「一键全网尽调」，再生成尽调报告' },
          { status: 400 }
        )
      }
      const blocking = await blockingGapsForProject(params.projectId)
      if (blocking.length > 0) {
        return NextResponse.json(
          {
            error: `还有 ${blocking.length} 项阻塞缺口未关闭，请补充资料或由合伙人豁免后再生成尽调报告`,
            gaps: blocking.map(g => ({ id: g.id, label: g.label, moduleKey: g.moduleKey })),
          },
          { status: 400 }
        )
      }
    }

    const result = await createDeck(params.projectId, type, access.userId)
    enqueueDeck(result.deckId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[dd-deck] 创建报告失败:', error)
    return NextResponse.json({ error: '创建报告失败' }, { status: 500 })
  }
}
