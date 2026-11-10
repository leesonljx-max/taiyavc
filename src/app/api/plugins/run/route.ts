export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runPlugin } from '@/lib/plugin-runtime'

/**
 * 插件试运行（所有登录账号）
 * POST /api/plugins/run { key, input, projectId? }
 * 返回 { result: { key, name, kind, version, ok, queries, summary, sources } }
 */

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim()
    if (!key) return NextResponse.json({ error: '缺少插件标识 key' }, { status: 400 })
    const input = String(body.input || '').slice(0, 2000)
    const projectId = body.projectId ? String(body.projectId) : undefined

    const result = await runPlugin(key, input, { projectId })
    return NextResponse.json({ result })
  } catch (error) {
    console.error('Plugin run error:', error)
    const message = error instanceof Error ? error.message : '插件运行失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
