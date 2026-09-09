export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeCronRequest, unauthorizedResponse } from '@/lib/cron-auth'
import { runDueSignals } from '@/lib/signal-tracker'

/**
 * 定时执行到期的跟踪信号
 *
 * GET /api/cron/tracking-signals?token=XXX
 * POST /api/cron/tracking-signals  (Body: { token: "XXX" })
 *
 * 定时计划：每天上午 06:00（DAILY 信号每天跑；WEEKLY 信号周一跑）
 * 使用方式（Linux crontab）：
 *   0 6 * * * curl -s --max-time 600 "http://localhost:3000/api/cron/tracking-signals?token=$CRON_SECRET"
 */
export async function GET(request: Request) {
  try {
    if (!authorizeCronRequest(request)) {
      return unauthorizedResponse()
    }

    console.log('[Cron] 跟踪信号执行开始:', new Date().toISOString())
    const results = await runDueSignals()
    const totalSaved = results.reduce((n, r) => n + r.savedCount, 0)
    const failed = results.filter(r => r.error).length
    console.log(
      `[Cron] 跟踪信号执行完成: ${results.length} 个信号，新增 ${totalSaved} 条线索${failed > 0 ? `，${failed} 个失败` : ''}`
    )

    return NextResponse.json({
      success: true,
      executed: results.length,
      totalSaved,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] 跟踪信号执行失败:', error)
    return NextResponse.json(
      { error: '跟踪信号执行失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return GET(request)
}
