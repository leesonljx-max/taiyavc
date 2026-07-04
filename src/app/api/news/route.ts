import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

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
 * GET /api/news
 * 获取新闻列表，默认返回本周新闻
 *
 * 查询参数：
 * - week: 'current' (默认) | 'all' — 本周或全部
 * - industry: 行业筛选
 * - source: 来源筛选
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const week = searchParams.get('week') || 'current'
    const industry = searchParams.get('industry')
    const source = searchParams.get('source')

    const where: {
      weekStart?: { gte: Date }
      industry?: string
      source?: string
    } = {}

    if (week === 'current') {
      where.weekStart = { gte: getWeekStart() }
    }

    if (industry && industry !== 'all') {
      where.industry = industry
    }

    if (source && source !== 'all') {
      where.source = source
    }

    const articles = await prisma.newsArticle.findMany({
      where,
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

    // 获取所有行业和来源（用于筛选器）
    const allArticles = await prisma.newsArticle.findMany({
      select: { industry: true, source: true },
    })
    const industriesSet = new Set<string>()
    const sourcesSet = new Set<string>()
    allArticles.forEach(a => {
      industriesSet.add(a.industry)
      sourcesSet.add(a.source)
    })

    return NextResponse.json({
      articles,
      industries: Array.from(industriesSet).sort(),
      sources: Array.from(sourcesSet).sort(),
      total: articles.length,
      weekStart: week === 'current' ? getWeekStart().toISOString() : null,
    })
  } catch (error) {
    console.error('News list API error:', error)
    return NextResponse.json(
      { error: '获取新闻列表失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
