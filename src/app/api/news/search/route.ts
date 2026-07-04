import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'

/**
 * 计算本周起始时间（每周一中午12:00）
 */
function getWeekStart(): Date {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMonday)
  monday.setHours(12, 0, 0, 0)
  if (dayOfWeek === 1 && now.getHours() < 12) {
    monday.setDate(monday.getDate() - 7)
  }
  return monday
}

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

    if (industries.length === 0) {
      return NextResponse.json({
        message: '该年份暂无行业数据，无法检索融资新闻',
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
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)
    const todayStr = new Date().toISOString().split('T')[0]

    const prompt = `你是一个资深的投资行业新闻编辑，擅长检索和整理融资新闻。请根据以下行业列表，检索本周（${weekStart.toISOString().split('T')[0]} 至 ${todayStr}）各行业的融资新闻。

待检索的行业赛道：${industries.join('、')}

重点关注以下来源的公众号文章：
- 36氪、投资界、硬氪、腾讯科技、投中网
- AI科技评论、DeepTech、光子盒、量子位
- 智东西、Founder Park、Z potentials
- 高瓴创投、线性资本

任务要求：
1. 针对 EACH 行业，检索本周发布的融资相关新闻文章（2-5篇）
2. 每篇文章提供以下信息：
   - title: 文章标题
   - source: 来源（如 36氪、投资界、量子位等）
   - sourceUrl: 原文链接（如有）
   - industry: 所属行业
   - summary: 摘要（50-100字，用于卡片展示）
   - content: 详细内容（200-500字，包含融资方、投资方、金额、轮次等关键信息）
   - author: 作者（如有）
   - publishedAt: 发布日期（ISO 格式，如 2026-07-01）
3. 文章应聚焦融资事件（融资轮次、金额、投资方），而非一般行业资讯
4. 若某行业本周无融资新闻，可跳过该行业

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
      "publishedAt": "2026-07-01"
    }
  ]
}`

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('DeepSeek API error:', errorText)
      return NextResponse.json(
        { error: 'DeepSeek API 调用失败', detail: errorText },
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

    // 存入数据库
    const createdArticles = []
    for (const article of articles) {
      try {
        const publishedDate = new Date(article.publishedAt)
        if (isNaN(publishedDate.getTime())) continue

        const created = await prisma.newsArticle.create({
          data: {
            title: article.title,
            source: article.source,
            sourceUrl: article.sourceUrl || null,
            industry: article.industry,
            summary: article.summary,
            content: article.content,
            author: article.author || null,
            publishedAt: publishedDate,
            weekStart: weekStart,
          },
        })
        createdArticles.push(created)
      } catch (e) {
        console.error('Failed to save article:', e)
      }
    }

    return NextResponse.json({
      message: `检索完成，共找到 ${createdArticles.length} 篇融资新闻`,
      articles: createdArticles,
      industries,
      weekStart: weekStart.toISOString(),
    })
  } catch (error) {
    console.error('News search API error:', error)
    return NextResponse.json(
      { error: '检索新闻失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
