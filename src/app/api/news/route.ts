import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/news
 * 获取新闻列表，仅返回最近7天内发布的文章
 *
 * 查询参数：
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
    const industry = searchParams.get('industry')
    const source = searchParams.get('source')

    const where: {
      publishedAt?: { gte: Date }
      industry?: string
      source?: string
    } = {}

    // 仅返回最近7天内发布的文章
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    where.publishedAt = { gte: sevenDaysAgo }

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

    // 获取所有行业和来源（用于筛选器，仅从最近7天的文章中提取）
    const allArticles = await prisma.newsArticle.findMany({
      where: { publishedAt: { gte: sevenDaysAgo } },
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
    })
  } catch (error) {
    console.error('News list API error:', error)
    return NextResponse.json(
      { error: '获取新闻列表失败' },
      { status: 500 }
    )
  }
}
