export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { runAIRetrieval } from '@/lib/ai-lead-retrieval'

/**
 * 定时触发 AI 线索检索
 *
 * GET /api/cron/ai-leads-retrieval?token=XXX
 * POST /api/cron/ai-leads-retrieval  (Body: { token: "XXX" })
 *
 * 通过 CRON_SECRET 环境变量校验，避免外部随意触发
 *
 * 定时计划：每周一、周三、周五早上 8:00
 *
 * 使用方式（Linux crontab）：
 *   0 8 * * 1,3,5 curl -s "http://localhost:3000/api/cron/ai-leads-retrieval?token=$CRON_SECRET"
 *
 * 或使用 Vercel Cron / 外部 cron 服务调用
 */

function authorize(request: Request): boolean {
  const token = process.env.CRON_SECRET
  if (!token) {
    return false
  }

  const url = new URL(request.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken === token) return true

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

    console.log('[Cron] AI 线索检索开始触发:', new Date().toISOString())
    const result = await runAIRetrieval()
    console.log('[Cron] AI 线索检索完成:', JSON.stringify(result))

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] AI 线索检索失败:', error)
    return NextResponse.json(
      { error: 'AI 线索检索失败', detail: error instanceof Error ? error.message : '未知错误' },
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

    console.log('[Cron] AI 线索检索开始触发(POST):', new Date().toISOString())
    const result = await runAIRetrieval()
    console.log('[Cron] AI 线索检索完成(POST):', JSON.stringify(result))

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] AI 线索检索失败(POST):', error)
    return NextResponse.json(
      { error: 'AI 线索检索失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
