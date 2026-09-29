export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/pending-count
 * 侧边栏"工作台"待办数字徽标（微信未读消息样式）：
 * 返回当前用户待审批的阶段变更请求数（与工作台"待办请求"区块同口径，仅合伙人/管理员）
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role
    if (role !== 'ADMIN' && role !== 'INVESTMENT_PARTNER') {
      return NextResponse.json({ count: 0 })
    }

    const count = await prisma.stageChangeRequest.count({
      where: { status: 'PENDING' },
    })
    return NextResponse.json({ count })
  } catch (error) {
    console.error('Pending count error:', error)
    return NextResponse.json({ count: 0 })
  }
}
