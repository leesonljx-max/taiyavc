/**
 * AI 自动项目线索检索核心库
 *
 * 流程：
 * 1. 读取近 3 个月初聊项目的行业标签
 * 2. 用 DeepSeek 生成检索关键词
 * 3. 用双源搜索（Tavily + DeepSeek web_search 比较取优）搜索融资 PR 新闻
 * 4. 用 DeepSeek 从搜索结果中筛选并抽取结构化信息
 * 5. 匹配初聊项目和维护人
 * 6. 保存线索到数据库
 */

import { tavily } from '@tavily/core'
import prisma from '@/lib/prisma'
import { similarity, isHighlyOverlapping } from '@/lib/lead-match'
import { searchWebDual } from '@/lib/tavily-search'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

// Tavily 客户端（延迟初始化，避免无 API Key 时启动报错；仅 Extract 全文时使用）
let _tavilyClient: ReturnType<typeof tavily> | null = null
function getTavilyClient() {
  if (!_tavilyClient) {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) throw new Error('TAVILY_API_KEY 未配置')
    _tavilyClient = tavily({ apiKey })
  }
  return _tavilyClient
}

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

interface InitialTalkProject {
  id: string
  name: string
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  createdById: string
  createdBy: { id: string; name: string | null } | null
  targetDate: Date
}

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

interface ExtractedLead {
  companyName: string
  companyPositioning: string | null
  coreProducts: string[]
  coreAdvantages: string[]
  fundingRound: string | null
  fundingAmount: string | null
  valuation: string | null
  investors: string[]
  financialAdvisors: string[]
  announceDate: string | null
  sourceUrl: string
  sourceTitle: string
  summary: string
  industry: string | null
}

interface MatchedLead extends ExtractedLead {
  matchedProjectId: string | null
  matchedConfidence: number
  matchedMaintainerId: string | null
}

export interface RetrievalResult {
  totalFound: number
  totalSaved: number
  keywords: string[]
  errors: string[]
}

// ────────────────────────────────────────────────────────────
// 1. 获取近 3 个月初聊项目
// ────────────────────────────────────────────────────────────

async function getInitialTalkProjects(): Promise<InitialTalkProject[]> {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  const projects = await prisma.project.findMany({
    where: {
      followStage: 'INITIAL_TALK',
      targetDate: { gte: threeMonthsAgo },
      status: { not: 'REJECTED' },
    },
    select: {
      id: true,
      name: true,
      industry: true,
      companyPosition: true,
      mainProducts: true,
      createdById: true,
      targetDate: true,
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { targetDate: 'desc' },
  })

  return projects
}

// ────────────────────────────────────────────────────────────
// 2. 用 DeepSeek 生成检索关键词
// ────────────────────────────────────────────────────────────

async function generateSearchKeywords(
  projects: InitialTalkProject[],
  industryTags: string[]
): Promise<string[]> {
  if (projects.length === 0 || industryTags.length === 0) return []

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const projectInfo = projects.map(p => ({
    name: p.name,
    industry: p.industry,
    positioning: p.companyPosition,
    products: p.mainProducts,
  }))

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: '你是一个投融资领域的检索规划师。根据初聊项目的行业标签，生成用于搜索融资PR新闻的精准关键词。只返回JSON数组，不要其他内容。'
        },
        {
          role: 'user',
          content: `初聊项目列表：${JSON.stringify(projectInfo)}

行业标签：${industryTags.join('、')}

请生成 5-8 个检索关键词组合（中文），用于在搜索引擎中搜索近期的融资PR新闻。
关键词格式示例："商业航天 融资 2026"、"AI Agent A轮 投资"。
要求：
1. 每个关键词组合聚焦一个行业方向
2. 包含"融资"、"投资"、"获投"等融资相关词
3. 返回纯JSON数组，如 ["关键词1","关键词2"]`
        }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      thinking: { type: 'disabled' },
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`DeepSeek API 调用失败: ${response.status} ${errText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || '[]'

  // 提取 JSON 数组（容错：可能有 markdown 代码块）
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  const keywords: string[] = jsonMatch ? JSON.parse(jsonMatch[0]) : []

  return keywords.filter(k => typeof k === 'string' && k.trim().length > 0)
}

// ────────────────────────────────────────────────────────────
// 3. 双源搜索融资新闻（Tavily + DeepSeek web_search 比较 + 归纳）
// ────────────────────────────────────────────────────────────

async function searchTavily(query: string, count = 10): Promise<SearchResultItem[]> {
  // 双源搜索：Tavily 与 DeepSeek 官方 web_search 并行 → 比较完整度 → 合并归纳
  // 单边可用时（如 Tavily 配额耗尽）自动以单一来源为准
  let results: Array<{ title: string; url: string; content: string }>
  try {
    results = await searchWebDual(query, {
      maxResults: count,
      topic: 'news',        // 新闻搜索，返回融资PR相关内容
      days: 3,              // 只取近3天的新新闻（避免重复处理已处理的新闻）
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`双源搜索失败 [${query}]:`, msg)
    results = []
  }

  // content 即清洁正文（Tavily 单源或双源归纳后的结果），映射到 snippet 供 DeepSeek 抽取
  return results.map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }))
}

/**
 * 3b. Tavily Extract 全文获取（智能模式）
 *
 * 只对 snippet 过短（< 500 字符）的结果提取全文，避免浪费 credit。
 * - 每次 Extract 最多处理 5 个 URL（basic 模式 = 1 credit/5 URLs）
 * - 失败的 URL 保留原始 snippet，不影响后续流程
 * - 截断超长内容（避免 DeepSeek token 超限）
 *
 * @param results 搜索结果列表
 * @param topN 最多对前 topN 条结果提取全文（默认 5）
 * @returns 富化后的搜索结果（snippet 被替换为全文）
 */
async function extractFullContent(
  results: SearchResultItem[],
  topN = 5
): Promise<SearchResultItem[]> {
  if (results.length === 0) return results

  // 智能筛选：只对 snippet 过短的结果提取全文（节省 credit）
  const MIN_SNIPPET_LEN = 500
  const targets = results
    .slice(0, topN)
    .filter(r => r.snippet.length < MIN_SNIPPET_LEN)

  // 如果所有 snippet 都够长，跳过 Extract
  if (targets.length === 0) {
    console.log(`所有 snippet 均 >= ${MIN_SNIPPET_LEN} 字符，跳过 Extract`)
    return results
  }

  const urls = targets.map(r => r.url)

  try {
    const client = getTavilyClient()
    const res = await client.extract(urls, {
      extractDepth: 'basic',   // basic = 1 credit/5 URLs，advanced = 2 credits/5 URLs
      format: 'markdown',      // markdown 格式保留结构
    })

    // 构建 URL → 全文 的映射
    const contentMap = new Map<string, string>()
    for (const item of res.results) {
      const content = (item as any).rawContent as string | undefined
      if (content) {
        // 截断超长内容（DeepSeek max_tokens 限制，约 8000 字符 ≈ 4000 tokens）
        const truncated = content.length > 8000
          ? content.substring(0, 8000) + '...[内容截断]'
          : content
        contentMap.set(item.url, truncated)
      }
    }

    // 记录提取失败的 URL
    const failedResults = (res as any).failedResults as any[] | undefined
    if (failedResults && failedResults.length > 0) {
      console.warn(`Tavily Extract ${failedResults.length} 个 URL 提取失败，保留原始 snippet`)
    }

    // 用全文替换 snippet
    return results.map(r => {
      const fullContent = contentMap.get(r.url)
      return fullContent ? { ...r, snippet: fullContent } : r
    })
  } catch (error) {
    console.warn('Tavily Extract 失败，保留原始 snippet:', error instanceof Error ? error.message : error)
    return results  // 失败时返回原始结果，不阻断流程
  }
}

// ────────────────────────────────────────────────────────────
// 4. 用 DeepSeek 抽取结构化信息
// ────────────────────────────────────────────────────────────

/** 修复 DeepSeek 返回的常见 JSON 格式问题（尾随逗号、未转义引号等） */
function repairJson(text: string): string {
  let s = text.trim()
  // 移除 DeepSeek 思考标签
  s = s.replace(/<think>[\s\S]*?<\/think>/g, '')
  // 去除 markdown 代码块包裹
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  // 去除尾随逗号（],} 前的逗号）
  s = s.replace(/,\s*([}\]])/g, '$1')
  // 替换中文引号
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
  return s
}

async function extractLeadInfo(
  searchResults: SearchResultItem[],
  industryTags: string[]
): Promise<ExtractedLead[]> {
  if (searchResults.length === 0) return []

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  // 动态批大小：内容总长 > 15000 字符时减为 2 条/批，否则 5 条/批
  const avgLen = searchResults.reduce((s, r) => s + r.snippet.length, 0) / searchResults.length
  const batchSize = avgLen > 3000 ? 2 : 5

  const batches: SearchResultItem[][] = []
  for (let i = 0; i < searchResults.length; i += batchSize) {
    batches.push(searchResults.slice(i, i + batchSize))
  }

  const allLeads: ExtractedLead[] = []

  for (const batch of batches) {
    const input = batch.map((r, i) => ({
      index: i,
      title: r.title,
      url: r.url,
      snippet: r.snippet,
    }))

    // 超时控制：60 秒
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    let response: Response
    try {
      response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            {
              role: 'system',
              content: `你是一个专业的投融资信息抽取助手。从搜索结果中筛选出真正的融资PR新闻，并抽取结构化信息。
只返回JSON数组，不要其他内容。如果没有有效的融资新闻，返回空数组 []。
关注行业：${industryTags.join('、')}`
            },
            {
              role: 'user',
              content: `搜索结果列表：
${JSON.stringify(input, null, 2)}

请筛选出融资PR相关的新闻，并抽取以下信息：
- companyName: 公司全称（必填）
- companyPositioning: 公司定位（一句话描述）
- coreProducts: 核心产品列表（数组）
- coreAdvantages: 核心优势列表（数组）
- fundingRound: 融资轮次（如"天使轮"、"A轮"、"B轮"）
- fundingAmount: 融资金额（保留原始文本，如"5000万元"、"1亿美元"）
- valuation: 估值（保留原始文本）
- investors: 投资机构列表（数组）
- financialAdvisors: 财务顾问列表（数组）
- announceDate: 融资公布日期（YYYY-MM-DD格式，如未提及填null）
- industry: 所属行业
- summary: 融资事件摘要（50字内）

返回格式（纯JSON数组）：
[
  {
    "companyName": "公司名",
    "companyPositioning": "定位",
    "coreProducts": ["产品1"],
    "coreAdvantages": ["优势1"],
    "fundingRound": "A轮",
    "fundingAmount": "5000万元",
    "valuation": null,
    "investors": ["机构1"],
    "financialAdvisors": [],
    "announceDate": "2026-07-15",
    "industry": "AI应用",
    "summary": "摘要",
    "sourceIndex": 0
  }
]

注意：sourceIndex 是搜索结果中的索引，必须填写。`
            }
          ],
          temperature: 0.1,
          max_tokens: 4000,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timeoutId)
      console.warn(`DeepSeek 请求失败: ${e instanceof Error ? e.message : e}`)
      continue
    }
    clearTimeout(timeoutId)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.warn(`DeepSeek 抽取失败: ${response.status} ${errText.substring(0, 200)}`)
      continue
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || '[]'

    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) continue

    try {
      const repaired = repairJson(jsonMatch[0])
      const leads: Array<ExtractedLead & { sourceIndex?: number }> = JSON.parse(repaired)
      for (const lead of leads) {
        const idx = lead.sourceIndex ?? 0
        const source = batch[idx] || batch[0]
        allLeads.push({
          ...lead,
          sourceUrl: source.url,
          sourceTitle: source.title,
        })
      }
    } catch (e) {
      console.warn('解析 DeepSeek 返回的 JSON 失败:', e)
    }
  }

  return allLeads
}

// ────────────────────────────────────────────────────────────
// 5. 匹配初聊项目和维护人
// ────────────────────────────────────────────────────────────

function matchProject(
  leads: ExtractedLead[],
  initialTalkProjects: InitialTalkProject[]
): MatchedLead[] {
  return leads.map(lead => {
    let bestMatch: { projectId: string; confidence: number; maintainerId: string } | null = null

    for (const project of initialTalkProjects) {
      // 优先用名称相似度匹配
      const sim = similarity(lead.companyName, project.name)
      const isOverlap = isHighlyOverlapping(lead.companyName, project.name)

      // 行业匹配加分
      const industryMatch = lead.industry && project.industry &&
        (lead.industry === project.industry ||
         lead.industry.includes(project.industry) ||
         project.industry.includes(lead.industry))

      let confidence = sim
      if (isOverlap) confidence = Math.max(confidence, 0.85)
      if (industryMatch) confidence = Math.min(confidence + 0.1, 1.0)

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          projectId: project.id,
          confidence,
          maintainerId: project.createdById,
        }
      }
    }

    return {
      ...lead,
      matchedProjectId: bestMatch?.confidence >= 0.6 ? bestMatch!.projectId : null,
      matchedConfidence: bestMatch?.confidence || 0,
      matchedMaintainerId: bestMatch?.confidence >= 0.6 ? bestMatch!.maintainerId : null,
    }
  })
}

// ────────────────────────────────────────────────────────────
// 6. 保存线索到数据库
// ────────────────────────────────────────────────────────────

async function saveLeads(
  matchedLeads: MatchedLead[],
  triggeredById: string | null
): Promise<number> {
  let savedCount = 0
  const now = new Date()

  for (const lead of matchedLeads) {
    try {
      // 去重：检查是否已存在同名线索
      const existing = await prisma.projectLead.findFirst({
        where: {
          OR: [
            { name: lead.companyName },
            { sourceUrl: lead.sourceUrl },
          ],
        },
      })

      if (existing) continue

      // createdById 必须是真实用户ID：
      // 1. 优先用匹配到的维护人ID
      // 2. 其次用触发检索的用户ID
      // 3. 如果都没有，跳过（避免外键约束失败）
      const createdById = lead.matchedMaintainerId || triggeredById
      if (!createdById) {
        console.warn(`跳过线索 [${lead.companyName}]: 无可用 createdById`)
        continue
      }

      // 没有匹配到维护人的线索，立即释放给所有人可见
      const shouldRelease = !lead.matchedMaintainerId

      await prisma.projectLead.create({
        data: {
          name: lead.companyName,
          industry: lead.industry,
          companyPosition: lead.companyPositioning,
          mainProducts: lead.coreProducts.join('；'),
          financingHistory: lead.fundingRound
            ? `${lead.fundingRound}${lead.fundingAmount ? ' ' + lead.fundingAmount : ''}`
            : null,
          description: lead.summary,
          source: 'AI',
          fundingRound: lead.fundingRound,
          fundingAmount: lead.fundingAmount,
          valuation: lead.valuation,
          investors: JSON.stringify(lead.investors),
          financialAdvisors: JSON.stringify(lead.financialAdvisors),
          coreAdvantage: lead.coreAdvantages.join('；'),
          sourceUrl: lead.sourceUrl,
          sourceTitle: lead.sourceTitle,
          matchedProjectId: lead.matchedProjectId,
          matchedConfidence: lead.matchedConfidence,
          aiSummary: lead.summary,
          createdById,
          releasedAt: shouldRelease ? now : null,
        },
      })
      savedCount++
    } catch (e) {
      console.warn(`保存线索失败 [${lead.companyName}]:`, e)
    }
  }

  return savedCount
}

// ────────────────────────────────────────────────────────────
// 主函数：执行 AI 检索
// ────────────────────────────────────────────────────────────

export async function runAIRetrieval(triggeredById?: string): Promise<RetrievalResult> {
  const result: RetrievalResult = {
    totalFound: 0,
    totalSaved: 0,
    keywords: [],
    errors: [],
  }

  try {
    // 创建检索日志
    const log = await prisma.aIRetrievalLog.create({
      data: {
        status: 'RUNNING',
        triggeredById: triggeredById || null,
      },
    })

    try {
      // 1. 获取近3个月初聊项目
      const projects = await getInitialTalkProjects()
      if (projects.length === 0) {
        await prisma.aIRetrievalLog.update({
          where: { id: log.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            error: '没有近3个月的初聊项目',
          },
        })
        return result
      }

      // 提取行业标签（复用给关键词生成和信息抽取）
      const industryTags = Array.from(
        new Set(
          projects
            .map(p => p.industry)
            .filter((i): i is string => !!i && i.trim().length > 0)
        )
      )

      // 2. 生成检索关键词
      const keywords = await generateSearchKeywords(projects, industryTags)
      result.keywords = keywords

      if (keywords.length === 0) {
        await prisma.aIRetrievalLog.update({
          where: { id: log.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            keywords: JSON.stringify(keywords),
            error: '未生成有效关键词',
          },
        })
        return result
      }

      // 3. 并发搜索融资新闻（所有关键词同时搜索，提升速度）
      const searchPromises = keywords.map(kw =>
        searchTavily(kw, 10).catch(e => {
          result.errors.push(`搜索"${kw}"失败: ${e instanceof Error ? e.message : String(e)}`)
          return [] as SearchResultItem[]
        })
      )
      const searchResultsArrays = await Promise.all(searchPromises)
      const allSearchResults = searchResultsArrays.flat()

      // 去重（按URL）
      const uniqueResults = Array.from(
        allSearchResults.reduce((map, r) => {
          if (!map.has(r.url)) map.set(r.url, r)
          return map
        }, new Map<string, SearchResultItem>()).values()
      )

      result.totalFound = uniqueResults.length

      if (uniqueResults.length === 0) {
        await prisma.aIRetrievalLog.update({
          where: { id: log.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            keywords: JSON.stringify(keywords),
            foundCount: 0,
            savedCount: 0,
            error: result.errors.join('; ') || '未找到搜索结果',
          },
        })
        return result
      }

      // 3b. 对前 5 条结果智能提取全文（snippet 过短时才提取，节省 credit）
      const enrichedResults = await extractFullContent(uniqueResults, 5)

      // 4. 抽取结构化信息（复用已提取的 industryTags）
      const extractedLeads = await extractLeadInfo(enrichedResults, industryTags)

      // 5. 匹配初聊项目
      const matchedLeads = matchProject(extractedLeads, projects)

      // 6. 保存线索
      const savedCount = await saveLeads(matchedLeads, triggeredById || null)
      result.totalSaved = savedCount

      // 更新日志
      await prisma.aIRetrievalLog.update({
        where: { id: log.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          keywords: JSON.stringify(keywords),
          foundCount: uniqueResults.length,
          savedCount,
          error: result.errors.join('; ') || null,
        },
      })
    } catch (error) {
      // 更新日志为失败
      await prisma.aIRetrievalLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error))
  }

  return result
}

// ────────────────────────────────────────────────────────────
// 释放两周未转化的线索
// ────────────────────────────────────────────────────────────

export async function releaseExpiredLeads(): Promise<number> {
  const twoWeeksAgo = new Date()
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

  // 查找两周前创建、未转化、未释放的 AI 线索
  const leads = await prisma.projectLead.findMany({
    where: {
      source: 'AI',
      status: 'PENDING',
      releasedAt: null,
      createdAt: { lt: twoWeeksAgo },
    },
  })

  if (leads.length === 0) return 0

  const result = await prisma.projectLead.updateMany({
    where: { id: { in: leads.map(l => l.id) } },
    data: { releasedAt: new Date() },
  })

  return result.count
}
