import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, canEditProject, canDeleteProject, type PermissionUser } from '@/lib/permissions'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    
    const currentUser: PermissionUser | null = session?.user 
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        investors: { select: { id: true, name: true, email: true, phone: true } },
        investments: {
          select: { id: true, amount: true, date: true, investorId: true },
          orderBy: { date: 'desc' },
        },
        members: { select: { userId: true } },
        createdBy: { select: { id: true, name: true } },
        partnerReviews: {
          orderBy: { createdAt: 'desc' },
        },
        followUpNotes: {
          orderBy: { createdAt: 'desc' },
        },
        stageApprovals: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)
    
    if (!canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权查看该项目' },
        { status: 403 }
      )
    }

    const result = {
      ...project,
      totalAmount: Number(project.totalAmount),
      raisedAmount: Number(project.raisedAmount),
      investments: project.investments.map(i => ({
        ...i,
        amount: Number(i.amount),
      })),
      memberIds,
      aiCardJson: project.aiCardJson,
      canEdit: canEditProject(currentUser, {
        followStage: project.followStage,
        createdById: project.createdById,
        memberIds,
      }),
      canDelete: canDeleteProject(currentUser, {
        followStage: project.followStage,
        createdById: project.createdById,
        memberIds,
      }),
    }

    return NextResponse.json({ project: result })
  } catch (error) {
    return NextResponse.json(
      { error: '获取项目详情失败' },
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
    
    if (!session?.user) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = { 
      id: session.user.id, 
      role: session.user.role as UserRole 
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)
    
    if (!canEditProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权编辑该项目' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { financialData, targetDate, ...data } = body

    // 立项阶段审批检查：从其他阶段切换到 PROJECT_INITIATION 时，需要多数合伙人通过
    if (data.followStage === 'PROJECT_INITIATION' && project.followStage !== 'PROJECT_INITIATION') {
      const totalPartners = await prisma.user.count({
        where: { role: 'INVESTMENT_PARTNER', status: 'ACTIVE' },
      })
      const approvals = await prisma.stageApproval.findMany({
        where: { projectId: params.id },
      })
      const approvedCount = approvals.filter(a => a.status === 'APPROVED').length
      const rejectedCount = approvals.filter(a => a.status === 'REJECTED').length
      const majorityThreshold = Math.floor(totalPartners / 2) + 1

      if (rejectedCount > 0) {
        return NextResponse.json(
          { error: '存在合伙人拒绝立项，无法进入立项阶段', detail: `已拒绝: ${rejectedCount}` },
          { status: 400 }
        )
      }
      if (approvedCount < majorityThreshold) {
        return NextResponse.json(
          {
            error: '尚未达到立项所需的合伙人多数通过',
            detail: `需要 ${majorityThreshold} 票通过（共 ${totalPartners} 位合伙人），当前已通过 ${approvedCount} 票`,
          },
          { status: 400 }
        )
      }
    }

    // financialData: 前端可能发送对象或字符串，统一转为字符串存储
    if (financialData && typeof financialData === 'object') {
      data.financialData = JSON.stringify(financialData)
    } else if (financialData !== undefined && financialData !== null) {
      data.financialData = financialData
    }

    // targetDate: 确保是完整的 ISO-8601 DateTime
    if (targetDate) {
      const d = new Date(targetDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: '目标日期格式无效', detail: `targetDate: ${targetDate}` },
          { status: 400 }
        )
      }
      data.targetDate = d.toISOString()
    } else if (targetDate === null || targetDate === '') {
      // 不允许清空 targetDate（必填字段），保留原值
    }

    // 移除不应由前端直接更新的字段
    delete data.id
    delete data.createdAt
    delete data.updatedAt
    delete data.createdById

    const updatedProject = await prisma.project.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json(
      { project: { ...updatedProject, totalAmount: Number(updatedProject.totalAmount), raisedAmount: Number(updatedProject.raisedAmount) } }
    )
  } catch (error) {
    console.error('Update project error:', error)
    return NextResponse.json(
      { error: '更新项目失败', detail: error instanceof Error ? error.message : '未知错误' },
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
    
    if (!session?.user) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = { 
      id: session.user.id, 
      role: session.user.role as UserRole 
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)
    
    if (!canDeleteProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权删除该项目' },
        { status: 403 }
      )
    }

    await prisma.project.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ message: '项目已删除' })
  } catch (error) {
    return NextResponse.json(
      { error: '删除项目失败' },
      { status: 500 }
    )
  }
}