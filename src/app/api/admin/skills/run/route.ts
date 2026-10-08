export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runDynamicSkill } from '@/lib/skill-registry'

/**
 * POST /api/admin/skills/run
 * 动态技能在线试运行（管理员 playground）：{ key, input } → 技能分析结果
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: '无权操作，仅管理员可试运行技能' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim()
    const input = String(body.input || '').trim()
    if (!key || !input) {
      return NextResponse.json({ error: '缺少技能标识或输入内容' }, { status: 400 })
    }
    if (input.length > 4000) {
      return NextResponse.json({ error: '输入内容过长（限 4000 字）' }, { status: 400 })
    }

    const result = await runDynamicSkill(key, input)
    return NextResponse.json({ ok: true, content: result.content })
  } catch (error) {
    const message = error instanceof Error ? error.message : '技能运行失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
