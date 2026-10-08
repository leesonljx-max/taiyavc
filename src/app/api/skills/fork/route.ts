export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { forkSkill } from '@/lib/skill-registry'

/**
 * 一键引用同事技能（P3.5）：复制同事 CONFIRMED 技能为自己的 DRAFT 副本
 * fork 后可自行修改调试，确认使用后挂载到本人 AI行研
 * POST /api/skills/fork { key: 源技能 key }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim()
    if (!key) return NextResponse.json({ error: '缺少技能标识' }, { status: 400 })

    const skill = await forkSkill(key, session.user.id)
    return NextResponse.json({ skill }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '一键引用失败'
    console.error('Skills fork error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
