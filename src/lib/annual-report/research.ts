/**
 * 年度报告：重点项目融资进展检索
 *
 * 只做「公开信息辅助」：有来源才采纳，无来源一律标记未检索到；
 * 单个项目失败不阻断整份报告。
 */

import { searchWebDual, type SearchResult } from '@/lib/tavily-search'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'
import { recordTokenUsage } from '@/lib/token-accounting'
import { REPORT_STAGE_LABELS, type FinancingItem } from './types'
import type { ProjectInput } from './metrics'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const CONCURRENCY = 2
const SEARCH_TIMEOUT_MS = 45_000
const EXTRACT_TIMEOUT_MS = 35_000

interface ExtractedProgress {
  progressType?: string
  latestRound?: string | null
  amount?: string | null
  investors?: string[] | null
  valuation?: string | null
  eventDate?: string | null
  sourceUrl?: string | null
  sourceTitle?: string | null
  confidence?: number | null
}

function stageLabel(stage: string): string {
  return REPORT_STAGE_LABELS[stage as keyof typeof REPORT_STAGE_LABELS] ?? (stage === 'POST_INVESTMENT' ? '投后' : stage)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function truncate(text: string, max: number): string {
  const value = (text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function buildPrompt(project: ProjectInput, year: number, results: SearchResult[]): string {
  const sources = results
    .map((result, index) => `[${index + 1}] ${result.title}\nURL: ${result.url}\n${truncate(result.content, 700)}`)
    .join('\n\n')
  return `项目名称：${project.name}
公司全称：${project.companyFullName || '未填写'}
行业：${project.industry || '未填写'}
库内融资轮次：${project.financingRound || '未填写'}
库内融资金额：${project.totalAmount || '未填写'}
报告年度：${year}

公开搜索结果：
${sources || '（无搜索结果）'}

请判断该项目在 ${year} 年及之后的最新融资进展，只输出 JSON：
{
  "progressType": "NEW_ROUND | ROUND_UP | SAME_AS_DB | NO_PUBLIC_INFO | FAILED",
  "latestRound": "最新轮次，如 A轮；无法确认填 null",
  "amount": "融资金额原文，如 5000万元；无法确认填 null",
  "investors": ["投资方，最多5个"],
  "valuation": "估值原文；无法确认填 null",
  "eventDate": "YYYY-MM-DD 或 YYYY-MM；无法确认填 null",
  "sourceUrl": "必须从上面搜索结果中选一个 URL；没有填 null",
  "sourceTitle": "对应来源标题；没有填 null",
  "confidence": 0.0
}

规则：
1. 只能使用搜索结果中明确出现的信息，禁止推测、禁止编造。
2. NEW_ROUND 表示出现库内轮次之后的新融资；ROUND_UP 表示同一轮追加/金额更新；SAME_AS_DB 表示公开信息与库内一致；NO_PUBLIC_INFO 表示没有可用公开信息。
3. 没有可核实来源时，progressType 必须是 NO_PUBLIC_INFO，sourceUrl 必须是 null。
4. investors 只保留搜索结果中明确写出的机构名。`
}

async function extractProgress(
  project: ProjectInput,
  year: number,
  results: SearchResult[]
): Promise<{ item: FinancingItem; failed: boolean }> {
  const base: FinancingItem = {
    projectId: project.id,
    projectName: project.name,
    stageLabel: stageLabel(project.followStage),
    progressType: 'NO_PUBLIC_INFO',
    latestRound: null,
    amount: null,
    investors: [],
    valuation: null,
    eventDate: null,
    sourceUrl: null,
    sourceTitle: null,
    confidence: null,
  }

  if (results.length === 0) return { item: base, failed: false }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return { item: { ...base, progressType: 'FAILED' }, failed: true }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是投资机构的投研助理。只依据给定搜索结果输出 JSON，不编造事实。',
          },
          { role: 'user', content: buildPrompt(project, year, results) },
        ],
        temperature: 0.1,
        max_tokens: 700,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const payload = (await response.json()) as {
      usage?: unknown
      choices?: Array<{ message?: { content?: string } }>
    }
    recordTokenUsage('other', payload.usage as Parameters<typeof recordTokenUsage>[1])

    const parsed = parseAgentJson<ExtractedProgress>(payload.choices?.[0]?.message?.content || '')
    if (!parsed) return { item: { ...base, progressType: 'FAILED' }, failed: true }

    const allowed = new Set(['NEW_ROUND', 'ROUND_UP', 'SAME_AS_DB', 'NO_PUBLIC_INFO', 'FAILED'])
    let progressType = allowed.has(String(parsed.progressType)) ? String(parsed.progressType) : 'NO_PUBLIC_INFO'
    const sourceUrl = parsed.sourceUrl && results.some(result => result.url === parsed.sourceUrl) ? parsed.sourceUrl : null
    if ((progressType === 'NEW_ROUND' || progressType === 'ROUND_UP') && !sourceUrl) {
      progressType = 'NO_PUBLIC_INFO'
    }

    const investors = Array.isArray(parsed.investors)
      ? parsed.investors.filter((item): item is string => typeof item === 'string').map(item => truncate(item, 40)).slice(0, 5)
      : []

    return {
      failed: false,
      item: {
        projectId: project.id,
        projectName: project.name,
        stageLabel: stageLabel(project.followStage),
        progressType: progressType as FinancingItem['progressType'],
        latestRound: parsed.latestRound ? truncate(String(parsed.latestRound), 30) : null,
        amount: parsed.amount ? truncate(String(parsed.amount), 40) : null,
        investors,
        valuation: parsed.valuation ? truncate(String(parsed.valuation), 40) : null,
        eventDate: parsed.eventDate ? truncate(String(parsed.eventDate), 20) : null,
        sourceUrl,
        sourceTitle: sourceUrl
          ? parsed.sourceTitle
            ? truncate(String(parsed.sourceTitle), 80)
            : results.find(result => result.url === sourceUrl)?.title ?? null
          : null,
        confidence:
          typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
            ? Math.max(0, Math.min(1, parsed.confidence))
            : null,
      },
    }
  } catch (error) {
    console.error(`[annual-report] 融资检索失败 ${project.name}:`, error)
    return { item: { ...base, progressType: 'FAILED' }, failed: true }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function researchProject(project: ProjectInput, year: number): Promise<{ item: FinancingItem; failed: boolean }> {
  const query = `${project.companyFullName || project.name} 融资 最新轮次 投资方 ${year}`
  const results = await searchWebDual(query, {
    mode: 'collect',
    module: 'annual-report',
    maxResults: 5,
    cacheTtlHours: 24 * 7,
    timeoutMs: SEARCH_TIMEOUT_MS,
  }).catch(() => [] as SearchResult[])
  return extractProgress(project, year, results)
}

/** 对 cohort 项目批量检索融资进展 */
export async function researchFinancingProgress(
  projects: ProjectInput[],
  year: number,
  limit: number,
  onProgress?: (done: number, total: number) => void
): Promise<{ items: FinancingItem[]; failed: number }> {
  const cohort = projects.slice(0, limit)
  let done = 0
  const results = await mapWithConcurrency(cohort, CONCURRENCY, async project => {
    const result = await researchProject(project, year)
    done += 1
    onProgress?.(done, cohort.length)
    return result
  })
  return {
    items: results.map(result => result.item),
    failed: results.filter(result => result.failed).length,
  }
}
