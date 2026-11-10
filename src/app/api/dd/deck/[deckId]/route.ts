export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'

/**
 * GET /api/dd/deck/[deckId]
 * 报告详情：SlideSpec + 页面内容
 */
export async function GET(
  _request: Request,
  { params }: { params: { deckId: string } }
) {
  try {
    const deck = await prisma.dDSlideDeck.findUnique({
      where: { id: params.deckId },
      include: {
        project: { select: { name: true } },
        slides: { orderBy: { slideNo: 'asc' } },
      },
    })
    if (!deck) return NextResponse.json({ error: '报告不存在' }, { status: 404 })

    const access = await requireProjectAccess(deck.projectId, 'view')
    if (!access.ok) return access.response

    let spec: unknown = null
    if (deck.specJson) {
      try {
        spec = JSON.parse(deck.specJson)
      } catch {
        spec = null
      }
    }

    return NextResponse.json({
      deck: {
        id: deck.id,
        projectId: deck.projectId,
        projectName: deck.project.name,
        type: deck.type,
        status: deck.status,
        version: deck.version,
        templateVersion: deck.templateVersion,
        slideCount: deck.slideCount,
        pptxUrl: deck.pptxUrl,
        generatedAt: deck.generatedAt,
        error: deck.error,
        createdAt: deck.createdAt,
      },
      spec,
      slides: deck.slides.map(s => {
        let content: unknown = null
        try {
          content = JSON.parse(s.contentJson)
        } catch {
          content = null
        }
        return {
          id: s.id,
          slideNo: s.slideNo,
          layout: s.layout,
          title: s.title,
          content,
          notes: s.notes,
        }
      }),
    })
  } catch (error) {
    console.error('[dd-deck] 查询报告详情失败:', error)
    return NextResponse.json({ error: '查询报告详情失败' }, { status: 500 })
  }
}
