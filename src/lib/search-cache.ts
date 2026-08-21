/**
 * 搜索结果缓存（Token 成本控制）
 *
 * 同一 query（含 maxResults/topic/days/mode 组合）在 TTL 内直接返回缓存，
 * 避免重复调用 Tavily/DeepSeek 消耗 token。
 *
 * 存储复用 AICache 表（cacheKey: search-cache:md5(fingerprint)），
 * results 为空不缓存（下次重试）。
 */

import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import type { SearchResult, SearchMode } from '@/lib/tavily-search'

export interface SearchCacheFingerprint {
  maxResults?: number
  topic?: 'news' | 'general'
  days?: number
  mode?: SearchMode
}

/** 生成缓存键（query + 检索参数指纹） */
export function searchCacheKey(query: string, fp: SearchCacheFingerprint): string {
  const raw = JSON.stringify({
    q: query.trim(),
    maxResults: fp.maxResults || 5,
    topic: fp.topic || 'general',
    days: fp.days || 0,
    mode: fp.mode || 'collect',
  })
  const hash = createHash('md5').update(raw).digest('hex').substring(0, 16)
  return `search-cache:${hash}`
}

/** 缓存条目结构 */
interface CacheEntry {
  results: SearchResult[]
  cachedAt: string // ISO
  ttlHours: number
}

/**
 * 读取缓存：TTL 内有效则返回结果，否则返回 null（不删除，靠覆盖更新）
 */
export async function getSearchCache(
  query: string,
  fp: SearchCacheFingerprint
): Promise<SearchResult[] | null> {
  try {
    const cached = await prisma.aICache.findUnique({
      where: { cacheKey: searchCacheKey(query, fp) },
    })
    if (!cached) return null

    const entry = JSON.parse(cached.data) as CacheEntry
    if (!Array.isArray(entry?.results) || entry.results.length === 0) return null

    const ageHours = (Date.now() - new Date(entry.cachedAt).getTime()) / 3_600_000
    if (ageHours >= entry.ttlHours) return null // 过期

    return entry.results
  } catch {
    return null // 缓存读取失败按未命中处理
  }
}

/**
 * 写入缓存（TTL 小时；results 为空不写）
 */
export async function putSearchCache(
  query: string,
  fp: SearchCacheFingerprint,
  results: SearchResult[],
  ttlHours: number
): Promise<void> {
  if (!results || results.length === 0 || ttlHours <= 0) return
  try {
    const entry: CacheEntry = {
      results,
      cachedAt: new Date().toISOString(),
      ttlHours,
    }
    await prisma.aICache.upsert({
      where: { cacheKey: searchCacheKey(query, fp) },
      create: { cacheKey: searchCacheKey(query, fp), data: JSON.stringify(entry) },
      update: { data: JSON.stringify(entry) },
    })
  } catch (error) {
    // 缓存写入失败不影响业务
    console.warn('[SearchCache] 写入失败:', error instanceof Error ? error.message : error)
  }
}
