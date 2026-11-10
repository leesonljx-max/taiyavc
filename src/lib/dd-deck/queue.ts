/**
 * 尽调报告生成队列
 *
 * 生成 SlideSpec → 质检 → 渲染 PPTX；spec 先写库，PPTX 失败可单独重试。
 */

import prisma from '@/lib/prisma'
import { buildDeckContext } from './context'
import { assembleBriefSpec, assembleFinalSpec, generateNarratives } from './writer'
import { critiqueDeck } from './critic'
import { coerceDeckSpec } from './spec'
import { renderDeckPptx } from './render-pptx'
import { DD_DECK_VERSION } from '@/lib/dd-research/constants'
import { computeDeckFingerprint } from '@/lib/dd-research/fingerprint'

const CONCURRENCY = 1
const POLL_MS = 20_000
const STALE_MS = 20 * 60_000

const waiting: string[] = []
const queued = new Set<string>()
let active = 0
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let recovering: Promise<void> | null = null

export async function createDeck(
  projectId: string,
  type: 'BRIEF' | 'FINAL',
  userId: string,
  options?: { force?: boolean }
): Promise<{ deckId: string; existing: boolean; version: number }> {
  const activeDeck = await prisma.dDSlideDeck.findFirst({
    where: { projectId, type, status: { in: ['QUEUED', 'GENERATING'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (activeDeck) return { deckId: activeDeck.id, existing: true, version: activeDeck.version }

  const { fingerprint, researchRunId } = await computeDeckFingerprint(projectId, type)

  // 资料与研究未变化时直接复用最新已生成版本，避免每次点击都重跑
  if (!options?.force) {
    const reusable = await prisma.dDSlideDeck.findFirst({
      where: {
        projectId,
        type,
        status: 'READY',
        inputFingerprint: fingerprint,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (reusable) return { deckId: reusable.id, existing: true, version: reusable.version }
  }

  const version = await prisma.dDSlideDeck.count({ where: { projectId, type } }) + 1
  const deck = await prisma.dDSlideDeck.create({
    data: {
      projectId,
      type,
      status: 'QUEUED',
      templateVersion: DD_DECK_VERSION,
      version,
      inputFingerprint: fingerprint,
      researchRunId,
      theme: 'navy-gold',
      generatedBy: userId,
    },
  })
  return { deckId: deck.id, existing: false, version }
}

export function enqueueDeck(deckId: string): void {
  if (!deckId || queued.has(deckId)) return
  queued.add(deckId)
  waiting.push(deckId)
  ensureStarted()
}

function ensureStarted(): void {
  if (started) return
  started = true
  void (async () => {
    await recoverStale()
    pump()
  })()
  timer = setInterval(() => {
    void pump()
  }, POLL_MS)
  timer.unref?.()
}

async function recoverStale(): Promise<void> {
  if (recovering) return recovering
  recovering = (async () => {
    try {
      await prisma.dDSlideDeck.updateMany({
        where: { status: 'GENERATING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        data: { status: 'QUEUED', error: '生成超时，已重新排队' },
      })
      const rows = await prisma.dDSlideDeck.findMany({
        where: { status: 'QUEUED', updatedAt: { lt: new Date(Date.now() - 5_000) } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      })
      for (const row of rows) enqueueDeck(row.id)
    } catch (error) {
      console.error('[dd-deck] 恢复报告队列失败:', error)
    } finally {
      recovering = null
    }
  })()
  return recovering
}

export async function generateDeck(deckId: string): Promise<void> {
  const deck = await prisma.dDSlideDeck.findUnique({ where: { id: deckId } })
  if (!deck) throw new Error('报告不存在')
  if (deck.status !== 'QUEUED' && deck.status !== 'GENERATING') return

  try {
    await prisma.dDSlideDeck.update({
      where: { id: deckId },
      data: { status: 'GENERATING', error: null },
    })

    const context = await buildDeckContext(deck.projectId)
    const narratives = await generateNarratives(context, deck.type as 'BRIEF' | 'FINAL')
    const rawSpec = deck.type === 'BRIEF'
      ? assembleBriefSpec(context, narratives)
      : assembleFinalSpec(context, narratives)

    const critique = critiqueDeck(rawSpec, context)
    const finalSpec = critique.ok ? critique.spec : coerceDeckSpec(critique.spec)

    if (!critique.ok) {
      const recheck = critiqueDeck(finalSpec, context)
      if (!recheck.ok) {
        throw new Error(`报告版式校验未通过：${recheck.issues.slice(0, 4).join('；')}`)
      }
    }

    await prisma.dDSlide.deleteMany({ where: { deckId } })
    await prisma.dDSlide.createMany({
      data: finalSpec.slides.map(s => ({
        deckId,
        slideNo: s.slideNo,
        layout: s.layout,
        title: s.title,
        contentJson: JSON.stringify(s),
        notes: s.callout || null,
      })),
    })

    await prisma.dDSlideDeck.update({
      where: { id: deckId },
      data: {
        status: 'READY',
        specJson: JSON.stringify(finalSpec),
        slideCount: finalSpec.slides.length,
        generatedAt: new Date(),
        error: null,
      },
    })

    // PPTX 失败不影响在线查看；保留 spec 供重试
    try {
      await renderDeckPptx(deckId)
    } catch (error) {
      console.error('[dd-deck] PPTX 渲染失败:', error)
      await prisma.dDSlideDeck.update({
        where: { id: deckId },
        data: {
          error: `PPTX 渲染失败：${error instanceof Error ? error.message.slice(0, 200) : '未知错误'}`,
        },
      }).catch(() => undefined)
    }
  } catch (error) {
    console.error(`[dd-deck] 生成失败 ${deckId}:`, error)
    await prisma.dDSlideDeck.update({
      where: { id: deckId },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message.slice(0, 800) : '生成失败',
      },
    }).catch(() => undefined)
  }
}

function pump(): void {
  while (active < CONCURRENCY && waiting.length > 0) {
    const deckId = waiting.shift() as string
    active += 1
    void generateDeck(deckId)
      .catch(error => {
        console.error(`[dd-deck] 队列异常 ${deckId}:`, error)
      })
      .finally(() => {
        active -= 1
        queued.delete(deckId)
        pump()
      })
  }
}
