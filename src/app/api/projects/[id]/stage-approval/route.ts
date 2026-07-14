export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canApproveStage, canViewProject, type PermissionUser } from '@/lib/permissions'

// GET: 获取项目的立项审批列表及统计
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        members: { select: { userId: true } },
        stageApprovals: { orderBy: { createdAt: 'desc' } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 })
    }

    // 获取所有投资合伙人总数（用于计算多数通过阈值）
    const totalPartners = await prisma.user.count({
      where: { role: 'INVESTMENT_PARTNER', status: 'ACTIVE' },
    })

    const approvals = project.stageApprovals
    const approvedCount = approvals.filter(a => a.status === 'APPROVED').length
    const rejectedCount = approvals.filter(a => a.status === 'REJECTED').length
    // 多数通过：超过半数合伙人批准
    const majorityThreshold = Math.floor(totalPartners / 2) + 1
    const isApproved = approvedCount >= majorityThreshold && totalPartners > 0
    const isRejected = rejectedCount > 0

    // 当前用户是否已审批
    const myApproval = approvals.find(a => a.userId === session.user.id)

    return NextResponse.json({
      approvals,
      summary: {
        totalPartners,
        approvedCount,
        rejectedCount,
        pendingCount: totalPartners - approvedCount - rejectedCount,
        majorityThreshold,
        isApproved,
        isRejected,
        canEnterInitiation: isApproved && !isRejected,
      },
      myApproval: myApproval || null,
      canApprove: canApproveStage(currentUser),
    })
  } catch (error) {
    console.error('Get stage approval error:', error)
    return NextResponse.json(
      { error: '获取审批信息失败' },
      { status: 500 }
    )
  }
}

// POST: 提交立项审批
export async function POST(
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

    if (!canApproveStage(currentUser)) {
      return NextResponse.json(
        { error: '无权审批立项，仅投资合伙人/管理员可审批' },
        { status: 403 }
      )
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 仅当项目处于 PreDD 阶段时才可审批立项
    if (project.followStage !== 'PRE_DD') {
      return NextResponse.json(
        { error: `当前阶段不允许审批立项（当前阶段：${project.followStage}），仅 PreDD 阶段可审批` },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { status, comment } = body

    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return NextResponse.json(
        { error: '无效的审批状态，必须为 APPROVED 或 REJECTED' },
        { status: 400 }
      )
    }

    // upsert：一个用户对一个项目只能审批一次
    const approval = await prisma.stageApproval.upsert({
      where: {
        projectId_userId: {
          projectId: params.id,
          userId: session.user.id,
        },
      },
      update: {
        status,
        comment: comment?.trim() || null,
      },
      create: {
        projectId: params.id,
        userId: session.user.id,
        userName: session.user.name || session.user.email || '未知用户',
        status,
        comment: comment?.trim() || null,
      },
    })

    // 重新计算审批结果
    const totalPartners = await prisma.user.count({
      where: { role: 'INVESTMENT_PARTNER', status: 'ACTIVE' },
    })
    const allApprovals = await prisma.stageApproval.findMany({
      where: { projectId: params.id },
    })
    const approvedCount = allApprovals.filter(a => a.status === 'APPROVED').length
    const rejectedCount = allApprovals.filter(a => a.status === 'REJECTED').length
    const majorityThreshold = Math.floor(totalPartners / 2) + 1
    const isApproved = approvedCount >= majorityThreshold && totalPartners > 0
    const isRejected = rejectedCount > 0

    return NextResponse.json({
      approval,
      summary: {
        totalPartners,
        approvedCount,
        rejectedCount,
        pendingCount: totalPartners - approvedCount - rejectedCount,
        majorityThreshold,
        isApproved,
        isRejected,
        canEnterInitiation: isApproved && !isRejected,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Create stage approval error:', error)
    return NextResponse.json(
      { error: '提交审批失败' },
      { status: 500 }
    )
  }
}
