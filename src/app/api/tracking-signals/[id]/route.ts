export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'

/**
 * 单个跟踪信号 API
 *
 * PATCH   /api/tracking-signals/[id]   编辑（启停 isActive / 频率 frequency / 名称等）
 * DELETE  /api/tracking-signals/[id]   删除（仅创建者或管理员）
 */

const VALID_FREQUENCIES = ['DAILY', 'WEEKLY']

/** 权限：创建者本人或 ADMIN */
async function canManage(userId: string, role: UserRole, signalId: string): Promise<boolean> {
  const signal = await prisma.trackingSignal.findUnique({
    where: { id: signalId },
    select: { createdById: true },
  })
  if (!signal) return false
  return signal.createdById === userId || role === 'ADMIN'
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole

    if (!(await canManage(session.user.id, role, params.id))) {
      return NextResponse.json({ error: '无权操作该信号' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const data: Record<string, unknown> = {}

    if (typeof body.isActive === 'boolean') data.isActive = body.isActive
    if (body.frequency && VALID_FREQUENCIES.includes(body.frequency)) data.frequency = body.frequency
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 60)
    if (typeof body.industry === 'string') data.industry = body.industry.trim().slice(0, 30) || null

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
    }

    const signal = await prisma.trackingSignal.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json({ signal })
  } catch (error) {
    console.error('Tracking signal PATCH error:', error)
    return NextResponse.json({ error: '更新跟踪信号失败' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole

    if (!(await canManage(session.user.id, role, params.id))) {
      return NextResponse.json({ error: '无权删除该信号' }, { status: 403 })
    }

    await prisma.trackingSignal.delete({ where: { id: params.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Tracking signal DELETE error:', error)
    return NextResponse.json({ error: '删除跟踪信号失败' }, { status: 500 })
  }
}
