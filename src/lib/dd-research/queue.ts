/**
 * 尽调研究进程内队列
 *
 * 单进程、单并发，避免一个项目占用多个搜索/模型配额；
 * 进程重启后从数据库恢复 QUEUED，超时 RUNNING 重新排队。
 */

import prisma from '@/lib/prisma'
import { runResearch } from './orchestrator'
import { createDeck, enqueueDeck } from '@/lib/dd-deck/queue'

const CONCURRENCY = 1
const POLL_MS = 30_000
const STALE_MS = 20 * 60_000

const waiting: string[] = []
const queued = new Set<string>()
let active = 0
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let recovering: Promise<void> | null = null

export function enqueueResearch(runId: string): void {
  if (!runId || queued.has(runId)) return
  queued.add(runId)
  waiting.push(runId)
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
      await prisma.dDResearchRun.updateMany({
        where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        data: { status: 'QUEUED', error: '研究超时，已重新排队' },
      })
      const rows = await prisma.dDResearchRun.findMany({
        where: { status: 'QUEUED', updatedAt: { lt: new Date(Date.now() - 5_000) } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      })
      for (const row of rows) enqueueResearch(row.id)
    } catch (error) {
      console.error('[dd-research] 恢复队列失败:', error)
    } finally {
      recovering = null
    }
  })()
  return recovering
}

/** 一键尽调：检索完成后自动生成资料简报与尽调报告（已有同版本则复用） */
async function triggerAutoDeck(runId: string): Promise<void> {
  const run = await prisma.dDResearchRun.findUnique({
    where: { id: runId },
    select: { projectId: true, status: true, scopeJson: true },
  })
  if (!run || (run.status !== 'DONE' && run.status !== 'PARTIAL')) return

  let autoDeck = false
  try {
    const scope = run.scopeJson ? JSON.parse(run.scopeJson) as { autoDeck?: unknown } : {}
    autoDeck = scope.autoDeck === true
  } catch {
    autoDeck = false
  }
  if (!autoDeck) return

  for (const type of ['BRIEF', 'FINAL'] as const) {
    try {
      const { deckId, existing } = await createDeck(run.projectId, type, 'system:auto')
      if (!existing) enqueueDeck(deckId)
    } catch (error) {
      console.error(`[dd-research] 自动生成 ${type} 报告失败:`, error)
    }
  }
}

function pump(): void {
  while (active < CONCURRENCY && waiting.length > 0) {
    const runId = waiting.shift() as string
    active += 1
    void runResearch(runId)
      .then(() => triggerAutoDeck(runId))
      .catch(error => {
        console.error(`[dd-research] 队列任务异常 ${runId}:`, error)
      })
      .finally(() => {
        active -= 1
        queued.delete(runId)
        pump()
      })
  }
}

/** 供健康检查/手动恢复使用 */
export async function recoverResearchQueue(): Promise<void> {
  await recoverStale()
}
