export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { releaseExpiredLeads } from '@/lib/ai-lead-retrieval'

/**
 * 定时释放两周未转化的 AI 线索
 *
 * GET /api/cron/release-leads?token=XXX
 * POST /api/cron/release-leads  (Body: { token: "XXX" })
 *
 * 通过 CRON_SECRET 环境变量校验，避免外部随意触发
 *
 * 使用方式（Linux crontab）：
 *   0 1 * * * curl -s "https://your-domain/api/cron/release-leads?token=$CRON_SECRET"
 *
 * 或使用 Vercel Cron / 外部 cron 服务调用
 */

function authorize(request: Request): boolean {
  const token = process.env.CRON_SECRET
  if (!token) {
    // 未配置 CRON_SECRET 时拒绝访问
    return false
  }

  // 优先从 query 读取
  const url = new URL(request.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken === token) return true

  // 其次从 Authorization header 读取
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${token}`) return true

  return false
}

export async function GET(request: Request) {
  try {
    if (!authorize(request)) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    const releasedCount = await releaseExpiredLeads()

    return NextResponse.json({
      success: true,
      releasedCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Cron release leads error:', error)
    return NextResponse.json(
      { error: '释放线索失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    if (!authorize(request)) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    const releasedCount = await releaseExpiredLeads()

    return NextResponse.json({
      success: true,
      releasedCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Cron release leads error:', error)
    return NextResponse.json(
      { error: '释放线索失败' },
      { status: 500 }
    )
  }
}
