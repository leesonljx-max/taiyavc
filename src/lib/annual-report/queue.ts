/**
 * 年度报告进程内队列
 *
 * 与投后 OCR 队列同一模式：单进程、低并发，进程重启后从数据库恢复。
 * 年报只在年初低频生成，无需引入 Redis / pg-boss。
 */

import prisma from '@/lib/prisma'
import { generateAnnualReport } from './generate'

const CONCURRENCY = 1
const POLL_MS = 30_000
const STALE_MS = 15 * 60_000

const waiting: string[] = []
const queued = new Set<string>()
let active = 0
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let recovering: Promise<void> | null = null

export function enqueueAnnualReport(reportId: string): void {
  if (!reportId || queued.has(reportId)) return
  queued.add(reportId)
  waiting.push(reportId)
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
      await prisma.annualReport.updateMany({
        where: { status: 'GENERATING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        data: { status: 'QUEUED', phase: null, progress: 0, error: '生成超时，已重新排队' },
      })
      const rows = await prisma.annualReport.findMany({
        where: { status: 'QUEUED', updatedAt: { lt: new Date(Date.now() - 5_000) } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      })
      for (const row of rows) enqueueAnnualReport(row.id)
    } catch (error) {
      console.error('[annual-report] 恢复队列失败:', error)
    } finally {
      recovering = null
    }
  })()
  return recovering
}

function pump(): void {
  while (active < CONCURRENCY && waiting.length > 0) {
    const reportId = waiting.shift() as string
    active += 1
    void generateAnnualReport(reportId)
      .catch(error => {
        console.error(`[annual-report] 队列任务异常 ${reportId}:`, error)
      })
      .finally(() => {
        active -= 1
        queued.delete(reportId)
        pump()
      })
  }
}
