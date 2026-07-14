export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

// 3个月 = 90天
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000

/**
 * POST /api/projects/[id]/takeover/[requestId]/action
 * 原维护人审批接手申请
 *
 * body: { action: 'approve' | 'reject', reviewerComment?: string }
 * - approve: 变更维护人为请求者，重置保护期，标记 APPROVED
 * - reject: 标记 REJECTED
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; requestId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    if (!session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const { id: projectId, requestId } = params
    const body = await request.json().catch(() => ({}))
    const action = body.action // 'approve' | 'reject'
    const reviewerComment = typeof body.reviewerComment === 'string' ? body.reviewerComment.trim() : ''

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { error: 'action 参数无效，必须是 approve 或 reject' },
        { status: 400 }
      )
    }

    // 查询接手申请
    const takeoverRequest = await prisma.takeoverRequest.findUnique({
      where: { id: requestId },
      include: {
        project: { select: { id: true, name: true, createdById: true } },
      },
    })

    if (!takeoverRequest) {
      return NextResponse.json({ error: '接手申请不存在' }, { status: 404 })
    }

    if (takeoverRequest.projectId !== projectId) {
      return NextResponse.json({ error: '接手申请与项目不匹配' }, { status: 400 })
    }

    if (takeoverRequest.status !== 'PENDING') {
      return NextResponse.json(
        { error: `该申请已处理（当前状态：${takeoverRequest.status}），无法重复操作` },
        { status: 400 }
      )
    }

    // 权限：当前维护人 或 ADMIN
    const isOwner = takeoverRequest.currentOwnerId === session.user.id
    const isAdmin = session.user.role === 'ADMIN'

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: '无权审批此接手申请，仅当前维护人或管理员可审批' },
        { status: 403 }
      )
    }

    // 校验：项目当前维护人必须与申请中的 currentOwnerId 一致
    if (takeoverRequest.project.createdById !== takeoverRequest.currentOwnerId) {
      return NextResponse.json(
        { error: '项目维护人已变更，该申请无效' },
        { status: 400 }
      )
    }

    const now = new Date()

    if (action === 'approve') {
      // 同意接手：变更维护人 + 重置保护期 + 标记 APPROVED
      const newProtectionExpiresAt = new Date(now.getTime() + THREE_MONTHS_MS)

      await prisma.$transaction([
        prisma.project.update({
          where: { id: projectId },
          data: {
            createdById: takeoverRequest.requesterId,
            protectionExpiresAt: newProtectionExpiresAt,
          },
        }),
        prisma.takeoverRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            reviewerComment: reviewerComment || null,
            reviewedAt: now,
          },
        }),
      ])

      return NextResponse.json({
        message: '已同意接手申请，项目维护人已变更',
        action: 'approved',
      })
    } else {
      // 拒绝接手
      await prisma.takeoverRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          reviewerComment: reviewerComment || null,
          reviewedAt: now,
        },
      })

      return NextResponse.json({
        message: '已拒绝接手申请',
        action: 'rejected',
      })
    }
  } catch (error) {
    console.error('Review takeover request error:', error)
    return NextResponse.json(
      { error: '审批接手申请失败' },
      { status: 500 }
    )
  }
}
