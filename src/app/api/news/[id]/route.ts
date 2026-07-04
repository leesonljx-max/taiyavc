import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/news/[id]
 * 获取新闻详情
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const article = await prisma.newsArticle.findUnique({
      where: { id: params.id },
    })

    if (!article) {
      return NextResponse.json(
        { error: '新闻不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json({ article })
  } catch (error) {
    console.error('News detail API error:', error)
    return NextResponse.json(
      { error: '获取新闻详情失败' },
      { status: 500 }
    )
  }
}
