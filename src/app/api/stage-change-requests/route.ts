export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'

/**
 * GET /api/stage-change-requests
 * 获取阶段变更请求列表
 * - ADMIN / INVESTMENT_PARTNER: 看到所有 PENDING 请求
 * - 其他角色: 看到自己发起的请求
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const role = session.user.role as UserRole
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'PENDING'

    const where: any = {}
    if (status !== 'ALL') {
      where.status = status
    }

    // 非 ADMIN/PARTNER 只能看自己发起的请求
    if (role !== 'ADMIN' && role !== 'INVESTMENT_PARTNER') {
      where.requesterId = session.user.id
    }

    const requests = await prisma.stageChangeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            companyPosition: true,
            industry: true,
            financingRound: true,
            totalAmount: true,
            investmentValuation: true,
            followStage: true,
            createdById: true,
            createdBy: { select: { id: true, name: true } },
          },
        },
        requester: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ requests })
  } catch (error) {
    return NextResponse.json({ error: '获取阶段变更请求失败' }, { status: 500 })
  }
}
