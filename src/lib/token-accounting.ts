/**
 * Token 用量记账（AI 看板数据源）
 *
 * 每次调用 DeepSeek API 后，将 usage（input/output tokens）记入内存缓冲，
 * 异步批量落库到 AICache 表（cacheKey: token-usage:YYYY-MM-DD），失败不影响业务。
 *
 * 看板按天聚合展示各模块 token 消耗。
 */

import prisma from '@/lib/prisma'

/** 允许记账的模块标识（与 SearchModule 对齐 + 框架生成等场景） */
export type TokenModule =
  | 'ai-card'
  | 'competitors'
  | 'ai-leads'
  | 'industry-news'
  | 'news'
  | 'research'
  | 'dd-harness'
  | 'search-lib'
  | 'other'

export interface TokenUsageRecord {
  module: string
  inputTokens: number
  outputTokens: number
}

/** DeepSeek API 返回的 usage 结构（chat/completions 与 responses 通用子集） */
export interface ApiUsage {
  input_tokens?: number
  output_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
}

// ── 内存缓冲（批量落库，减少 DB 压力） ──

const buffer: TokenUsageRecord[] = []
const MAX_BUFFER = 50
const FLUSH_INTERVAL_MS = 30_000

let flushTimer: ReturnType<typeof setInterval> | null = null

/** 本地时区日期键 YYYY-MM-DD */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 缓存键 */
export function tokenCacheKeyFor(date: string): string {
  return `token-usage:${date}`
}

/**
 * 归一化 usage：兼容 chat（prompt_tokens/completion_tokens）
 * 与 responses（input_tokens/output_tokens）两种格式
 */
export function normalizeUsage(usage: ApiUsage | undefined | null): { inputTokens: number; outputTokens: number } {
  if (!usage || typeof usage !== 'object') return { inputTokens: 0, outputTokens: 0 }
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0
  return { inputTokens, outputTokens }
}

/**
 * 记录一次 DeepSeek 调用的 token 用量（异步落库，不阻塞业务）
 * - 合并写入当日 AICache（cacheKey: token-usage:YYYY-MM-DD）
 * - 结构：{ [module]: { inputTokens, outputTokens, calls } }
 */
export function recordTokenUsage(
  module: string,
  usage: ApiUsage | undefined | null
): void {
  const { inputTokens, outputTokens } = normalizeUsage(usage)
  if (inputTokens === 0 && outputTokens === 0) return

  buffer.push({ module, inputTokens, outputTokens })
  ensureFlushTimer()

  if (buffer.length >= MAX_BUFFER) {
    void flushTokenUsage()
  }
}

/** 立即落库（测试用） */
export async function flushTokenUsage(): Promise<void> {
  if (buffer.length === 0) return
  const records = buffer.splice(0, buffer.length)
  try {
    // 按天+模块聚合
    const byKey = new Map<string, TokenUsageRecord>()
    for (const r of records) {
      const key = `${todayKey()}:${r.module}`
      const existing = byKey.get(key) || { module: r.module, inputTokens: 0, outputTokens: 0 }
      existing.inputTokens += r.inputTokens
      existing.outputTokens += r.outputTokens
      byKey.set(key, existing)
    }

    // 合并到当日总量
    const cacheKey = tokenCacheKeyFor(todayKey())
    const existing = await prisma.aICache.findUnique({ where: { cacheKey } })
    let dayData: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {}
    if (existing) {
      try {
        dayData = JSON.parse(existing.data) || {}
      } catch {
        dayData = {}
      }
    }

    for (const [, r] of byKey) {
      const m = dayData[r.module] || { inputTokens: 0, outputTokens: 0, calls: 0 }
      m.inputTokens += r.inputTokens
      m.outputTokens += r.outputTokens
      m.calls += 1
      dayData[r.module] = m
    }

    await prisma.aICache.upsert({
      where: { cacheKey },
      create: { cacheKey, data: JSON.stringify(dayData) },
      update: { data: JSON.stringify(dayData) },
    })
  } catch (error) {
    // 记账失败不影响业务
    console.warn('[TokenAccounting] 落库失败:', error instanceof Error ? error.message : error)
  }
}

function ensureFlushTimer(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => {
    void flushTokenUsage()
  }, FLUSH_INTERVAL_MS)
  // 不阻止进程退出
  if (typeof flushTimer.unref === 'function') flushTimer.unref()
}

/**
 * 查询一段日期范围内的 token 消耗（AI 看板 API 用）
 *
 * @returns days: [{ date, modules: { [module]: {...} }, totalInput, totalOutput }]
 */
export async function getTokenUsageByDateRange(
  startDate: string,
  endDate: string
): Promise<Array<{
  date: string
  modules: Record<string, { inputTokens: number; outputTokens: number; calls: number }>
  totalInput: number
  totalOutput: number
}>> {
  const keys: string[] = []
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    keys.push(tokenCacheKeyFor(todayKey(d)))
  }

  const cached = await prisma.aICache.findMany({
    where: { cacheKey: { in: keys } },
  })

  const byKey = new Map(cached.map(c => [c.cacheKey, c]))
  const days: Array<{
    date: string
    modules: Record<string, { inputTokens: number; outputTokens: number; calls: number }>
    totalInput: number
    totalOutput: number
  }> = []

  for (const key of keys) {
    const date = key.replace('token-usage:', '')
    let modules: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {}
    const item = byKey.get(key)
    if (item) {
      try {
        modules = JSON.parse(item.data) || {}
      } catch {
        modules = {}
      }
    }
    let totalInput = 0
    let totalOutput = 0
    for (const m of Object.values(modules)) {
      totalInput += m.inputTokens || 0
      totalOutput += m.outputTokens || 0
    }
    days.push({ date, modules, totalInput, totalOutput })
  }

  return days
}
