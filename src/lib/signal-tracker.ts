/**
 * 自定义跟踪信号执行引擎
 *
 * 流程（单个信号一次执行）：
 * 1. 用信号的 1-3 组关键词各做一次搜索（collect 模式，topic=news，按频率控制时间窗口）
 * 2. 合并去重搜索结果
 * 3. DeepSeek 结合信号描述提取符合的事件（离职/创业/融资等），输出结构化
 * 4. 转成 ProjectLead 存储（source='AI'，带 signalId/signalName 标记）
 * 5. 更新信号的 lastRunAt / lastRunCount
 *
 * 调用量控制：每个信号每次执行 1-3 次搜索 + 1 次 DeepSeek 提取
 */

import prisma from '@/lib/prisma'
import { searchWebDual, type SearchResult } from '@/lib/tavily-search'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import type { TrackingSignal } from '@prisma/client'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/** 信号类型中文标签 */
export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  PERSONNEL_CHANGE: '人事变动',
  NEW_STARTUP: '大咖创业',
  TECH_BREAKTHROUGH: '技术突破',
  FUNDING: '融资动态',
  CUSTOM: '自定义',
}

/** 频率标签 */
export const FREQUENCY_LABELS: Record<string, string> = {
  DAILY: '每天',
  WEEKLY: '每周',
}

// ── 类型 ──

/** DeepSeek 提取出的信号事件 */
interface SignalLeadItem {
  eventName?: string     // 事件名（如"张三离开字节跳动创业"）
  person?: string        // 人物（如有）
  company?: string       // 相关公司（离职的原公司 / 新创公司）
  formerRole?: string    // 原职务
  newVenture?: string    // 新动向（新公司/新项目名）
  industry?: string      // 所属行业
  summary?: string       // 事件摘要（50字内）
  date?: string          // 事件日期 YYYY-MM-DD
  sourceIndex?: number   // 搜索结果索引
}

/** 单信号执行结果 */
export interface SignalRunResult {
  signalId: string
  signalName: string
  foundCount: number    // 搜索结果数
  savedCount: number    // 新存线索数
  skippedCount: number  // 已存在跳过数
  error?: string
}

// ── 主执行函数 ──

/** 解析信号 keywords（JSON 数组字符串） */
function parseKeywords(signal: TrackingSignal): string[] {
  try {
    const arr = JSON.parse(signal.keywords)
    if (Array.isArray(arr)) {
      const kws = arr.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()).slice(0, 3)
      if (kws.length > 0) return kws
    }
  } catch { /* 忽略 */ }
  // 兜底：keywords 存的不是合法 JSON 数组时，按整串当一组关键词
  return signal.keywords.trim() ? [signal.keywords.trim().slice(0, 80)] : []
}

/** 解析监控对象 */
function parseWatchTargets(signal: TrackingSignal): string[] {
  try {
    const arr = JSON.parse(signal.watchTargets || '[]')
    if (Array.isArray(arr)) {
      return arr.filter(t => typeof t === 'string' && t.trim()).slice(0, 10)
    }
  } catch { /* 忽略 */ }
  return []
}

/**
 * 执行单个信号跟踪
 * @param signal 信号记录
 * @param saveLeads 是否保存线索（cron/手动执行 = true）
 */
export async function runSignalTracking(signal: TrackingSignal): Promise<SignalRunResult> {
  const result: SignalRunResult = {
    signalId: signal.id,
    signalName: signal.name,
    foundCount: 0,
    savedCount: 0,
    skippedCount: 0,
  }

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) throw new Error('DeepSeek API Key 未配置')

    const keywords = parseKeywords(signal)
    if (keywords.length === 0) throw new Error('信号无有效搜索关键词')

    const watchTargets = parseWatchTargets(signal)
    // 时间窗口：每天跟踪看近 2 天；每周跟踪看近 8 天
    const days = signal.frequency === 'DAILY' ? 2 : 8

    // 1. 并发搜索（每组关键词一次，collect 模式）
    const searchArrays = await Promise.all(
      keywords.map(kw =>
        searchWebDual(kw, { maxResults: 5, topic: 'news', days, mode: 'collect', module: 'ai-leads' })
          .catch(() => [] as SearchResult[])
      )
    )
    // 按 URL 去重合并
    const seen = new Set<string>()
    const allResults = searchArrays.flat().filter(r => {
      if (!r.url || seen.has(r.url)) return false
      seen.add(r.url)
      return true
    })
    result.foundCount = allResults.length

    if (allResults.length === 0) {
      await updateSignalRun(signal.id, 0)
      return result
    }

    // 2. DeepSeek 提取符合信号的事件
    const typeLabel = SIGNAL_TYPE_LABELS[signal.signalType] || '自定义'
    const targetsHint = watchTargets.length > 0 ? `重点关注对象：${watchTargets.join('、')}` : ''
    const input = allResults
      .map((r, i) => `[${i}] ${r.title}\n来源: ${r.url}\n内容: ${r.content.substring(0, 600)}`)
      .join('\n\n')

    const systemPrompt = `你是一个投资信号监测助手，服务一家一级市场投资机构。用户设置了一个跟踪信号，请从搜索结果中筛选出符合该信号描述的事件。

信号信息：
- 信号名称：${signal.name}
- 信号类型：${typeLabel}
- 信号描述：${signal.description}
${targetsHint}

筛选要求：
1. 只保留与信号描述高度相关的事件（如：特定人群离职、特定方向创业、特定领域融资等）
2. 无关结果一律丢弃；没有符合的事件时返回空数组
3. 严格基于搜索结果，禁止编造；不编造姓名、公司、日期
4. 严格按 JSON 输出，不要任何其他文字

输出格式：
{
  "leads": [
    {
      "eventName": "事件一句话标题",
      "person": "人名（无人物则为空字符串）",
      "company": "相关公司名（原公司或新公司）",
      "formerRole": "原职务（无则为空）",
      "newVenture": "新动向（新公司名/新项目，无则为空）",
      "industry": "所属行业",
      "summary": "事件摘要（50字内）",
      "date": "YYYY-MM-DD",
      "sourceIndex": 0
    }
  ]
}`

    // 超时控制：90 秒
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90000)
    let data: { usage?: unknown; choices?: Array<{ message?: { content?: string } }> }
    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `搜索结果：\n\n${input}\n\n请筛选符合信号的事件并输出 JSON。` },
          ],
          temperature: 0.2,
          max_tokens: 3000,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`DeepSeek 提取失败: ${response.status} ${errText.substring(0, 150)}`)
      }
      data = await response.json()
    } finally {
      clearTimeout(timeoutId)
    }

    // token 记账（归属 AI 线索模块）
    recordTokenUsage('ai-leads', data.usage as Parameters<typeof recordTokenUsage>[1] | undefined)

    const parsed = parseAgentJson<{ leads?: SignalLeadItem[] }>(data.choices?.[0]?.message?.content || '')
    const leads = Array.isArray(parsed?.leads) ? parsed.leads : []

    // 3. 存储线索（同信号同 URL 去重）
    for (const lead of leads) {
      const idx = typeof lead.sourceIndex === 'number' ? lead.sourceIndex : 0
      const source = allResults[idx] || allResults[0]
      if (!source) continue

      // 名称：优先新公司/新动向，其次人物+公司，兜底事件名
      const leadName =
        (lead.newVenture && lead.newVenture.trim()) ||
        (lead.company && lead.company.trim()) ||
        (lead.person && lead.company ? `${lead.person.trim()}（${lead.company.trim()}）` : '') ||
        (lead.eventName || '').trim().slice(0, 60)
      if (!leadName) continue

      // 去重：同信号同来源 URL，或同名
      const exists = await prisma.projectLead.findFirst({
        where: {
          OR: [
            { signalId: signal.id, sourceUrl: source.url },
            { name: leadName, source: 'AI' },
          ],
        },
        select: { id: true },
      })
      if (exists) {
        result.skippedCount++
        continue
      }

      const summaryParts = [
        lead.formerRole ? `原${lead.formerRole.trim()}` : '',
        lead.eventName || '',
        lead.summary || '',
      ].filter(Boolean)

      await prisma.projectLead.create({
        data: {
          name: leadName.slice(0, 80),
          industry: (lead.industry || signal.industry || '').slice(0, 50) || null,
          description: summaryParts.join('；').slice(0, 500) || null,
          source: 'AI',
          sourceUrl: source.url,
          sourceTitle: source.title.slice(0, 200),
          aiSummary: (lead.summary || '').slice(0, 300) || null,
          signalId: signal.id,
          signalName: signal.name.slice(0, 80),
          createdById: signal.createdById,
          releasedAt: null, // 信号线索先归属创建者，两周未转化由既有释放逻辑自动释放
        },
      })
      result.savedCount++
    }

    await updateSignalRun(signal.id, result.savedCount)
    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[SignalTracker] 「${signal.name}」执行失败:`, msg)
    result.error = msg
    return result
  }
}

/** 更新信号执行状态 */
async function updateSignalRun(signalId: string, savedCount: number): Promise<void> {
  try {
    await prisma.trackingSignal.update({
      where: { id: signalId },
      data: { lastRunAt: new Date(), lastRunCount: savedCount },
    })
  } catch (e) {
    console.error('[SignalTracker] 更新信号执行状态失败:', e)
  }
}

// ── cron 入口 ──

/**
 * 定时执行到期信号：
 * - 每天跑：DAILY 信号（距上次执行 ≥ 20 小时）
 * - 每周一跑：WEEKLY 信号（距上次执行 ≥ 6 天）
 * @param dayOfWeek 当前星期（0=周日...6=周六），缺省取今天
 */
export async function runDueSignals(dayOfWeek = new Date().getDay()): Promise<SignalRunResult[]> {
  const now = new Date()
  const conditions: Array<{ frequency: string; minHours: number }> = [{ frequency: 'DAILY', minHours: 20 }]
  if (dayOfWeek === 1) conditions.push({ frequency: 'WEEKLY', minHours: 6 * 24 })

  const results: SignalRunResult[] = []
  for (const cond of conditions) {
    const signals = await prisma.trackingSignal.findMany({
      where: {
        isActive: true,
        frequency: cond.frequency,
        OR: [
          { lastRunAt: null },
          { lastRunAt: { lt: new Date(now.getTime() - cond.minHours * 3600 * 1000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })
    for (const signal of signals) {
      console.log(`[Cron tracking-signals] 执行信号「${signal.name}」（${cond.frequency}）`)
      results.push(await runSignalTracking(signal))
    }
  }
  return results
}
