export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { runSignalTracking } from '@/lib/signal-tracker'

/**
 * 手动立即执行一次信号跟踪
 *
 * POST /api/tracking-signals/[id]/run
 * 返回：{ result: { foundCount, savedCount, skippedCount } }
 * （执行耗时约 10-30 秒：1-3 次搜索 + 1 次 DeepSeek 提取）
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole

    const signal = await prisma.trackingSignal.findUnique({
      where: { id: params.id },
      select: { id: true, createdById: true },
    })
    if (!signal) {
      return NextResponse.json({ error: '信号不存在' }, { status: 404 })
    }
    if (signal.createdById !== session.user.id && role !== 'ADMIN') {
      return NextResponse.json({ error: '无权执行该信号' }, { status: 403 })
    }

    // 重新查完整记录（runSignalTracking 需要全部字段）
    const full = await prisma.trackingSignal.findUnique({ where: { id: params.id } })
    if (!full) {
      return NextResponse.json({ error: '信号不存在' }, { status: 404 })
    }

    const result = await runSignalTracking(full)

    if (result.error) {
      return NextResponse.json({ error: `执行失败：${result.error}` }, { status: 500 })
    }

    return NextResponse.json({ result })
  } catch (error) {
    console.error('Tracking signal run error:', error)
    return NextResponse.json({ error: '执行跟踪信号失败' }, { status: 500 })
  }
}
