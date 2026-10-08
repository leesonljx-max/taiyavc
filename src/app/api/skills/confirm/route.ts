export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * 确认使用技能（P3.5）：DRAFT → CONFIRMED
 * 确认后：挂载到本人 AI行研 run_skill + 同事可见可引用
 * POST /api/skills/confirm { key }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const userId = session.user.id
    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim()

    const existing = await prisma.agentSkill.findUnique({ where: { key } })
    if (!existing) return NextResponse.json({ error: '技能不存在' }, { status: 404 })
    if (existing.type !== 'DYNAMIC') {
      return NextResponse.json({ error: '内置技能无需确认' }, { status: 400 })
    }
    if (existing.createdById !== userId) {
      return NextResponse.json({ error: '只能确认自己的技能' }, { status: 403 })
    }
    if ((existing.content || '').trim().length < 20) {
      return NextResponse.json({ error: '提示词内容过短，请先完善再确认' }, { status: 400 })
    }
    if (existing.status === 'CONFIRMED') {
      return NextResponse.json({ error: '技能已处于确认使用状态' }, { status: 400 })
    }

    const skill = await prisma.agentSkill.update({
      where: { id: existing.id },
      data: { status: 'CONFIRMED' },
    })
    return NextResponse.json({ skill })
  } catch (error) {
    console.error('Skills confirm error:', error)
    return NextResponse.json({ error: '确认使用失败' }, { status: 500 })
  }
}
