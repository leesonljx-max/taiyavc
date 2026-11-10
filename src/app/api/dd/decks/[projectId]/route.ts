export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import { blockingGapsForProject } from '@/lib/dd-research/gap'
import { createDeck, enqueueDeck } from '@/lib/dd-deck/queue'
import { computeDeckFingerprint } from '@/lib/dd-research/fingerprint'

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
        version: true,
        templateVersion: true,
        inputFingerprint: true,
        researchRunId: true,
        slideCount: true,
        pptxUrl: true,
        generatedAt: true,
        error: true,
        createdAt: true,
      },
      take: 30,
    })
    const [briefFp, finalFp] = await Promise.all([
      computeDeckFingerprint(params.projectId, 'BRIEF'),
      computeDeckFingerprint(params.projectId, 'FINAL'),
    ])
    return NextResponse.json({
      decks,
      current: {
        BRIEF: briefFp.fingerprint,
        FINAL: finalFp.fingerprint,
      },
    })
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
    const body = await request.json().catch(() => ({})) as { type?: unknown; force?: unknown }
    const type = String(body.type || '').toUpperCase()
    if (type !== 'BRIEF' && type !== 'FINAL') {
      return NextResponse.json({ error: 'type 仅支持 BRIEF / FINAL' }, { status: 400 })
    }

    // 零补充资料也允许生成「公开信息版」报告，缺口只作为草稿提示，不再阻断
    const research = await prisma.dDResearchRun.findFirst({
      where: { projectId: params.projectId, status: { in: ['DONE', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const blocking = type === 'FINAL' ? await blockingGapsForProject(params.projectId) : []
    const warnings: string[] = []
    if (type === 'FINAL' && !research) warnings.push('尚未完成全网研究，本次报告为项目资料版草稿')
    if (blocking.length > 0) warnings.push(`存在 ${blocking.length} 项待补充资料，报告将以「公开信息版」生成`)

    const result = await createDeck(params.projectId, type, access.userId, {
      force: Boolean(body.force),
    })
    if (!result.existing) enqueueDeck(result.deckId)
    return NextResponse.json({
      ...result,
      warnings,
      gaps: blocking.map(g => ({ id: g.id, label: g.label, moduleKey: g.moduleKey })),
    })
  } catch (error) {
    console.error('[dd-deck] 创建报告失败:', error)
    return NextResponse.json({ error: '创建报告失败' }, { status: 500 })
  }
}
