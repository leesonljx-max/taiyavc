export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'

/**
 * AI 项目线索详情 API
 *
 * GET    /api/ai-leads/[id]   获取详情
 * DELETE /api/ai-leads/[id]   删除
 * PATCH  /api/ai-leads/[id]   更新（状态、释放）
 */

async function getLeadIfAccessible(leadId: string, currentUser: PermissionUser) {
  const lead = await prisma.projectLead.findUnique({
    where: { id: leadId },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  })
  if (!lead) return null
  if (lead.source !== 'AI') return null

  // 权限：
  // - ADMIN / INVESTMENT_PARTNER 可访问全部
  // - 其他：已释放的全部可见；未释放的仅自己创建的可见
  if (currentUser.role === 'ADMIN' || currentUser.role === 'INVESTMENT_PARTNER') {
    return lead
  }
  if (lead.releasedAt) return lead
  if (lead.createdById === currentUser.id) return lead
  return null
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const lead = await getLeadIfAccessible(params.id, currentUser)
    if (!lead) {
      return NextResponse.json(
        { error: 'AI 线索不存在或无权访问' },
        { status: 404 }
      )
    }

    return NextResponse.json({ lead })
  } catch (error) {
    console.error('AI lead GET error:', error)
    return NextResponse.json(
      { error: '获取 AI 线索失败' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const lead = await prisma.projectLead.findUnique({
      where: { id: params.id },
    })
    if (!lead || lead.source !== 'AI') {
      return NextResponse.json(
        { error: 'AI 线索不存在' },
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
        { error: '无权删除该 AI 线索' },
        { status: 403 }
      )
    }

    await prisma.projectLead.delete({ where: { id: params.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('AI lead DELETE error:', error)
    return NextResponse.json(
      { error: '删除 AI 线索失败' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const lead = await prisma.projectLead.findUnique({
      where: { id: params.id },
    })
    if (!lead || lead.source !== 'AI') {
      return NextResponse.json(
        { error: 'AI 线索不存在' },
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
        { error: '无权编辑该 AI 线索' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data: any = {}

    // 允许更新的字段
    if (body.status !== undefined) data.status = body.status
    if (body.releasedAt !== undefined) {
      data.releasedAt = body.releasedAt ? new Date(body.releasedAt) : null
    }
    if (body.aiSummary !== undefined) data.aiSummary = body.aiSummary || null
    if (body.matchedProjectId !== undefined) {
      data.matchedProjectId = body.matchedProjectId || null
    }
    if (body.matchedConfidence !== undefined) {
      data.matchedConfidence = Number(body.matchedConfidence) || null
    }

    const updated = await prisma.projectLead.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json({ lead: updated })
  } catch (error) {
    console.error('AI lead PATCH error:', error)
    return NextResponse.json(
      { error: '更新 AI 线索失败' },
      { status: 500 }
    )
  }
}
