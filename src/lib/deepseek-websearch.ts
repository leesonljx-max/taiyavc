/**
 * DeepSeek web_search 封装（官方托管搜索服务）
 *
 * 基于 DeepSeek Responses API（https://api.deepseek.com/v1/responses），
 * 通过 `tools: [{ type: 'web_search' }]` 由 DeepSeek 服务端执行联网搜索。
 *
 * 特点：
 * - 官方托管：无需第三方搜索 API Key，计费含在 API token 用量里
 * - 实时信息：搜索发生在请求时刻，可获得最新新闻/数据
 * - 输出对齐：要求模型输出结构化 JSON（与 Tavily 的 SearchResult 格式一致），
 *   便于与 Tavily 结果做双源比较（见 tavily-search.ts 的 searchWebDual）
 *
 * 已验证（scripts/test-deepseek-websearch.ts）：
 * - 服务端执行 web_search_call（search + open_page 动作）
 * - 网页内容计入 input_tokens，总结计入 output_tokens
 * - 可返回最近 1-3 天的实时新闻
 */

import { parseAgentJson } from '@/lib/dd-harness/agent'

const RESPONSES_API_URL = 'https://api.deepseek.com/v1/responses'

/** 与 tavily-search.SearchResult 对齐的统一格式 */
export interface DeepSeekSearchResult {
  title: string
  url: string
  content: string
}

export interface DeepSeekWebSearchOptions {
  /** 最多返回结果数（默认 5） */
  maxResults?: number
  /** 时效性提示：只关注近 N 天的信息（如新闻监控传 3） */
  recencyDays?: number
  /** 搜索主题：news 时强调新闻类信息 */
  topic?: 'news' | 'general'
  /** 超时（ms），搜索较慢，默认 90 秒 */
  timeoutMs?: number
}

/** 规范化模型输出的结果列表 */
function normalizeResults(
  parsed: { results?: Array<{ title?: unknown; url?: unknown; content?: unknown }> } | null
): DeepSeekSearchResult[] {
  if (!parsed || !Array.isArray(parsed.results)) return []
  const out: DeepSeekSearchResult[] = []
  for (const r of parsed.results) {
    const url = typeof r?.url === 'string' ? r.url.trim() : ''
    const title = typeof r?.title === 'string' ? r.title.trim() : ''
    const content = typeof r?.content === 'string' ? r.content.trim() : ''
    // URL 必须合法 http(s)，title/content 至少有一样
    if (!/^https?:\/\//.test(url)) continue
    if (!title && !content) continue
    out.push({
      title: title || url,
      url,
      // 截断过长内容（与其他源对齐，避免下游 token 超限）
      content: content.length > 4000 ? content.substring(0, 4000) : content,
    })
  }
  return out
}

/**
 * DeepSeek 官方 web_search 单源搜索
 *
 * 返回结构与 Tavily searchWeb 一致（title/url/content），失败时返回 []（不抛异常）
 */
export async function deepseekWebSearch(
  query: string,
  options?: DeepSeekWebSearchOptions
): Promise<DeepSeekSearchResult[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.warn('DeepSeek web_search 跳过：DEEPSEEK_API_KEY 未配置')
    return []
  }

  const maxResults = options?.maxResults || 5
  const recencyHint = options?.recencyDays
    ? `只关注最近 ${options.recencyDays} 天内发布的信息。`
    : ''
  const topicHint = options?.topic === 'news' ? '优先搜索新闻类信息。' : ''

  const input = [
    `请使用 web_search 工具联网搜索：${query}`,
    recencyHint,
    topicHint,
    `搜索完成后，整理出最多 ${maxResults} 条最有价值的结果，严格按以下 JSON 格式输出，不要任何其他文字：`,
    `{"results": [{"title": "来源标题", "url": "https://...", "content": "该来源的关键内容摘要（150-500字，保留关键数据）"}]}`,
    '要求：url 必须是真实搜索到的来源链接，禁止编造；无有效结果时返回 {"results": []}。',
  ]
    .filter(Boolean)
    .join('\n')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 90000)

  try {
    const response = await fetch(RESPONSES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        instructions: '你是一个严谨的搜索助理，必须先使用 web_search 工具搜索，再基于搜索结果输出结构化 JSON。',
        input,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.warn(
        `DeepSeek web_search 调用失败 [${query}]: ${response.status} ${errText.substring(0, 200)}`
      )
      return []
    }

    const data = await response.json()

    // 从 output 数组提取最终 message 文本（web_search_call 之外的 message 项）
    const outputItems = (data.output || []) as Array<Record<string, unknown>>
    let text = ''
    for (const item of outputItems) {
      if (item.type !== 'message') continue
      const content = item.content as Array<{ text?: string }> | undefined
      if (Array.isArray(content)) {
        text += content.map(c => c.text || '').join('\n')
      }
    }

    if (!text) {
      console.warn(`DeepSeek web_search 无文本输出 [${query}]`)
      return []
    }

    // 复用 dd-harness 的多层容错 JSON 解析（容忍前后说明文字/中文引号等）
    const parsed = parseAgentJson<{ results: Array<Record<string, unknown>> }>(text)
    return normalizeResults(parsed)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('abort')) {
      console.warn(`DeepSeek web_search 失败 [${query}]:`, msg)
    }
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}
