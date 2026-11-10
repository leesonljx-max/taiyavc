/**
 * 九大模块公开来源检索
 *
 * 串行模块、模块内并发 3，避免触发搜索 API 限流；
 * 复用双源检索的 collect 模式（Tavily 主力 + DeepSeek 降级，12h 缓存）。
 */

import { createHash } from 'crypto'
import { searchWebDual } from '@/lib/tavily-search'
import {
  DD_SEARCH_BUDGET,
  domainOf,
  gradeSource,
  sourceTypeOf,
} from './constants'
import type { DDModuleQueryPlan } from './planner'

export interface ResearchSourceDraft {
  moduleKey: string
  url: string
  title: string
  domain: string
  snippet: string
  content: string
  sourceType: 'OFFICIAL' | 'REPORT' | 'MEDIA' | 'WEB'
  grade: 'A' | 'B' | 'C' | 'D'
  contentHash: string
}

export interface ModuleSourceResult {
  moduleKey: string
  sources: ResearchSourceDraft[]
  searchCount: number
  errors: string[]
}

export interface SearchSourcesResult {
  modules: ModuleSourceResult[]
  totalSearchCount: number
}

/** 去掉锚点、utm 参数、末尾斜杠，用于跨查询去重 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from']
    for (const key of drop) url.searchParams.delete(key)
    let out = url.toString()
    if (out.endsWith('/')) out = out.slice(0, -1)
    return out
  } catch {
    return raw.trim()
  }
}

export function hashSource(url: string, content: string): string {
  return createHash('sha256').update(`${url}\n${content.slice(0, 2000)}`).digest('hex').slice(0, 32)
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 执行查询计划，返回按模块分组的来源。
 * 全局按规范化 URL 去重；单模块最多保留 DD_SEARCH_BUDGET.maxSourcesPerModule 条。
 */
export async function searchModuleSources(
  plan: DDModuleQueryPlan[],
  options?: { maxSearches?: number; seenUrls?: Set<string> }
): Promise<SearchSourcesResult> {
  const budget = options?.maxSearches ?? DD_SEARCH_BUDGET.maxSearches
  const seenUrls = options?.seenUrls ?? new Set<string>()
  let totalSearchCount = 0

  const modules: ModuleSourceResult[] = []

  for (const item of plan) {
    if (totalSearchCount >= budget) {
      modules.push({ moduleKey: item.moduleKey, sources: [], searchCount: 0, errors: ['搜索预算已用尽'] })
      continue
    }

    const remaining = budget - totalSearchCount
    const queries = item.queries.slice(0, Math.min(item.queries.length, remaining))
    const errors: string[] = []

    const batches = await runWithConcurrency(queries, 3, async query => {
      try {
        const results = await searchWebDual(query, {
          maxResults: DD_SEARCH_BUDGET.maxResultsPerQuery,
          mode: 'collect',
          module: 'dd-research',
          cacheTtlHours: 12,
        })
        return results
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.push(`${query}: ${msg}`)
        return []
      }
    })

    totalSearchCount += queries.length

    const sources: ResearchSourceDraft[] = []
    for (const result of batches.flat()) {
      if (!result.url) continue
      const url = normalizeUrl(result.url)
      if (seenUrls.has(url)) continue
      const content = (result.content || '').slice(0, DD_SEARCH_BUDGET.contentMaxChars)
      if (!content) continue
      seenUrls.add(url)
      const grade = gradeSource(url)
      sources.push({
        moduleKey: item.moduleKey,
        url,
        title: (result.title || url).slice(0, 300),
        domain: domainOf(url),
        snippet: content.slice(0, 240),
        content,
        sourceType: sourceTypeOf(grade),
        grade,
        contentHash: hashSource(url, content),
      })
      if (sources.length >= DD_SEARCH_BUDGET.maxSourcesPerModule) break
    }

    modules.push({ moduleKey: item.moduleKey, sources, searchCount: queries.length, errors })
  }

  return { modules, totalSearchCount }
}
