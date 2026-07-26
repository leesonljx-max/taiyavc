export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'
import { getWeekStart } from '@/lib/datetime'
import { searchWeb } from '@/lib/tavily-search'

/**
 * GET /api/news/search?year=2026
 * 返回本周新闻监控的缓存数据（所有用户共享）
 *
 * POST /api/news/search
 * 刷新：Tavily 搜索各行业本周融资新闻 → DeepSeek 提取归纳 → 缓存 + 入库
 *
 * 缓存策略：
 * - cacheKey 形如 `news:2026-W30`（按年份+ISO周）
 * - 任何账号刷新后，所有账号可见，直到下次刷新覆盖
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

/** 获取当前用户可见项目涉及的行业 */
async function getVisibleIndustries(currentUser: PermissionUser, year: number) {
  const allProjects = await prisma.project.findMany({
    select: {
      industry: true,
      targetDate: true,
      followStage: true,
      createdById: true,
      members: { select: { userId: true } },
    },
  })

  const visibleProjects = allProjects.filter(project => {
    const memberIds = project.members.map(m => m.userId)
    return canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })
  })

  const yearFiltered = visibleProjects.filter(
    p => p.targetDate && new Date(p.targetDate).getFullYear() === year
  )

  const industriesSet = new Set<string>()
  yearFiltered.forEach(p => {
    const ind = p.industry?.trim()
    if (ind) industriesSet.add(ind)
  })

  return Array.from(industriesSet)
}

/** JSON 修复：处理 DeepSeek 返回的常见格式问题 */
function repairJson(text: string): string {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    const weekKey = getISOWeekKey(new Date())
    const cacheKey = `news:${weekKey}`

    const cached = await prisma.aICache.findUnique({ where: { cacheKey } })

    if (cached) {
      const cachedData = JSON.parse(cached.data)
      return NextResponse.json({
        ...cachedData,
        cachedAt: cached.updatedAt,
        weekKey,
      })
    }

    // 无缓存，提示用户刷新
    return NextResponse.json({
      message: '暂无本周新闻数据，请点击刷新按钮检索',
      articles: [],
      industries: [],
      weekKey,
    })
  } catch (error) {
    console.error('News search GET error:', error)
    return NextResponse.json(
      { error: '获取新闻缓存失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const body = await request.json().catch(() => ({}))
    const currentYear = new Date().getFullYear()
    const year = body.year ? parseInt(body.year, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    // 1. 获取行业列表
    const industries = await getVisibleIndustries(currentUser, validYear)

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

    if (industries.length === 0 && customKeywordsList.length === 0) {
      return NextResponse.json({
        message: '该年份暂无行业数据且无自定义关键字，无法检索融资新闻',
        articles: [],
        industries: [],
      })
    }

    // 3. 用 Tavily 并发检索各主题的本周新闻
    const searchTopics = [...industries, ...customKeywordsList]
    const searchPromises = searchTopics.map(topic =>
      searchWeb(`${topic} 融资 投资本周`, {
        maxResults: 5,
        topic: 'news',
        days: 7,
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
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置' },
        { status: 500 }
      )
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
          max_tokens: 4000,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('DeepSeek API error:', errorText)
      return NextResponse.json(
        { error: 'DeepSeek API 调用失败' },
        { status: 502 }
      )
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
    } catch {
      console.error('Failed to parse DeepSeek response:', content)
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
        console.error('Failed to bulk save articles:', e)
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
    const cacheData = JSON.stringify({
      message: `检索完成，共找到 ${createdCount} 篇融资新闻`,
      articles: savedArticles,
      industries,
      weekStart: weekStart.toISOString(),
      refreshedAt: new Date().toISOString(),
      searchResultsCount: searchArrays.flat().length,
    })

    await prisma.aICache.upsert({
      where: { cacheKey },
      create: { cacheKey, data: cacheData },
      update: { data: cacheData },
    })

    return NextResponse.json({
      message: `检索完成，共找到 ${createdCount} 篇融资新闻`,
      articles: savedArticles,
      industries,
      weekStart: weekStart.toISOString(),
      weekKey,
      refreshedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('News search POST error:', error)
    return NextResponse.json(
      { error: '检索新闻失败' },
      { status: 500 }
    )
  }
}
