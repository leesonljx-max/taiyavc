import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canApproveStage } from '@/lib/permissions'
import { parsePassedStages, computePassedStages } from '@/lib/stage-utils'

/**
 * POST /api/stage-change-requests/[id]/action
 * 审批阶段变更请求（仅 ADMIN / INVESTMENT_PARTNER）
 * body: { action: 'approve' | 'reject', comment?: string }
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

    const currentUser = { id: session.user.id, role: session.user.role as UserRole }
    if (!canApproveStage(currentUser)) {
      return NextResponse.json({ error: '无权审批阶段变更请求' }, { status: 403 })
    }

    const body = await request.json()
    const { action, comment } = body

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 })
    }

    const stageRequest = await prisma.stageChangeRequest.findUnique({
      where: { id: params.id },
      include: { project: true },
    })

    if (!stageRequest) {
      return NextResponse.json({ error: '请求不存在' }, { status: 404 })
    }

    if (stageRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '该请求已处理' }, { status: 400 })
    }

    // 如果同意，变更项目阶段（使用事务保证一致性）
    if (action === 'approve') {
      const project = stageRequest.project
      const newStage = stageRequest.toStage
      const currentPassed = parsePassedStages(project.passedStages)
      const newPassed = computePassedStages(currentPassed, newStage as any)

      await prisma.$transaction([
        prisma.stageChangeRequest.update({
          where: { id: params.id },
          data: {
            status: 'APPROVED',
            reviewerId: session.user.id,
            reviewerComment: comment || null,
            reviewedAt: new Date(),
          },
        }),
        prisma.project.update({
          where: { id: stageRequest.projectId },
          data: {
            followStage: newStage,
            passedStages: JSON.stringify(newPassed),
            stageChangedAt: new Date(),
          },
        }),
      ])
    } else {
      // 拒绝，仅更新请求状态
      await prisma.stageChangeRequest.update({
        where: { id: params.id },
        data: {
          status: 'REJECTED',
          reviewerId: session.user.id,
          reviewerComment: comment || null,
          reviewedAt: new Date(),
        },
      })
    }

    return NextResponse.json({
      success: true,
      action,
      message: action === 'approve'
        ? `已同意，项目阶段已变更为「${stageRequest.toStage}」`
        : '已拒绝，项目阶段保持不变',
    })
  } catch (error) {
    return NextResponse.json({ error: '审批失败' }, { status: 500 })
  }
}
