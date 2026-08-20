/**
 * 行业动态 Harness Runner
 *
 * 统计分析页「行业动态」：针对项目数量排名前十的行业，
 * 每个行业一个子Agent（联网检索当日动态 → DeepSeek 提炼 3-5 件事件）
 *
 * - 每日 04:00 cron 自动收集（cacheKey = industry-news:YYYY-MM-DD）
 * - 点击气泡时可即时分析任意行业（POST 强制刷新）
 * - 事件类型：竞品融资 / 产品发布 / 技术突破 / 核心人员变更 等
 * - 引用交叉验证：只保留真实搜索来源 URL（复用 dd-harness 会话日志机制）
 */

import prisma from '@/lib/prisma'
import { runAgent, parseAgentJson } from '@/lib/dd-harness/agent'
import { ddTools } from '@/lib/dd-harness/tools'

/** 前十行业数量上限 */
export const TOP_N = 10
/** 子Agent 并行度（避免 API 限流） */
const CONCURRENCY = 2

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

/** 单行业输出（子Agent JSON） */
interface AgentOutput {
  events: Array<{
    type?: string
    company?: string
    title?: string
    detail?: string
    date?: string
  }>
  citations?: Array<{ label?: string; url?: string }>
  note?: string
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

// ── 单行业子Agent ──

const SYSTEM_PROMPT = (industry: string, today: string) => `你是「${industry}」行业的动态监测子Agent，服务一家一级市场投资机构。

任务：检索并整理「${industry}」行业今天（${today}，如当日无则以最近 3 天内为准）发生的重要动态，3-5 件事。

关注的事件类型（按优先级）：
1. 竞品玩家融资信息（轮次/金额/投资方）
2. 产品发布/重大商业化进展
3. 技术突破/里程碑
4. 核心人员变更（高管加入/离职）
5. 重要合作/监管政策

工作方式：
1. 调用 web_search 检索（最多 3 次，关键词如「${industry} 融资」「${industry} 产品发布」「${industry} 人事变动」，可组合今日/最近日期）
2. 仅基于真实搜索结果整理，禁止编造；引用 URL 必须来自搜索结果
3. 当日确无重要动态时，events 可为空数组并说明原因

严格按以下 JSON 格式输出，不要任何其他文字：
{
  "events": [
    { "type": "融资", "company": "公司名", "title": "一句话标题", "detail": "1-3句详情", "date": "${today}" }
  ],
  "citations": [{ "label": "来源标题", "url": "https://..." }],
  "note": "仅当无事件时填写原因"
}`

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

/** 事件规范化与校验 */
function normalizeEvents(raw: AgentOutput['events'], today: string): IndustryEvent[] {
  if (!Array.isArray(raw)) return []
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
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? (e.date as string) : today,
    })
    if (out.length >= 5) break // 上限 5 件
  }
  return out
}

async function analyzeIndustry(industry: string): Promise<IndustryNewsCard> {
  const today = todayKey()
  const { content, sessionLog } = await runAgent({
    systemPrompt: SYSTEM_PROMPT(industry, today),
    userPrompt: `请检索「${industry}」行业今日动态并输出 JSON。`,
    tools: ddTools(),
    maxTurns: 3,
    temperature: 0.4,
  })

  const parsed = parseAgentJson<AgentOutput>(content)
  const card: IndustryNewsCard = {
    industry,
    events: parsed ? normalizeEvents(parsed.events, today) : [],
    citations: parsed ? filterUrls(parsed.citations, sessionLog.searchedUrls()) : [],
    analyzedAt: new Date().toISOString(),
  }
  if (card.events.length === 0) {
    const rawNote = parsed?.note?.trim() || ''
    if (rawNote) {
      // 放宽至 200 字符；超长时在句末标点处截断，保持句子完整
      card.note =
        rawNote.length <= 200
          ? rawNote
          : rawNote.slice(0, 200).replace(/[，。；！？、].*$/, m => (/[。！？]/.test(m) ? m : m[0] + '…'))
    } else {
      card.note = '今日暂未检索到重要动态'
    }
  }
  return card
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

  // 并行子Agent（并发池）
  const fresh: IndustryNewsCard[] = []
  const queue = [...pending]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const ind = queue.shift()
      if (ind === undefined) break
      runningIndustries.add(ind)
      try {
        fresh.push(await analyzeIndustry(ind))
      } catch (e) {
        console.error(`[IndustryNews] 「${ind}」分析失败:`, e instanceof Error ? e.message : e)
        fresh.push({
          industry: ind,
          events: [],
          citations: [],
          analyzedAt: new Date().toISOString(),
          note: '分析失败，请稍后重试',
        })
      } finally {
        runningIndustries.delete(ind)
      }
    }
  })
  await Promise.all(workers)

  // 合并写回缓存
  const cards = mergeCards(existing, fresh)
  await writeCache({ date, cards })

  return { date, analyzed: pending, cards }
}

/** 查询当日行业动态（API GET 用）：返回缓存 + running 标记 */
export async function getIndustryNews(date = todayKey()) {
  const cached = await readCache(date)
  return {
    date,
    cards: cached?.cards || [],
    updatedAt: cached ? undefined : undefined,
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
