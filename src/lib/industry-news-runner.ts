/**
 * 行业动态 Runner（Tavily 调用次数优化版）
 *
 * 统计分析页「行业动态」：针对项目数量排名前十的行业，收集当日动态。
 *
 * V1.5.1 优化（原版每次跑 30-50 次 Tavily + 10 次 DeepSeek）：
 * - 搜索阶段：每行业固定 1 次精准搜索（「{行业} 融资/产品发布/人事变动」），
 *   不再由子 Agent 自主决定搜索次数（原 maxTurns 内一轮可并行多次调用）
 * - 提取阶段：全部行业的搜索结果分组（每 5 个行业一组）批量喂给 DeepSeek，
 *   一次调用输出该组所有行业的 events（10 次调用 → 2 次）
 * - 优化后：10 次 Tavily + 2 次 DeepSeek（约降低 70-80%），且同日重复查询走缓存
 * - 点击气泡的即时分析保留单行业模式（1 次搜索 + 1 次提取）
 * - 引用交叉验证保留：只保留真实搜索来源 URL
 */

import prisma from '@/lib/prisma'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { searchWebDual, type SearchResult } from '@/lib/tavily-search'
import { recordTokenUsage } from '@/lib/token-accounting'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/** 前十行业数量上限 */
export const TOP_N = 10
/** 批量提取：每组行业数（控制单次 DeepSeek 输入规模） */
const BATCH_SIZE = 5

/** 正在运行的任务（进程内防重入）：行业名集合 */
const runningIndustries = new Set<string>()

// ── 类型 ──

export interface IndustryEvent {
  type: string       // 事件类型：融资 / 产品发布 / 技术突破 / 人员变更 / 合作 / 其他
  company: string    // 相关公司/机构
  title: string      // 事件标题（一句话）
  detail: string     // 事件详情（1-3句）
  date: string       // 事件日期（YYYY-MM-DD）
}

export interface IndustryNewsCard {
  industry: string
  events: IndustryEvent[]
  /** 事件引用来源（已交叉验证） */
  citations: Array<{ label: string; url: string }>
  analyzedAt: string
  /** 空事件原因（如当日无重要动态） */
  note?: string
}

export interface IndustryNewsResult {
  date: string
  cards: IndustryNewsCard[]
}

/** 批量提取输出（DeepSeek JSON） */
interface BatchOutput {
  industries: Array<{
    industry?: string
    events?: Array<{ type?: string; company?: string; title?: string; detail?: string; date?: string }>
    citations?: Array<{ label?: string; url?: string }>
    note?: string
  }>
}

/** 日期键：本地时区 YYYY-MM-DD */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 缓存键 */
function cacheKeyFor(date: string): string {
  return `industry-news:${date}`
}

// ── 前十行业计算（不按用户权限过滤，与 cron 场景一致） ──

export async function getTopIndustries(limit = TOP_N): Promise<string[]> {
  const currentYear = new Date().getFullYear()
  const allProjects = await prisma.project.findMany({
    select: { targetDate: true, industry: true },
  })
  const yearFiltered = allProjects.filter(
    p => p.targetDate && new Date(p.targetDate).getFullYear() === currentYear
  )
  const countBy = new Map<string, number>()
  yearFiltered.forEach(p => {
    const ind = p.industry?.trim()
    if (ind) countBy.set(ind, (countBy.get(ind) || 0) + 1)
  })
  return Array.from(countBy.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ind]) => ind)
}

// ── 阶段 1：搜索（每行业固定 1 次） ──

/** 单行业固定关键词搜索（news 主题 + 近 3 天，走 collect 模式省 credit） */
async function searchIndustry(industry: string): Promise<SearchResult[]> {
  try {
    return await searchWebDual(`${industry} 融资 产品发布 人事变动 最新动态`, {
      maxResults: 5,
      topic: 'news',
      days: 3,
      mode: 'collect',
      module: 'industry-news',
    })
  } catch (err) {
    console.error(`[IndustryNews] 「${industry}」搜索失败:`, err instanceof Error ? err.message : err)
    return []
  }
}

// ── 阶段 2：批量提取（每组行业一次 DeepSeek 调用） ──

/** 引用过滤（仅保留真实搜索返回的 URL） */
function filterUrls(
  citations: Array<{ label?: string; url?: string }> | undefined,
  searchedUrls: string[]
): Array<{ label: string; url: string }> {
  if (!Array.isArray(citations)) return []
  const urlSet = new Set(searchedUrls)
  const seen = new Set<string>()
  const out: Array<{ label: string; url: string }> = []
  for (const c of citations) {
    const url = typeof c?.url === 'string' ? c.url.trim() : ''
    if (!url || !/^https?:\/\//.test(url) || !urlSet.has(url) || seen.has(url)) continue
    seen.add(url)
    out.push({ label: (typeof c.label === 'string' && c.label.trim() ? c.label.trim() : url).slice(0, 80), url })
  }
  return out.slice(0, 8)
}

/** 事件日期有效性：格式合法且落在合理窗口（过去 90 天 ~ 未来 7 天）内 */
function isValidEventDate(d: unknown, todayMs: number): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const t = new Date(`${d}T00:00:00`).getTime()
  if (Number.isNaN(t)) return false
  return t >= todayMs - 90 * 86_400_000 && t <= todayMs + 7 * 86_400_000
}

/** 事件规范化与校验 */
function normalizeEvents(raw: Array<{ type?: string; company?: string; title?: string; detail?: string; date?: string }>, today: string): IndustryEvent[] {
  if (!Array.isArray(raw)) return []
  const todayMs = new Date(`${today}T00:00:00`).getTime()
  const out: IndustryEvent[] = []
  for (const e of raw) {
    const title = typeof e?.title === 'string' ? e.title.trim() : ''
    const company = typeof e?.company === 'string' ? e.company.trim() : ''
    if (!title || !company) continue
    out.push({
      type: (typeof e.type === 'string' && e.type.trim() ? e.type.trim() : '其他').slice(0, 12),
      company: company.slice(0, 50),
      title: title.slice(0, 100),
      detail: (typeof e.detail === 'string' ? e.detail.trim() : '').slice(0, 300),
      date: isValidEventDate(e.date, todayMs) ? e.date : today,
    })
    if (out.length >= 5) break // 上限 5 件
  }
  return out
}

/** 构建某行业的搜索结果文本块 */
function buildIndustryBlock(industry: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `【${industry}】\n（搜索未返回结果）`
  }
  const lines = results
    .map((r, i) => `[${i + 1}] ${r.title}\n来源: ${r.url}\n内容: ${r.content.substring(0, 400)}`)
    .join('\n')
  return `【${industry}】\n${lines}`
}

/**
 * 一组行业批量提取：一次 DeepSeek 调用输出该组所有行业的动态卡片
 * @param group 行业名列表（≤ BATCH_SIZE 个）
 * @param searchByIndustry 各行业搜索结果
 */
async function analyzeIndustryBatch(
  group: string[],
  searchByIndustry: Map<string, SearchResult[]>
): Promise<IndustryNewsCard[]> {
  const today = todayKey()
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return group.map(industry => ({
      industry,
      events: [],
      citations: [],
      analyzedAt: new Date().toISOString(),
      note: 'DeepSeek API Key 未配置',
    }))
  }

  const allUrls = group.flatMap(ind => (searchByIndustry.get(ind) || []).map(r => r.url))
  const blocks = group.map(ind => buildIndustryBlock(ind, searchByIndustry.get(ind) || [])).join('\n\n')

  const systemPrompt = `你是多个行业的动态监测分析助手，服务一家一级市场投资机构。
下面是${group.length}个行业各自的搜索结果。请按行业整理近期（${today} 当日优先，最迟 3 天内）发生的重要动态，每个行业 0-5 件事。

关注的事件类型（按优先级）：竞品融资（轮次/金额/投资方）、产品发布/商业化进展、技术突破、核心人员变更、重要合作/监管政策。

要求：
1. 仅基于真实搜索结果整理，禁止编造；citations 的 URL 必须来自搜索结果的来源
2. 某行业搜索结果与该行业无关或当日确无动态时，events 为空数组并在 note 说明
3. 严格按以下 JSON 格式输出，不要任何其他文字：
{
  "industries": [
    {
      "industry": "行业名（与输入一致）",
      "events": [{ "type": "融资", "company": "公司名", "title": "一句话标题", "detail": "1-3句详情", "date": "${today}" }],
      "citations": [{ "label": "来源标题", "url": "https://..." }],
      "note": "仅当无事件时填写原因"
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
          { role: 'user', content: `各行业搜索结果如下：\n\n${blocks}\n\n请按行业输出 JSON。` },
        ],
        temperature: 0.4,
        max_tokens: 4000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek API 调用失败: ${response.status} ${errText.substring(0, 150)}`)
    }
    data = await response.json()
  } finally {
    clearTimeout(timeoutId)
  }

  // token 记账（归属行业动态模块）
  recordTokenUsage('industry-news', data.usage as Parameters<typeof recordTokenUsage>[1] | undefined)

  const parsed = parseAgentJson<BatchOutput>(data.choices?.[0]?.message?.content || '')

  // 按行业名归位（DeepSeek 输出顺序可能与输入不同）
  const byName = new Map<string, NonNullable<BatchOutput['industries']>[number]>()
  if (Array.isArray(parsed?.industries)) {
    for (const item of parsed.industries) {
      if (typeof item?.industry === 'string' && item.industry.trim()) {
        byName.set(item.industry.trim(), item)
      }
    }
  }

  return group.map(industry => {
    const item = byName.get(industry)
    const card: IndustryNewsCard = {
      industry,
      events: item ? normalizeEvents(item.events || [], today) : [],
      citations: item ? filterUrls(item.citations, allUrls) : [],
      analyzedAt: new Date().toISOString(),
    }
    if (card.events.length === 0) {
      const rawNote = item?.note?.trim() || ''
      card.note =
        rawNote.length <= 200
          ? rawNote || '今日暂未检索到重要动态'
          : rawNote.slice(0, 200).replace(/[，。；！？、].*$/, m => (/[。！？]/.test(m) ? m : m[0] + '…'))
    }
    return card
  })
}

// ── 缓存读写 ──

async function readCache(date: string): Promise<IndustryNewsResult | null> {
  const cached = await prisma.aICache.findUnique({ where: { cacheKey: cacheKeyFor(date) } })
  if (!cached) return null
  try {
    const data = JSON.parse(cached.data) as IndustryNewsResult
    return Array.isArray(data?.cards) ? data : null
  } catch {
    return null
  }
}

async function writeCache(result: IndustryNewsResult): Promise<void> {
  const data = JSON.stringify(result)
  await prisma.aICache.upsert({
    where: { cacheKey: cacheKeyFor(result.date) },
    create: { cacheKey: cacheKeyFor(result.date), data },
    update: { data },
  })
}

/** 合并缓存（保留已分析行业，追加新卡片） */
function mergeCards(existing: IndustryNewsCard[], fresh: IndustryNewsCard[]): IndustryNewsCard[] {
  const byIndustry = new Map(existing.map(c => [c.industry, c]))
  for (const c of fresh) byIndustry.set(c.industry, c)
  return Array.from(byIndustry.values())
}

// ── 主入口 ──

export interface RunIndustryNewsOptions {
  /** 强制重新分析（即使缓存已有该行业） */
  force?: boolean
  /** 指定行业（点击气泡即时分析）；缺省为前十行业 */
  industries?: string[]
}

export interface RunIndustryNewsOutcome {
  date: string
  /** 本次新分析的行业 */
  analyzed: string[]
  cards: IndustryNewsCard[]
}

export async function runIndustryNews(
  opts: RunIndustryNewsOptions = {}
): Promise<RunIndustryNewsOutcome> {
  const date = todayKey()

  // 确定行业列表
  let industries = opts.industries
  if (!industries || industries.length === 0) {
    industries = await getTopIndustries(TOP_N)
  }
  if (industries.length === 0) {
    return { date, analyzed: [], cards: (await readCache(date))?.cards || [] }
  }

  // 读取现有缓存
  const existing = (await readCache(date))?.cards || []
  const existingByIndustry = new Map(existing.map(c => [c.industry, c]))

  // 待分析：强制/指定行业，或缓存中缺失的
  const pending: string[] = []
  for (const ind of industries) {
    if (opts.force || opts.industries || !existingByIndustry.has(ind)) {
      if (!runningIndustries.has(ind)) pending.push(ind)
    }
  }

  if (pending.length === 0) {
    return { date, analyzed: [], cards: existing }
  }

  pending.forEach(ind => runningIndustries.add(ind))
  try {
    // 阶段 1：每行业一次精准搜索（并发，有同日缓存时直接命中）
    const searchResults = await Promise.all(pending.map(ind => searchIndustry(ind)))
    const searchByIndustry = new Map<string, SearchResult[]>()
    pending.forEach((ind, i) => searchByIndustry.set(ind, searchResults[i]))

    // 阶段 2：分组批量提取（每 BATCH_SIZE 个行业一次 DeepSeek 调用）
    const groups: string[][] = []
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      groups.push(pending.slice(i, i + BATCH_SIZE))
    }
    const freshCards = (await Promise.all(groups.map(g => analyzeIndustryBatch(g, searchByIndustry)))).flat()

    // 合并写回缓存
    const cards = mergeCards(existing, freshCards)
    await writeCache({ date, cards })
    return { date, analyzed: pending, cards }
  } catch (e) {
    console.error('[IndustryNews] 批量分析失败:', e instanceof Error ? e.message : e)
    // 失败行业返回占位卡片（保持前端结构完整）
    const failCards: IndustryNewsCard[] = pending.map(ind => ({
      industry: ind,
      events: [],
      citations: [],
      analyzedAt: new Date().toISOString(),
      note: '分析失败，请稍后重试',
    }))
    const cards = mergeCards(existing, failCards)
    return { date, analyzed: [], cards }
  } finally {
    pending.forEach(ind => runningIndustries.delete(ind))
  }
}

/** 查询当日行业动态（API GET 用）：返回缓存 + running 标记 */
export async function getIndustryNews(date = todayKey()) {
  const cached = await readCache(date)
  return {
    date,
    cards: cached?.cards || [],
    running: Array.from(runningIndustries),
  }
}

/** cron 入口：每日 04:00 收集前十行业动态 */
export async function runDailyIndustryNews() {
  const top = await getTopIndustries(TOP_N)
  console.log(`[Cron industry-news] 前十行业: ${top.join('、') || '（无项目行业数据）'}`)
  const result = await runIndustryNews({ industries: top, force: false })
  const withEvents = result.cards.filter(c => c.events.length > 0).length
  console.log(
    `[Cron industry-news] 完成: 分析 ${result.analyzed.length} 个行业，` +
      `${withEvents} 个行业有动态，共 ${result.cards.reduce((n, c) => n + c.events.length, 0)} 件事`
  )
  return {
    date: result.date,
    topIndustries: top,
    analyzed: result.analyzed.length,
    cards: result.cards.length,
    withEvents,
  }
}
