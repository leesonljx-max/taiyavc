export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTokenUsageByDateRange, todayKey } from '@/lib/token-accounting'

/**
 * GET /api/token-usage?startDate=2026-08-01&endDate=2026-08-31
 *
 * 返回日期范围内各模块每天的 token 消耗（AI 看板日历热力图数据源）
 * 登录即可查看（全员可见，便于成本意识）
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const url = new URL(request.url)
    const today = todayKey()
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/

    // 默认：本月
    const monthStart = today.substring(0, 8) + '01'
    let startDate = url.searchParams.get('startDate') || monthStart
    let endDate = url.searchParams.get('endDate') || today

    if (!dateRegex.test(startDate)) startDate = monthStart
    if (!dateRegex.test(endDate)) endDate = today

    // 范围保护：最多 92 天（3个月）
    const start = new Date(`${startDate}T00:00:00`)
    const end = new Date(`${endDate}T00:00:00`)
    if (end < start) {
      return NextResponse.json({ error: 'endDate 不能早于 startDate' }, { status: 400 })
    }
    const spanDays = (end.getTime() - start.getTime()) / 86_400_000
    if (spanDays > 92) {
      return NextResponse.json({ error: '查询范围最多 92 天' }, { status: 400 })
    }

    const days = await getTokenUsageByDateRange(startDate, endDate)

    // 汇总
    let totalInput = 0
    let totalOutput = 0
    const moduleTotals: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {}
    for (const d of days) {
      totalInput += d.totalInput
      totalOutput += d.totalOutput
      for (const [m, v] of Object.entries(d.modules)) {
        const t = moduleTotals[m] || { inputTokens: 0, outputTokens: 0, calls: 0 }
        t.inputTokens += v.inputTokens
        t.outputTokens += v.outputTokens
        t.calls += v.calls
        moduleTotals[m] = t
      }
    }

    return NextResponse.json({
      startDate,
      endDate,
      days,
      summary: {
        totalInput,
        totalOutput,
        totalTokens: totalInput + totalOutput,
        moduleTotals,
      },
    })
  } catch (error) {
    console.error('Token usage GET error:', error)
    return NextResponse.json({ error: '获取 token 消耗数据失败' }, { status: 500 })
  }
}
