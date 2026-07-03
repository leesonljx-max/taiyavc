import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'

/**
 * 项目线索详情 API
 *
 * GET    /api/project-leads/[id]   获取详情
 * PUT    /api/project-leads/[id]   更新
 * DELETE /api/project-leads/[id]   删除
 */

async function getLeadIfAccessible(leadId: string, currentUser: PermissionUser | null) {
  const lead = await prisma.projectLead.findUnique({
    where: { id: leadId },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  if (!lead) return null

  // 权限：ADMIN / PARTNER 可访问全部；INVESTMENT_MANAGER 可访问全部；其他仅自己创建的
  if (currentUser?.role === 'ADMIN' || currentUser?.role === 'INVESTMENT_PARTNER' || currentUser?.role === 'INVESTMENT_MANAGER') {
    return lead
  }
  if (lead.createdById === currentUser?.id) return lead
  return null
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    const lead = await getLeadIfAccessible(params.id, currentUser)
    if (!lead) {
      return NextResponse.json(
        { error: '项目线索不存在或无权访问' },
        { status: 404 }
      )
    }

    return NextResponse.json({ lead })
  } catch (error) {
    console.error('Project lead GET error:', error)
    return NextResponse.json(
      { error: '获取项目线索失败' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    const lead = await prisma.projectLead.findUnique({ where: { id: params.id } })
    if (!lead) {
      return NextResponse.json(
        { error: '项目线索不存在' },
        { status: 404 }
      )
    }

    // 编辑权限：ADMIN / PARTNER 可编辑全部；其他仅创建者
    const canEdit =
      currentUser.role === 'ADMIN' ||
      currentUser.role === 'INVESTMENT_PARTNER' ||
      lead.createdById === currentUser.id

    if (!canEdit) {
      return NextResponse.json(
        { error: '无权编辑该项目线索' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name, industry, companyPosition, mainProducts, financingHistory, contactInfo, description, status } = body

    // 过滤不应由前端设置的字段
    const data: any = {}
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json(
          { error: '项目线索名称不能为空' },
          { status: 400 }
        )
      }
      data.name = name.trim()
    }
    if (industry !== undefined) data.industry = industry || null
    if (companyPosition !== undefined) data.companyPosition = companyPosition || null
    if (mainProducts !== undefined) data.mainProducts = mainProducts || null
    if (financingHistory !== undefined) data.financingHistory = financingHistory || null
    if (contactInfo !== undefined) data.contactInfo = contactInfo || null
    if (description !== undefined) data.description = description || null
    if (status !== undefined) data.status = status

    const updated = await prisma.projectLead.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json({ lead: updated })
  } catch (error) {
    console.error('Project lead PUT error:', error)
    return NextResponse.json(
      { error: '更新项目线索失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    const lead = await prisma.projectLead.findUnique({ where: { id: params.id } })
    if (!lead) {
      return NextResponse.json(
        { error: '项目线索不存在' },
        { status: 404 }
      )
    }

    // 删除权限：ADMIN / PARTNER 可删除全部；其他仅创建者
    const canDelete =
      currentUser.role === 'ADMIN' ||
      currentUser.role === 'INVESTMENT_PARTNER' ||
      lead.createdById === currentUser.id

    if (!canDelete) {
      return NextResponse.json(
        { error: '无权删除该项目线索' },
        { status: 403 }
      )
    }

    await prisma.projectLead.delete({ where: { id: params.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Project lead DELETE error:', error)
    return NextResponse.json(
      { error: '删除项目线索失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
