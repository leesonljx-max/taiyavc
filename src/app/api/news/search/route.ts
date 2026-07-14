export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'
import { getWeekStart } from '@/lib/datetime'

/**
 * POST /api/news/search
 * 通过 DeepSeek API 检索各行业赛道的融资新闻
 *
 * 流程：
 * 1. 获取当年初聊项目涉及的所有行业
 * 2. 调用 DeepSeek 检索本周各行业的融资新闻
 * 3. 将结果存入 NewsArticle 表
 * 4. 返回本周新闻列表
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const body = await request.json().catch(() => ({}))
    const currentYear = new Date().getFullYear()
    const year = body.year ? parseInt(body.year, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    // 获取所有项目（带权限过滤）
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

    // 按初聊日期年份筛选
    const yearFilteredProjects = visibleProjects.filter(
      p => p.targetDate && new Date(p.targetDate).getFullYear() === validYear
    )

    // 提取所有行业（去重）
    const industriesSet = new Set<string>()
    yearFilteredProjects.forEach(p => {
      const ind = p.industry?.trim()
      if (ind) industriesSet.add(ind)
    })

    const industries = Array.from(industriesSet)

    // 获取自定义关键字和来源
    const [customKeywords, customSources] = await Promise.all([
      prisma.newsKeyword.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.newsSource.findMany({ orderBy: { createdAt: 'desc' } }),
    ])

    // 默认来源 + 自定义来源
    const defaultSources = ['36氪', '投资界', '硬氪', '腾讯科技', '投中网', 'AI科技评论', 'DeepTech', '光子盒', '量子位', '智东西', 'Founder Park', 'Z potentials', '高瓴创投', '线性资本']
    const allSources = Array.from(new Set([...defaultSources, ...customSources.map(s => s.name)]))
    const customKeywordsList = customKeywords.map(k => k.keyword)

    if (industries.length === 0 && customKeywordsList.length === 0) {
      return NextResponse.json({
        message: '该年份暂无行业数据且无自定义关键字，无法检索融资新闻',
        articles: [],
        industries: [],
      })
    }

    // 调用 DeepSeek API 检索融资新闻
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY
    if (!deepseekApiKey) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置，无法检索新闻' },
        { status: 500 }
      )
    }

    const weekStart = getWeekStart()
    const todayStr = new Date().toISOString().split('T')[0]
    // 最近7天的起始日期（用于过滤发布时间）
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]

    // 构建检索内容：行业赛道 + 自定义关键字
    const searchTopics = [
      ...industries,
      ...customKeywordsList,
    ]

    const prompt = `你是一个资深的投资行业新闻编辑，擅长检索和整理融资新闻。请根据以下检索主题，检索最近一周（${sevenDaysAgoStr} 至 ${todayStr}）的融资新闻和技术进展新闻。

待检索的主题/关键字：${searchTopics.join('、')}

重点关注以下来源的公众号文章：
${allSources.map(s => `- ${s}`).join('\n')}

任务要求：
1. 针对 EACH 主题/关键字，检索最近一周（${sevenDaysAgoStr} 至 ${todayStr}）发布的融资相关新闻文章（2-5篇）
2. 每篇文章提供以下信息：
   - title: 文章标题
   - source: 来源（如 36氪、投资界、量子位等）
   - sourceUrl: 原文链接（如有）
   - industry: 所属行业或关键字
   - summary: 摘要（50-100字，用于卡片展示）
   - content: 详细内容（200-500字，包含融资方、投资方、金额、轮次等关键信息）
   - author: 作者（如有）
   - publishedAt: 发布日期（ISO 格式，如 ${todayStr}）
3. 文章应聚焦融资事件（融资轮次、金额、投资方）或技术进展，而非一般行业资讯
4. **重要：每篇文章的 publishedAt 必须在 ${sevenDaysAgoStr} 至 ${todayStr} 范围内，不要包含超过7天的旧文章**
5. 若某主题本周无相关新闻，可跳过该主题

请严格按照以下 JSON 格式输出，不要包含任何其他文字：
{
  "articles": [
    {
      "title": "文章标题",
      "source": "36氪",
      "sourceUrl": "https://...",
      "industry": "人工智能",
      "summary": "摘要内容",
      "content": "详细内容",
      "author": "作者名",
      "publishedAt": "${todayStr}"
    }
  ]
}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    let response: Response
    try {
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: '你是一个专业的投资行业新闻编辑，擅长检索和整理各行业赛道的融资新闻。请基于公开信息作答，重点关注指定来源的公众号文章。',
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
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        articles = parsed.articles || []
      }
    } catch {
      console.error('Failed to parse DeepSeek response:', content)
    }

    // 存入数据库（批量插入提升性能）
    // 过滤：仅保存最近7天内发布的文章
    const articlesToCreate = []
    for (const article of articles) {
      const publishedDate = new Date(article.publishedAt)
      if (isNaN(publishedDate.getTime())) continue
      // 仅保存最近7天内的文章
      if (publishedDate < sevenDaysAgo) continue
      articlesToCreate.push({
        title: article.title,
        source: article.source,
        sourceUrl: article.sourceUrl || null,
        industry: article.industry,
        summary: article.summary,
        content: article.content,
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

    // 查询最近7天已保存的文章返回给前端
    const savedArticles = await prisma.newsArticle.findMany({
      where: {
        publishedAt: { gte: sevenDaysAgo },
      },
      orderBy: { publishedAt: 'desc' },
    })

    return NextResponse.json({
      message: `检索完成，共找到 ${createdCount} 篇融资新闻`,
      articles: savedArticles,
      industries,
      weekStart: weekStart.toISOString(),
    })
  } catch (error) {
    console.error('News search API error:', error)
    return NextResponse.json(
      { error: '检索新闻失败' },
      { status: 500 }
    )
  }
}
