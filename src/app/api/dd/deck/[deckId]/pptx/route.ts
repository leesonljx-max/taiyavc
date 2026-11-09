export const dynamic = 'force-dynamic'

import { readFile } from 'fs/promises'
import { join } from 'path'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import { renderDeckPptx } from '@/lib/dd-deck/render-pptx'

/**
 * GET /api/dd/deck/[deckId]/pptx
 * 下载原生可编辑 PPTX；缺失时按已保存的 SlideSpec 重新渲染
 */
export async function GET(
  _request: Request,
  { params }: { params: { deckId: string } }
) {
  try {
    const deck = await prisma.dDSlideDeck.findUnique({ where: { id: params.deckId } })
    if (!deck) return NextResponse.json({ error: '报告不存在' }, { status: 404 })

    const access = await requireProjectAccess(deck.projectId, 'view')
    if (!access.ok) return access.response

    if (deck.status !== 'READY') {
      return NextResponse.json({ error: '报告尚未生成完成' }, { status: 400 })
    }

    let url = deck.pptxUrl
    if (!url) {
      url = await renderDeckPptx(params.deckId, true)
    }

    const fileName = url.split('/').pop() || `${params.deckId}.pptx`
    const buffer = await readFile(join(process.cwd(), 'public', 'dd-decks', fileName))

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${deck.type === 'BRIEF' ? '资料简报' : '尽调报告'}-${fileName}`)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[dd-deck] 下载 PPTX 失败:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '下载 PPTX 失败' },
      { status: 500 }
    )
  }
}
