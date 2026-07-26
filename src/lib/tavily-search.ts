/**
 * Tavily 搜索共享工具库
 *
 * 供 AI画板、竞争态势、融资热点图、新闻监控等功能共用
 *
 * 功能：
 * - searchWeb: 通用 Tavily 搜索，返回清洁正文
 * - searchAndSummarize: 搜索 + DeepSeek 归纳总结
 */

import { tavily } from '@tavily/core'

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

/**
 * 通用 Tavily 搜索
 *
 * @param query 搜索关键词
 * @param options 搜索选项
 *   - maxResults: 最多返回结果数（默认 5）
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
      maxResults: options?.maxResults || 5,
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

/**
 * 搜索 + DeepSeek 归纳总结
 *
 * 1. 用 Tavily 搜索相关内容
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
  }
): Promise<{ data: string | null; searchResultsCount: number; error?: string }> {
  // 1. 并发搜索
  const searchPromises = queries.map(q =>
    searchWeb(q, {
      maxResults: options?.maxResultsPerQuery || 5,
      topic: options?.topic,
      days: options?.days,
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
        max_tokens: 2000,
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
