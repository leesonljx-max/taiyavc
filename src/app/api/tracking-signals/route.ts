export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'

/**
 * 自定义跟踪信号 API
 *
 * GET  /api/tracking-signals    信号列表（自己创建的；ADMIN/INVESTMENT_PARTNER 看全部）
 * POST /api/tracking-signals    确认保存信号（body: name/description/signalType/keywords/watchTargets/industry/frequency）
 */

const VALID_TYPES = ['PERSONNEL_CHANGE', 'NEW_STARTUP', 'TECH_BREAKTHROUGH', 'FUNDING', 'CUSTOM']
const VALID_FREQUENCIES = ['DAILY', 'WEEKLY']

/** 校验并规范化 keywords（JSON 数组字符串，1-3 组，每组 ≤60 字） */
function normalizeKeywords(raw: unknown): string | null {
  let arr: unknown[] = []
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw) } catch { arr = [raw] }
  } else if (Array.isArray(raw)) {
    arr = raw
  }
  const kws = arr
    .filter(k => typeof k === 'string' && k.trim())
    .map(k => (k as string).trim().slice(0, 60))
    .slice(0, 3)
  if (kws.length === 0) return null
  return JSON.stringify(kws)
}

/** 校验并规范化 watchTargets（可空，JSON 数组字符串，≤10 项） */
function normalizeWatchTargets(raw: unknown): string | null {
  let arr: unknown[] = []
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    } catch {
      // 非法 JSON 时按空处理
      return null
    }
  } else if (Array.isArray(raw)) {
    arr = raw
  } else {
    return null
  }
  const targets = arr
    .filter(t => typeof t === 'string' && t.trim())
    .map(t => (t as string).trim().slice(0, 50))
    .slice(0, 10)
  return JSON.stringify(targets)
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole

    const signals = await prisma.trackingSignal.findMany({
      where: role === 'ADMIN' || role === 'INVESTMENT_PARTNER' ? {} : { createdById: session.user.id },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ signals })
  } catch (error) {
    console.error('Tracking signals GET error:', error)
    return NextResponse.json({ error: '获取跟踪信号失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : ''

    if (!name || !description) {
      return NextResponse.json({ error: '信号名称和描述不能为空' }, { status: 400 })
    }

    const keywords = normalizeKeywords(body.keywords)
    if (!keywords) {
      return NextResponse.json({ error: '至少需要 1 组有效搜索关键词（最多 3 组）' }, { status: 400 })
    }

    const signalType = VALID_TYPES.includes(body.signalType) ? body.signalType : 'CUSTOM'
    const frequency = VALID_FREQUENCIES.includes(body.frequency) ? body.frequency : 'WEEKLY'

    const signal = await prisma.trackingSignal.create({
      data: {
        name,
        description,
        signalType,
        keywords,
        watchTargets: normalizeWatchTargets(body.watchTargets),
        industry: typeof body.industry === 'string' && body.industry.trim() ? body.industry.trim().slice(0, 30) : null,
        frequency,
        isActive: true,
        createdById: session.user.id,
      },
    })

    return NextResponse.json({ signal }, { status: 201 })
  } catch (error) {
    console.error('Tracking signal create error:', error)
    return NextResponse.json({ error: '保存跟踪信号失败' }, { status: 500 })
  }
}
