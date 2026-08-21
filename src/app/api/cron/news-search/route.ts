export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authorizeCronRequest, unauthorizedResponse } from '@/lib/cron-auth'
import { searchWebDual } from '@/lib/tavily-search'
import { getWeekStart } from '@/lib/datetime'

/**
 * 定时检索近期初聊项目相关融资新闻
 *
 * GET /api/cron/news-search?token=XXX
 * POST /api/cron/news-search  (Body: { token: "XXX" })
 *
 * 定时计划：每天早上 7:00 执行
 * 使用方式（Linux crontab）：
 *   0 7 * * * curl -s "http://localhost:3000/api/cron/news-search?token=$CRON_SECRET"
 *
 * 检索范围：
 * - 近 3 个月内（90 天）初聊阶段（INITIAL_TALK）的项目
 * - 提取这些项目的行业、名称、公司定位作为搜索关键词
 * - 所有人可见
 *
 * 缓存策略：
 * - 检索结果写入 NewsArticle 表（所有人可见）
 * - 同时写入 AICache（cacheKey = news:YYYY-Www）供前端快速读取
 */

/** 获取 ISO 周号（YYYY-Www） */
function getISOWeekKey(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** JSON 修复：处理 DeepSeek 返回的常见格式问题 */
function repairJson(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')  // 移除 DeepSeek 思考标签
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
}

/**
 * 获取近 3 个月内初聊阶段项目相关的搜索关键词
 * 返回：行业列表 + 项目名称列表 + 公司定位列表
 */
async function getRecentInitialTalkKeywords(): Promise<{
  industries: string[]
  projectNames: string[]
  companyPositions: string[]
  projectCount: number
}> {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90)

  // 查询近 3 个月内初聊阶段的项目
  const recentProjects = await prisma.project.findMany({
    where: {
      followStage: 'INITIAL_TALK',
      targetDate: { gte: threeMonthsAgo },
    },
    select: {
      name: true,
      industry: true,
      companyPosition: true,
      targetDate: true,
    },
  })

  const industriesSet = new Set<string>()
  const projectNamesSet = new Set<string>()
  const companyPositionsSet = new Set<string>()

  recentProjects.forEach(p => {
    if (p.industry?.trim()) industriesSet.add(p.industry.trim())
    if (p.name?.trim()) projectNamesSet.add(p.name.trim())
    if (p.companyPosition?.trim()) companyPositionsSet.add(p.companyPosition.trim())
  })

  return {
    industries: Array.from(industriesSet),
    projectNames: Array.from(projectNamesSet),
    companyPositions: Array.from(companyPositionsSet),
    projectCount: recentProjects.length,
  }
}

/**
 * 执行新闻检索
 */
async function searchNews(): Promise<{
  success: boolean
  searchedCount: number
  createdCount: number
  message: string
}> {
  // 1. 获取近 3 个月初聊项目的关键词
  const { industries, projectNames, companyPositions, projectCount } = await getRecentInitialTalkKeywords()

  // 2. 获取自定义关键字和来源
  const [customKeywords, customSources] = await Promise.all([
    prisma.newsKeyword.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.newsSource.findMany({ orderBy: { createdAt: 'desc' } }),
  ])

  const customKeywordsList = customKeywords.map(k => k.keyword)
  const defaultSources = [
    '36氪', '投资界', '硬氪', '腾讯科技', '投中网',
    'AI科技评论', 'DeepTech', '光子盒', '量子位',
    '智东西', 'Founder Park', 'Z potentials',
  ]
  const allSources = Array.from(new Set([
    ...defaultSources,
    ...customSources.map(s => s.name),
  ]))

  // 搜索主题：行业 + 项目名称 + 公司定位 + 自定义关键字
  // 限制数量避免过多请求（最多 20 个主题）
  const searchTopics = [
    ...industries,
    ...projectNames.slice(0, 5),  // 限制项目名称数量
    ...companyPositions.slice(0, 3),
    ...customKeywordsList,
  ].slice(0, 20)

  if (searchTopics.length === 0) {
    return {
      success: false,
      searchedCount: 0,
      createdCount: 0,
      message: `近 3 个月暂无初聊项目且无自定义关键字，跳过新闻检索（项目数: ${projectCount}）`,
    }
  }

  console.log(`[Cron news-search] 搜索主题: ${searchTopics.length} 个，近 3 个月初聊项目: ${projectCount} 个`)

  // 3. 收集型并发检索各主题的本周新闻（Tavily 主力 + DeepSeek 降级备份，自动缓存）
  const searchPromises = searchTopics.map(topic =>
    searchWebDual(`${topic} 融资 投资`, {
      maxResults: 5,
      topic: 'news',
      days: 7,
      mode: 'collect',
      module: 'news',
    })
  )
  const searchArrays = await Promise.all(searchPromises)

  // 按主题聚合搜索结果
  const topicResults = searchTopics.map((topic, i) => ({
    topic,
    results: searchArrays[i],
  }))

  // 4. 构建 DeepSeek 提取 prompt
  const weekStart = getWeekStart()
  const todayStr = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]

  const searchInfoText = topicResults
    .map(({ topic, results }) => {
      if (results.length === 0) {
        return `【${topic}】\n未找到相关搜索结果`
      }
      const snippets = results
        .map((r, j) => `[${j + 1}] ${r.title}\n来源: ${r.url}\n内容: ${r.content.substring(0, 400)}`)
        .join('\n')
      return `【${topic}】\n${snippets}`
    })
    .join('\n\n')

  const deepseekApiKey = process.env.DEEPSEEK_API_KEY
  if (!deepseekApiKey) {
    return {
      success: false,
      searchedCount: searchTopics.length,
      createdCount: 0,
      message: 'DeepSeek API Key 未配置',
    }
  }

  const prompt = `你是一个资深的投资行业新闻编辑。请根据以下各主题的外网搜索结果，整理出本周（${sevenDaysAgoStr} 至 ${todayStr}）的融资新闻文章。

外网搜索结果：
${searchInfoText}

重点关注以下来源：${allSources.join('、')}

任务要求：
1. 基于搜索结果提取融资相关新闻文章（每个主题 0-5 篇）
2. 每篇文章提供以下信息：
   - title: 文章标题（基于搜索结果生成，不要照搬原始标题）
   - source: 来源（如 36氪、投资界、量子位等，从搜索结果URL推断）
   - sourceUrl: 原文链接（来自搜索结果）
   - industry: 所属行业或关键字
   - summary: 摘要（50-100字，用于卡片展示）
   - content: 详细内容（200-500字，包含融资方、投资方、金额、轮次等关键信息）
   - author: 作者（如有，否则留空字符串）
   - publishedAt: 发布日期（ISO 格式 YYYY-MM-DD，必须在 ${sevenDaysAgoStr} 至 ${todayStr} 范围内）
3. 仅保留融资事件（融资轮次、金额、投资方）或重要技术进展类新闻
4. **重要：publishedAt 必须在 ${sevenDaysAgoStr} 至 ${todayStr} 范围内**
5. 若某主题本周无相关新闻，可跳过该主题
6. 不要编造数据，所有信息应基于搜索结果

请严格按以下 JSON 格式输出，不要包含任何其他文字：
{
  "articles": [
    {
      "title": "文章标题",
      "source": "36氪",
      "sourceUrl": "https://...",
      "industry": "人工智能",
      "summary": "摘要内容",
      "content": "详细内容",
      "author": "",
      "publishedAt": "${todayStr}"
    }
  ]
}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  let response: Response
  try {
    response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          {
            role: 'system',
            content: '你是一个专业的投资行业新闻编辑，擅长从搜索结果中提取并整理融资新闻。请严格基于搜索结果作答，不要编造数据。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.4,
        max_tokens: 8000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Cron news-search] DeepSeek API error:', errorText)
    return {
      success: false,
      searchedCount: searchTopics.length,
      createdCount: 0,
      message: `DeepSeek API 调用失败: ${response.status}`,
    }
  }

  const aiData = await response.json()
  const content = aiData.choices?.[0]?.message?.content || ''

  // 解析 AI 返回的 JSON
  let articles: Array<{
    title: string
    source: string
    sourceUrl?: string
    industry: string
    summary: string
    content: string
    author?: string
    publishedAt: string
  }> = []

  try {
    const repaired = repairJson(content)
    const jsonMatch = repaired.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      articles = parsed.articles || []
    }
    if (articles.length === 0) {
      console.error('[Cron news-search] DeepSeek 返回内容前500字符:', content.substring(0, 500))
    }
  } catch {
    console.error('[Cron news-search] Failed to parse DeepSeek response, 前500字符:', content.substring(0, 500))
  }

  // 5. 过滤并入库（仅保存最近7天内发布的文章）
  const articlesToCreate = []
  for (const article of articles) {
    if (!article.title || !article.publishedAt) continue
    const publishedDate = new Date(article.publishedAt)
    if (isNaN(publishedDate.getTime())) continue
    if (publishedDate < sevenDaysAgo) continue

    articlesToCreate.push({
      title: article.title,
      source: article.source || '未知来源',
      sourceUrl: article.sourceUrl || null,
      industry: article.industry || '未分类',
      summary: article.summary || '',
      content: article.content || '',
      author: article.author || null,
      publishedAt: publishedDate,
      weekStart: weekStart,
    })
  }

  let createdCount = 0
  if (articlesToCreate.length > 0) {
    try {
      const result = await prisma.newsArticle.createMany({
        data: articlesToCreate,
        skipDuplicates: true,
      })
      createdCount = result.count
    } catch (e) {
      console.error('[Cron news-search] Failed to bulk save articles:', e)
    }
  }

  // 6. 查询本周已保存的文章
  const savedArticles = await prisma.newsArticle.findMany({
    where: {
      publishedAt: { gte: sevenDaysAgo },
    },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true,
      title: true,
      source: true,
      sourceUrl: true,
      industry: true,
      summary: true,
      author: true,
      publishedAt: true,
      weekStart: true,
    },
  })

  // 7. 缓存结果（按周缓存，所有账号共享）
  const weekKey = getISOWeekKey(new Date())
  const cacheKey = `news:${weekKey}`
  const allIndustries = Array.from(new Set(savedArticles.map(a => a.industry)))
  const cacheData = JSON.stringify({
    message: `检索完成，共找到 ${createdCount} 篇融资新闻`,
    articles: savedArticles,
    industries: allIndustries,
    weekStart: weekStart.toISOString(),
    refreshedAt: new Date().toISOString(),
    searchResultsCount: searchArrays.flat().length,
  })

  await prisma.aICache.upsert({
    where: { cacheKey },
    create: { cacheKey, data: cacheData },
    update: { data: cacheData },
  })

  return {
    success: true,
    searchedCount: searchTopics.length,
    createdCount,
    message: `新闻检索完成：搜索 ${searchTopics.length} 个主题，新增 ${createdCount} 篇文章，本周共 ${savedArticles.length} 篇（近 3 个月初聊项目 ${projectCount} 个）`,
  }
}

export async function GET(request: Request) {
  try {
    if (!authorizeCronRequest(request)) {
      return unauthorizedResponse()
    }

    console.log('[Cron] 新闻检索开始:', new Date().toISOString())
    const result = await searchNews()
    console.log('[Cron] 新闻检索完成:', result.message)

    return NextResponse.json({
      success: result.success,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] 新闻检索失败:', error)
    return NextResponse.json(
      { success: false, error: '新闻检索失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    if (!authorizeCronRequest(request)) {
      return unauthorizedResponse()
    }

    console.log('[Cron] 新闻检索开始 (POST):', new Date().toISOString())
    const result = await searchNews()
    console.log('[Cron] 新闻检索完成:', result.message)

    return NextResponse.json({
      success: result.success,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] 新闻检索失败:', error)
    return NextResponse.json(
      { success: false, error: '新闻检索失败' },
      { status: 500 }
    )
  }
}
