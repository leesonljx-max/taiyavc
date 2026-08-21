/**
 * 双源搜索共享工具库（Tavily + DeepSeek web_search）
 *
 * 供 AI画板、竞争态势、新闻监控、AI线索、投研模块分析、DD Harness 共用
 *
 * 任务分级（Token 成本控制）：
 * - collect  收集型（行业动态/AI线索/新闻监控）：Tavily 主力，DeepSeek 仅降级备份，不做双源归纳
 * - research 研究型（尽调/竞争态势/投研模块）：双源比较 + 合并 + DeepSeek 归纳
 *
 * 核心逻辑（searchWebDual）：
 * 1. 并行调用 Tavily Search 与 DeepSeek Responses API web_search（官方托管搜索）
 * 2. 比较两边返回的信息完整度（唯一URL数 + 内容总量）
 * 3. 两边都有结果 → 合并去重（以更完整的一边为主）→ 调用 DeepSeek 归纳总结
 * 4. 只有一边返回结果 → 直接以单一来源的信息为准
 * 5. 都失败 → 返回空数组（调用方自行降级）
 *
 * 搜索缓存：同一 query 在 TTL 内直接命中缓存，不重复消耗 token
 * Token 计量：每次 DeepSeek 调用的 usage 记入 AICache（AI 看板展示）
 */

import { tavily } from '@tavily/core'
import { deepseekWebSearch } from '@/lib/deepseek-websearch'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import { getSearchCache, putSearchCache } from '@/lib/search-cache'

// Tavily 客户端（延迟初始化）
let _client: ReturnType<typeof tavily> | null = null
function getClient() {
  if (!_client) {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) throw new Error('TAVILY_API_KEY 未配置')
    _client = tavily({ apiKey })
  }
  return _client
}

export interface SearchResult {
  title: string
  url: string
  content: string
}

/** 任务分级模式 */
export type SearchMode = 'collect' | 'research'

/** 模块标识（token 记账归属） */
export type SearchModule =
  | 'ai-card'        // AI投资分析
  | 'competitors'    // 竞争态势分析
  | 'ai-leads'       // AI 线索
  | 'industry-news'  // 行业动态
  | 'news'           // 新闻监控（现 AI 看板数据源）
  | 'research'       // 投研模块分析
  | 'dd-harness'     // 尽调报告
  | 'ai-research'    // AI行研 ChatBot
  | 'search-lib'     // 搜索库自身（归纳调用）

/**
 * 通用 Tavily 搜索（单源，返回清洁正文）
 *
 * @param query 搜索关键词
 * @param options 搜索选项
 *   - maxResults: 最多返回结果数（默认 5，上限 5 控成本）
 *   - topic: 'news' 或 'general'（默认 'general'）
 *   - days: 仅返回近 N 天的结果（仅 topic='news' 时生效，默认不限制）
 */
export async function searchWeb(
  query: string,
  options?: {
    maxResults?: number
    topic?: 'news' | 'general'
    days?: number
  }
): Promise<SearchResult[]> {
  try {
    const client = getClient()
    const res = await client.search(query, {
      topic: options?.topic || 'general',
      maxResults: Math.min(options?.maxResults || 5, 5),
      searchDepth: 'basic',
      days: options?.days,
    })
    return res.results.map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('timed out') && !msg.includes('timeout')) {
      console.warn(`Tavily 搜索失败 [${query}]:`, msg)
    }
    return []
  }
}

// ═══════════════════════════════════════════
// 双源搜索：纯函数（可单测）
// ═══════════════════════════════════════════

/**
 * 信息完整度评分：
 * - 唯一 URL 数（信息覆盖面，权重高）
 * - 内容总长度（信息量）
 */
export function scoreCompleteness(results: Array<{ url: string; content: string }>): number {
  if (!Array.isArray(results) || results.length === 0) return 0
  const uniqueUrls = new Set(results.map(r => r.url).filter(Boolean)).size
  const totalLen = results.reduce((s, r) => s + (typeof r.content === 'string' ? r.content.length : 0), 0)
  return uniqueUrls * 1000 + totalLen
}

/**
 * 判断两边搜索结果来源状态
 * - 'both': 两边都有结果（需比较完整度并归纳）
 * - 'tavily' / 'deepseek': 仅单边有结果（以单一来源为准）
 * - 'none': 两边都无结果
 */
export function decideWinner(
  tavilyResults: SearchResult[],
  deepseekResults: SearchResult[]
): 'both' | 'tavily' | 'deepseek' | 'none' {
  const hasT = tavilyResults.length > 0
  const hasD = deepseekResults.length > 0
  if (hasT && hasD) return 'both'
  if (hasT) return 'tavily'
  if (hasD) return 'deepseek'
  return 'none'
}

/**
 * 合并两源结果（URL 去重）：
 * - primary（更完整的一边）在前，保持其顺序
 * - secondary 中 primary 未覆盖的 URL 追加在后
 */
export function mergeSearchResults(
  primary: SearchResult[],
  secondary: SearchResult[]
): SearchResult[] {
  const seen = new Set(primary.map(r => r.url))
  const extra = secondary.filter(r => r.url && !seen.has(r.url))
  return [...primary, ...extra]
}

/**
 * DeepSeek 归纳总结（Harness 式分析）：
 * 把双源合并的原始结果去噪、去重、提炼为标准结果列表。
 * 失败时返回 null（调用方回退使用原始合并结果，不阻断流程）。
 */
export async function summarizeMergedResults(
  query: string,
  merged: SearchResult[],
  maxResults: number,
  timeoutMs = 90000
): Promise<SearchResult[] | null> {
  if (merged.length === 0) return null

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  // 控制输入长度（每条截断，总量控制在 3.2 万字符内）
  const inputResults = merged.map(r => ({
    title: r.title,
    url: r.url,
    content: r.content.length > 2000 ? r.content.substring(0, 2000) : r.content,
  }))

  const systemPrompt =
    '你是搜索结果归纳助手。你会收到关于同一查询、来自两个搜索源合并后的原始结果。' +
    '请归纳总结：合并同一事件/主题的信息、去除重复与无关噪声、保留关键数据（金额/日期/机构名等原样保留），' +
    '输出按信息价值排序的结果列表。只返回 JSON，不要任何其他文字。'

  const userPrompt = `搜索查询：${query}

合并后的原始搜索结果：
${JSON.stringify(inputResults, null, 2)}

请归纳总结为最多 ${maxResults} 条结果，严格按以下 JSON 格式输出：
{"results": [{"title": "标题", "url": "对应来源URL", "content": "归纳后的关键内容（150-500字）"}]}

要求：
1. url 必须从原始结果的 url 中选取，禁止编造
2. 同一事件多个来源时，合并为一条并在 content 中注明综合了多个来源
3. 无有效内容时返回 {"results": []}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 6000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.warn(`双源归纳 DeepSeek 调用失败 [${query}]: ${response.status} ${errText.substring(0, 200)}`)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    // token 记账（AI 看板展示）
    recordTokenUsage('search-lib', data.usage)

    const parsed = parseAgentJson<{ results?: Array<Record<string, unknown>> }>(content)
    if (!parsed || !Array.isArray(parsed.results)) return null

    // URL 白名单校验：归纳结果的 url 必须来自原始结果（防编造）
    const validUrls = new Set(merged.map(r => r.url))
    const out: SearchResult[] = []
    for (const r of parsed.results) {
      const url = typeof r?.url === 'string' ? r.url.trim() : ''
      const title = typeof r?.title === 'string' ? r.title.trim() : ''
      const c = typeof r?.content === 'string' ? r.content.trim() : ''
      if (!validUrls.has(url) || (!title && !c)) continue
      out.push({ title: title || url, url, content: c })
    }
    return out.length > 0 ? out : null
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('abort')) {
      console.warn(`双源归纳失败 [${query}]:`, msg)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// ═══════════════════════════════════════════
// 双源搜索：主入口
// ═══════════════════════════════════════════

export interface DualSearchOptions {
  /** 每个源各自最多返回结果数（默认 5，硬上限 5 控成本） */
  maxResults?: number
  /** 搜索主题：news 时 Tavily 用新闻搜索、DeepSeek 强调新闻 */
  topic?: 'news' | 'general'
  /** 仅关注近 N 天（传给 Tavily days；DeepSeek 侧转化为时效性提示） */
  days?: number
  /** DeepSeek 侧超时（ms），搜索较慢，默认 90 秒 */
  timeoutMs?: number
  /** 归纳后最大条数（默认 maxResults 的 2 倍，保留双源增量信息） */
  finalMaxResults?: number
  /** 是否跳过双源归纳（测试/降级用，默认 false） */
  skipSummarize?: boolean
  /**
   * 任务分级（Token 成本控制）：
   * - collect（默认）：收集型任务，Tavily 主力 + DeepSeek 降级备份，不做归纳
   * - research：研究型任务，双源比较 + 合并 + DeepSeek 归纳
   */
  mode?: SearchMode
  /** token 记账归属模块 */
  module?: SearchModule
  /** 缓存 TTL（小时）；0 表示禁用缓存。collect 默认 12h，research 默认 1h */
  cacheTtlHours?: number
}

/** 双源搜索元信息（日志/测试观测用） */
export interface DualSearchMeta {
  tavilyCount: number
  deepseekCount: number
  winner: 'both' | 'tavily' | 'deepseek' | 'none'
  /** 双源都有时的完整度胜出方 */
  moreComplete: 'tavily' | 'deepseek' | 'equal' | null
  /** 是否经过 DeepSeek 归纳总结 */
  summarized: boolean
  finalCount: number
  /** 任务分级模式 */
  mode: SearchMode
  /** 是否命中缓存 */
  cacheHit: boolean
}

/** 最近一次 searchWebDual 的元信息（观测用；并发场景仅作参考） */
let _lastDualMeta: DualSearchMeta | null = null
export function getLastDualSearchMeta(): DualSearchMeta | null {
  return _lastDualMeta
}

/**
 * 双源搜索决策（纯函数，可单测）：
 * 根据两源结果决定胜出方、合并策略与是否需要归纳总结
 *
 * - 两边都有 → winner='both'：比较完整度，完整方在前合并去重，需归纳总结
 * - 仅单边   → winner=该边：以单一来源为准，不归纳
 * - 都无结果 → winner='none'：空结果
 */
export function resolveDualSearch(
  tavilyResults: SearchResult[],
  deepseekResults: SearchResult[],
  options?: { skipSummarize?: boolean }
): {
  winner: 'both' | 'tavily' | 'deepseek' | 'none'
  /** 双源都有时的完整度胜出方 */
  moreComplete: 'tavily' | 'deepseek' | 'equal' | null
  /** 单边时直接返回该边结果；双边时为合并去重后的结果 */
  results: SearchResult[]
  /** 是否需要 DeepSeek 归纳总结（双边且未跳过时 true） */
  needsSummarize: boolean
} {
  const winner = decideWinner(tavilyResults, deepseekResults)

  if (winner === 'none') {
    return { winner, moreComplete: null, results: [], needsSummarize: false }
  }
  if (winner === 'tavily' || winner === 'deepseek') {
    return {
      winner,
      moreComplete: winner,
      results: winner === 'tavily' ? tavilyResults : deepseekResults,
      needsSummarize: false,
    }
  }

  // 双边都有：比较完整度
  const tavilyScore = scoreCompleteness(tavilyResults)
  const deepseekScore = scoreCompleteness(deepseekResults)
  const moreComplete: 'tavily' | 'deepseek' | 'equal' =
    tavilyScore > deepseekScore ? 'tavily' : deepseekScore > tavilyScore ? 'deepseek' : 'equal'

  const merged =
    moreComplete === 'deepseek'
      ? mergeSearchResults(deepseekResults, tavilyResults)
      : mergeSearchResults(tavilyResults, deepseekResults)

  return {
    winner: 'both',
    moreComplete,
    results: merged,
    needsSummarize: !options?.skipSummarize,
  }
}

/**
 * 双源搜索（Tavily + DeepSeek web_search）：
 *
 * 模式分级（Token 成本控制）：
 * - collect（收集型：行业动态/AI线索/新闻监控）：Tavily 主力；仅当 Tavily 失败/为空时
 *   才调用 DeepSeek web_search 降级备份；不执行双源归纳（省去归纳 token）
 * - research（研究型：尽调/竞争态势/投研模块）：并行双源 → 比较完整度 → 合并去重
 *   → DeepSeek 归纳总结
 *
 * 缓存：同 query 在 TTL 内直接返回缓存（collect 12h / research 1h，可配）
 */
export async function searchWebDual(
  query: string,
  options?: DualSearchOptions
): Promise<SearchResult[]> {
  const mode = options?.mode || 'collect'
  const module = options?.module || 'search-lib'
  const maxResults = Math.min(options?.maxResults || 5, 5)
  const finalMaxResults = options?.finalMaxResults || maxResults * 2
  const cacheTtlHours = options?.cacheTtlHours ?? (mode === 'collect' ? 12 : 1)

  const setMeta = (tavilyCount: number, deepseekCount: number, winner: DualSearchMeta['winner'], moreComplete: DualSearchMeta['moreComplete'], summarized: boolean, finalCount: number, cacheHit: boolean) => {
    _lastDualMeta = { tavilyCount, deepseekCount, winner, moreComplete, summarized, finalCount, mode, cacheHit }
  }

  // 0. 缓存命中直接返回
  if (cacheTtlHours > 0) {
    const cached = await getSearchCache(query, { maxResults, topic: options?.topic, days: options?.days, mode })
    if (cached && cached.length > 0) {
      setMeta(cached.length, 0, 'tavily', 'tavily', false, cached.length, true)
      return cached
    }
  }

  // ── collect 模式：Tavily 主力，DeepSeek 仅降级备份 ──
  if (mode === 'collect') {
    const tavilyResults = await searchWeb(query, {
      maxResults,
      topic: options?.topic,
      days: options?.days,
    }).catch(() => [] as SearchResult[])

    if (tavilyResults.length > 0) {
      setMeta(tavilyResults.length, 0, 'tavily', 'tavily', false, tavilyResults.length, false)
      if (cacheTtlHours > 0) {
        await putSearchCache(query, { maxResults, topic: options?.topic, days: options?.days, mode }, tavilyResults, cacheTtlHours)
      }
      return tavilyResults
    }

    // Tavily 失败/为空 → DeepSeek 降级
    const deepseekResults = await deepseekWebSearch(query, {
      maxResults,
      recencyDays: options?.days,
      topic: options?.topic,
      timeoutMs: options?.timeoutMs,
      module,
    }).catch(() => [] as SearchResult[])

    setMeta(0, deepseekResults.length, deepseekResults.length > 0 ? 'deepseek' : 'none', 'deepseek', false, deepseekResults.length, false)
    if (deepseekResults.length > 0 && cacheTtlHours > 0) {
      await putSearchCache(query, { maxResults, topic: options?.topic, days: options?.days, mode }, deepseekResults, cacheTtlHours)
    }
    return deepseekResults
  }

  // ── research 模式：并行双源 → 决策 → 归纳 ──
  const [tavilyResults, deepseekResults] = await Promise.all([
    searchWeb(query, {
      maxResults,
      topic: options?.topic,
      days: options?.days,
    }).catch(() => [] as SearchResult[]),
    deepseekWebSearch(query, {
      maxResults,
      recencyDays: options?.days,
      topic: options?.topic,
      timeoutMs: options?.timeoutMs,
      module,
    }).catch(() => [] as SearchResult[]),
  ])

  const decision = resolveDualSearch(tavilyResults, deepseekResults, {
    skipSummarize: options?.skipSummarize,
  })

  if (decision.winner === 'none') {
    setMeta(0, 0, 'none', null, false, 0, false)
    return []
  }

  // 单边降级：以单一来源为准（不归纳）
  if (decision.winner !== 'both') {
    setMeta(
      tavilyResults.length,
      deepseekResults.length,
      decision.winner,
      decision.moreComplete,
      false,
      decision.results.length,
      false
    )
    if (decision.results.length > 0 && cacheTtlHours > 0) {
      await putSearchCache(query, { maxResults, topic: options?.topic, days: options?.days, mode }, decision.results, cacheTtlHours)
    }
    return decision.results
  }

  // 双源都有：DeepSeek 归纳总结（Harness 式分析）；失败回退原始合并结果
  let summarized = false
  let finalResults = decision.results
  if (decision.needsSummarize) {
    const summarizedResults = await summarizeMergedResults(query, decision.results, finalMaxResults)
    if (summarizedResults) {
      finalResults = summarizedResults
      summarized = true
    }
  }

  setMeta(
    tavilyResults.length,
    deepseekResults.length,
    'both',
    decision.moreComplete,
    summarized,
    finalResults.length,
    false
  )
  if (finalResults.length > 0 && cacheTtlHours > 0) {
    await putSearchCache(query, { maxResults, topic: options?.topic, days: options?.days, mode }, finalResults, cacheTtlHours)
  }
  return finalResults
}

/**
 * 双源搜索 + DeepSeek 归纳总结（一体化封装）
 *
 * 1. 用双源搜索（按 mode 分级）获取相关内容
 * 2. 将搜索结果喂给 DeepSeek 进行归纳总结
 * 3. 返回 DeepSeek 的结构化输出
 *
 * @param queries 搜索关键词列表（并发搜索）
 * @param systemPrompt DeepSeek system prompt
 * @param userPromptBuilder 构建用户 prompt 的函数，接收搜索结果
 * @param options 搜索选项
 */
export async function searchAndSummarize(
  queries: string[],
  systemPrompt: string,
  userPromptBuilder: (results: SearchResult[]) => string,
  options?: {
    maxResultsPerQuery?: number
    topic?: 'news' | 'general'
    days?: number
    timeoutMs?: number
    skipSummarize?: boolean
    mode?: SearchMode
    module?: SearchModule
    cacheTtlHours?: number
  }
): Promise<{ data: string | null; searchResultsCount: number; error?: string }> {
  // 1. 并发双源搜索
  const searchPromises = queries.map(q =>
    searchWebDual(q, {
      maxResults: options?.maxResultsPerQuery || 5,
      topic: options?.topic,
      days: options?.days,
      timeoutMs: options?.timeoutMs,
      skipSummarize: options?.skipSummarize,
      mode: options?.mode,
      module: options?.module,
      cacheTtlHours: options?.cacheTtlHours,
    })
  )
  const searchArrays = await Promise.all(searchPromises)
  const allResults = searchArrays.flat()

  if (allResults.length === 0) {
    return { data: null, searchResultsCount: 0, error: '未找到相关搜索结果' }
  }

  // 2. 调用 DeepSeek 分析
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return { data: null, searchResultsCount: allResults.length, error: 'DeepSeek API Key 未配置' }
  }

  const userPrompt = userPromptBuilder(allResults)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs || 60000)

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return {
        data: null,
        searchResultsCount: allResults.length,
        error: `DeepSeek API 调用失败: ${response.status} ${errText.substring(0, 200)}`,
      }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || null

    // token 记账（AI 看板展示）
    recordTokenUsage(options?.module || 'search-lib', data.usage)

    return { data: content, searchResultsCount: allResults.length }
  } catch (error) {
    clearTimeout(timeoutId)
    const msg = error instanceof Error ? error.message : String(error)
    return {
      data: null,
      searchResultsCount: allResults.length,
      error: `DeepSeek 请求失败: ${msg}`,
    }
  }
}
