export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runDynamicSkill } from '@/lib/skill-registry'

/**
 * 技能调试试运行（P3.5）：功能页 SkillPanel 内调试技能效果
 * - DRAFT 技能：仅创建者本人可调试
 * - CONFIRMED 技能：本人可继续调试
 * POST /api/skills/run { key, input }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim()
    const input = String(body.input || '').trim()
    if (!key) return NextResponse.json({ error: '缺少技能标识' }, { status: 400 })
    if (!input) return NextResponse.json({ error: '请输入调试内容' }, { status: 400 })

    const result = await runDynamicSkill(key, input, session.user.id)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '技能调试失败'
    console.error('Skills run error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
