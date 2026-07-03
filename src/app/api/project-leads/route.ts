import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'

/**
 * 项目线索 API
 *
 * GET  /api/project-leads          列表（按权限过滤）
 * POST /api/project-leads          新建线索
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
    const scope = searchParams.get('scope') === 'mine' ? 'mine' : 'all'
    const keyword = searchParams.get('keyword')?.trim() || ''

    // 权限矩阵：
    // - ADMIN / INVESTMENT_PARTNER: 查看全部线索（scope=all）
    // - INVESTMENT_MANAGER: scope=all 查看全部，scope=mine 仅自己的
    // - 其他: 仅自己创建的
    const where: any = {}
    if (scope === 'mine') {
      where.createdById = currentUser.id
    } else {
      // scope=all
      if (currentUser.role !== 'ADMIN' && currentUser.role !== 'INVESTMENT_PARTNER' && currentUser.role !== 'INVESTMENT_MANAGER') {
        where.createdById = currentUser.id
      }
    }

    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { industry: { contains: keyword } },
        { companyPosition: { contains: keyword } },
      ]
    }

    const leads = await prisma.projectLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ leads, scope })
  } catch (error) {
    console.error('Project leads GET error:', error)
    return NextResponse.json(
      { error: '获取项目线索列表失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    if (!session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录', detail: 'session.user.id is missing' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { name, industry, companyPosition, mainProducts, financingHistory, contactInfo, description, status } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: '项目线索名称是必填项' },
        { status: 400 }
      )
    }

    // 过滤不应由前端设置的字段
    const data: any = {
      name: name.trim(),
      industry: industry || null,
      companyPosition: companyPosition || null,
      mainProducts: mainProducts || null,
      financingHistory: financingHistory || null,
      contactInfo: contactInfo || null,
      description: description || null,
      status: status || 'PENDING',
      createdById: session.user.id,
    }

    const lead = await prisma.projectLead.create({ data })

    return NextResponse.json(
      { lead },
      { status: 201 }
    )
  } catch (error) {
    console.error('Project lead POST error:', error)
    return NextResponse.json(
      { error: '创建项目线索失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
