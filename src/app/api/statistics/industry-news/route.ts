export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getIndustryNews,
  runIndustryNews,
  getTopIndustries,
  todayKey,
  TOP_N,
} from '@/lib/industry-news-runner'

/**
 * GET /api/statistics/industry-news
 * 获取当日行业动态卡片（前十行业，缓存来自每日 04:00 cron）
 *
 * POST /api/statistics/industry-news
 * 即时分析：body { industries?: string[], force?: boolean }
 * - 不传 industries：补齐前十行业中缓存缺失的（每日 cron 失败兜底）
 * - 传 industries: ['具身智能']：即时分析指定行业（点击气泡触发）
 * - force: 忽略缓存重新分析
 */

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const result = await getIndustryNews()
    const topIndustries = await getTopIndustries(TOP_N)

    return NextResponse.json({
      date: result.date,
      cards: result.cards,
      running: result.running,
      topIndustries,
    })
  } catch (error) {
    console.error('Industry news GET error:', error)
    return NextResponse.json({ error: '获取行业动态失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const industries = Array.isArray(body.industries)
      ? body.industries
          .filter((i: unknown) => typeof i === 'string' && i.trim())
          .map((i: string) => i.trim().slice(0, 50))
          .slice(0, 5)
      : undefined
    const force = body.force === true

    // 即时分析：同步等待完成（单行业 3-5 次搜索 + 1 次分析，约 20-40 秒）
    const result = await runIndustryNews({ industries, force })

    return NextResponse.json({
      date: result.date,
      analyzed: result.analyzed,
      cards: result.cards,
    })
  } catch (error) {
    console.error('Industry news POST error:', error)
    return NextResponse.json({ error: '行业动态分析失败' }, { status: 500 })
  }
}
