export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'

/**
 * POST /api/post-investment/[projectId]/investment
 * 录入并确认投资信息（投资基金 / 投资金额（万元）/ 投资日期（YYYY-MM））
 * 确认后锁定，不可更改（再次调用返回 409）
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { createdById: true, postInvestConfirmed: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权录入投资信息' }, { status: 403 })
    }
    if (project.postInvestConfirmed) {
      return NextResponse.json({ error: '投资信息已确认，不可更改' }, { status: 409 })
    }

    const body = (await request.json().catch(() => ({}))) as { fund?: string; amount?: number | string; date?: string }
    const fund = String(body.fund || '').trim()
    const amount = Number(body.amount)
    const date = String(body.date || '').trim()

    if (!fund) return NextResponse.json({ error: '请选择或填写投资基金' }, { status: 400 })
    if (fund.length > 30) return NextResponse.json({ error: '基金名称过长（≤30 字符）' }, { status: 400 })
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: '投资金额必须为正数（单位：万元）' }, { status: 400 })
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) {
      return NextResponse.json({ error: '投资日期格式无效（应为 YYYY-MM，如 2024-12）' }, { status: 400 })
    }

    const updated = await prisma.project.update({
      where: { id: params.projectId },
      data: { postInvestFund: fund, postInvestAmount: amount, postInvestDate: date, postInvestConfirmed: true },
      select: { postInvestFund: true, postInvestAmount: true, postInvestDate: true, postInvestConfirmed: true },
    })

    return NextResponse.json({ ok: true, investment: updated })
  } catch (error) {
    console.error('Post-investment investment error:', error)
    return NextResponse.json({ error: '保存投资信息失败' }, { status: 500 })
  }
}
