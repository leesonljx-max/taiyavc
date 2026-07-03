import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'
import { isHighlyOverlapping, similarity, normalizeName } from '@/lib/lead-match'

/**
 * 项目线索重合检测 API
 *
 * GET /api/project-leads/match?name=XXX
 * 返回与给定名称"高度重合"的项目线索列表（按相似度降序）
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    const currentUser: PermissionUser | null = session?.user
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

    if (!currentUser) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')?.trim() || ''

    if (!name) {
      return NextResponse.json({ matches: [] })
    }

    // 获取当前用户可见的全部线索
    const where: any = {}
    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'INVESTMENT_PARTNER' && currentUser.role !== 'INVESTMENT_MANAGER') {
      where.createdById = currentUser.id
    }

    const leads = await prisma.projectLead.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true } } },
    })

    // 计算每个线索与目标名称的重合情况
    const matches = leads
      .map(lead => {
        const sim = similarity(name, lead.name)
        const overlap = isHighlyOverlapping(name, lead.name)
        return { lead, similarity: Number(sim.toFixed(4)), isHighlyOverlapping: overlap }
      })
      .filter(m => m.isHighlyOverlapping)
      .sort((a, b) => b.similarity - a.similarity)

    return NextResponse.json({ matches, queryName: name, normalized: normalizeName(name) })
  } catch (error) {
    console.error('Project lead match error:', error)
    return NextResponse.json(
      { error: '项目线索重合检测失败' },
      { status: 500 }
    )
  }
}
