export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeCronRequest, unauthorizedResponse } from '@/lib/cron-auth'
import { runDailyIndustryNews } from '@/lib/industry-news-runner'

/**
 * 每日收集前十行业动态（统计分析页「行业动态」）
 *
 * GET /api/cron/industry-news?token=XXX
 * POST /api/cron/industry-news  (Body: { token: "XXX" })
 *
 * 定时计划：每天上午 04:00
 * 使用方式（Linux crontab）：
 *   0 4 * * * curl -s "http://localhost:3000/api/cron/industry-news?token=$CRON_SECRET"
 *
 * 行业来源：行业图谱项目数量排名前十的行业（当年）
 * 结果缓存：AICache（cacheKey = industry-news:YYYY-MM-DD），所有用户共享
 */

export async function GET(request: Request) {
  try {
    if (!authorizeCronRequest(request)) {
      return unauthorizedResponse()
    }

    console.log('[Cron] 行业动态收集开始:', new Date().toISOString())
    const result = await runDailyIndustryNews()
    console.log('[Cron] 行业动态收集完成')

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] 行业动态收集失败:', error)
    return NextResponse.json(
      { success: false, error: '行业动态收集失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    if (!authorizeCronRequest(request)) {
      return unauthorizedResponse()
    }

    console.log('[Cron] 行业动态收集开始 (POST):', new Date().toISOString())
    const result = await runDailyIndustryNews()
    console.log('[Cron] 行业动态收集完成')

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] 行业动态收集失败:', error)
    return NextResponse.json(
      { success: false, error: '行业动态收集失败' },
      { status: 500 }
    )
  }
}
