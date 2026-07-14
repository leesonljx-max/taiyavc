export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

// 3个月 = 90天
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000

/**
 * POST /api/projects/[id]/takeover
 * 发起项目接手申请
 * - 保护期内（protectionExpiresAt > now）：创建 PENDING 申请，需原维护人审批
 * - 保护期外（protectionExpiresAt <= now）：直接变更维护人，创建 AUTO_COMPLETED 记录
 *
 * body: { comment?: string }
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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

    const projectId = params.id
    const body = await request.json().catch(() => ({}))
    const comment = typeof body.comment === 'string' ? body.comment.trim() : ''

    // 查询项目
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 不能接手自己的项目
    if (project.createdById === session.user.id) {
      return NextResponse.json(
        { error: '您已经是该项目的维护人，无需接手' },
        { status: 400 }
      )
    }

    const now = new Date()
    const protectionExpiresAt = project.protectionExpiresAt
    const isProtected = protectionExpiresAt ? protectionExpiresAt > now : false

    // 检查是否已有待审批的接手申请（防止重复申请）
    const existingPending = await prisma.takeoverRequest.findFirst({
      where: {
        projectId,
        requesterId: session.user.id,
        status: 'PENDING',
      },
    })

    if (existingPending) {
      return NextResponse.json(
        { error: '您已发起过接手申请，请等待原维护人审批' },
        { status: 400 }
      )
    }

    if (isProtected) {
      // 保护期内：创建 PENDING 申请，需审批
      const takeoverRequest = await prisma.takeoverRequest.create({
        data: {
          projectId,
          requesterId: session.user.id,
          currentOwnerId: project.createdById,
          status: 'PENDING',
          comment: comment || null,
        },
        include: {
          requester: { select: { id: true, name: true, email: true } },
          currentOwner: { select: { id: true, name: true, email: true } },
        },
      })

      return NextResponse.json({
        needApproval: true,
        requestId: takeoverRequest.id,
        message: `已向原维护人 ${project.createdBy?.name || project.createdBy?.email} 发起接手申请，等待审批`,
        takeoverRequest,
      })
    } else {
      // 保护期外：直接变更维护人
      const newProtectionExpiresAt = new Date(now.getTime() + THREE_MONTHS_MS)

      // 使用事务保证一致性
      const [updatedProject, takeoverRequest] = await prisma.$transaction([
        // 变更维护人 + 重置保护期
        prisma.project.update({
          where: { id: projectId },
          data: {
            createdById: session.user.id,
            protectionExpiresAt: newProtectionExpiresAt,
          },
        }),
        // 创建 AUTO_COMPLETED 记录
        prisma.takeoverRequest.create({
          data: {
            projectId,
            requesterId: session.user.id,
            currentOwnerId: project.createdById,
            status: 'AUTO_COMPLETED',
            comment: comment || null,
            reviewerComment: '保护期已过期，系统自动完成接手',
            reviewedAt: now,
          },
          include: {
            requester: { select: { id: true, name: true, email: true } },
            currentOwner: { select: { id: true, name: true, email: true } },
          },
        }),
      ])

      return NextResponse.json({
        needApproval: false,
        message: '保护期已过期，您已成功接手该项目',
        project: { id: updatedProject.id, name: updatedProject.name, createdById: updatedProject.createdById },
        takeoverRequest,
      })
    }
  } catch (error) {
    console.error('Takeover request error:', error)
    return NextResponse.json(
      { error: '发起接手申请失败' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/projects/[id]/takeover
 * 查看项目的接手申请列表
 * - 原维护人：查看所有申请（待审批 + 历史）
 * - 请求者：查看自己发起的申请
 * - 其他：无权限
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const projectId = params.id
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, createdById: true },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 权限：当前维护人 或 ADMIN
    const isOwner = project.createdById === session.user.id
    const isAdmin = session.user.role === 'ADMIN'

    let requests
    if (isOwner || isAdmin) {
      // 维护人/管理员：查看所有申请
      requests = await prisma.takeoverRequest.findMany({
        where: { projectId },
        include: {
          requester: { select: { id: true, name: true, email: true } },
          currentOwner: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      // 请求者：仅查看自己发起的
      requests = await prisma.takeoverRequest.findMany({
        where: { projectId, requesterId: session.user.id },
        include: {
          requester: { select: { id: true, name: true, email: true } },
          currentOwner: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    }

    return NextResponse.json({ requests, isOwner, isAdmin })
  } catch (error) {
    console.error('Get takeover requests error:', error)
    return NextResponse.json(
      { error: '获取接手申请失败' },
      { status: 500 }
    )
  }
}
