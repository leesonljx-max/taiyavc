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
      totalAmount: project.totalAmount,
      raisedAmount: project.raisedAmount,  // 字符串类型
      investmentValuation: project.investmentValuation ? Number(project.investmentValuation) : null,
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
    const {
      name,
      financialData,
      targetDate,
      companyFullName,
      industry,
      companyPosition,
      mainProducts,
      orderProgress,
      financingPlan,
      financingRound,
      followStage,
      coreAdvantage,
      coreTeam,
      competitors,
      description,
      totalAmount,
      raisedAmount,
      investmentValuation,
      keywords,
      aiCardJson,
    } = body ?? {}

    // 显式字段白名单：仅允许以下字段写入数据库，杜绝 mass-assignment
    // 禁止客户端设置：id, createdAt, updatedAt, createdById,
    // passedStages, protectionExpiresAt, stageChangedAt,
    // competitorAnalysisJson, status
    const data: Record<string, any> = {
      ...(name !== undefined && { name }),
      ...(companyFullName !== undefined && { companyFullName }),
      ...(industry !== undefined && { industry }),
      ...(companyPosition !== undefined && { companyPosition }),
      ...(mainProducts !== undefined && { mainProducts }),
      ...(orderProgress !== undefined && { orderProgress }),
      ...(financingPlan !== undefined && { financingPlan }),
      ...(financingRound !== undefined && { financingRound }),
      ...(followStage !== undefined && { followStage }),
      ...(coreAdvantage !== undefined && { coreAdvantage }),
      ...(coreTeam !== undefined && { coreTeam }),
      ...(competitors !== undefined && { competitors }),
      ...(description !== undefined && { description }),
      ...(totalAmount !== undefined && { totalAmount }),
      ...(raisedAmount !== undefined && { raisedAmount }),
      ...(investmentValuation !== undefined && { investmentValuation }),
      ...(keywords !== undefined && { keywords }),
      ...(aiCardJson !== undefined && { aiCardJson }),
    }

    // 必填字段校验：industry / companyPosition / investmentValuation 不允许设为空
    // 仅在字段被显式传递时校验，避免影响只更新其他字段的请求
    const REQUIRED_FIELDS: Array<keyof typeof data> = ['industry', 'companyPosition', 'investmentValuation']
    for (const field of REQUIRED_FIELDS) {
      if (field in data) {
        const val = data[field]
        if (val === null || val === undefined || String(val).trim() === '') {
          return NextResponse.json(
            { error: `字段 ${field} 不能为空` },
            { status: 400 }
          )
        }
      }
    }

    // raisedAmount 统一转为字符串（去单位后由用户自行填写单位）
    if ('raisedAmount' in data) {
      data.raisedAmount = String(data.raisedAmount ?? '').trim()
    }

    // investmentValuation 校验为有效数字
    if ('investmentValuation' in data && data.investmentValuation !== null && data.investmentValuation !== '') {
      const v = Number(data.investmentValuation)
      if (isNaN(v)) {
        return NextResponse.json(
          { error: '投资估值必须为有效数字' },
          { status: 400 }
        )
      }
      data.investmentValuation = v
    }

    // 判断是否需要审批的阶段变更
    // 1. 从 INITIAL_TALK 或 PRE_DD → PROJECT_INITIATION（立项）
    // 2. 从 AGREEMENT → CLOSING（交割）
    const requiresApproval = data.followStage && data.followStage !== project.followStage && (
      (data.followStage === 'PROJECT_INITIATION' && (project.followStage === 'INITIAL_TALK' || project.followStage === 'PRE_DD')) ||
      (data.followStage === 'CLOSING' && project.followStage === 'AGREEMENT')
    )

    if (requiresApproval) {
      // 不直接变更阶段，而是创建阶段变更请求
      // 检查是否已有 PENDING 的请求
      const existingRequest = await prisma.stageChangeRequest.findFirst({
        where: { projectId: params.id, status: 'PENDING' },
      })
      if (existingRequest) {
        return NextResponse.json(
          { error: '该项目的阶段变更请求正在审批中，请等待审批完成' },
          { status: 400 }
        )
      }

      // 创建阶段变更请求（先保存其他字段，但不变更 followStage）
      const { followStage: _ignoredStage, ...dataWithoutStage } = data

      // 更新非阶段字段（如投资估值、公司定位等）
      if (financialData && typeof financialData === 'object') {
        dataWithoutStage.financialData = JSON.stringify(financialData)
      } else if (financialData !== undefined && financialData !== null) {
        dataWithoutStage.financialData = financialData
      }
      if (targetDate) {
        const d = new Date(targetDate)
        if (!isNaN(d.getTime())) dataWithoutStage.targetDate = d.toISOString()
      }

      if (Object.keys(dataWithoutStage).length > 0) {
        await prisma.project.update({
          where: { id: params.id },
          data: dataWithoutStage,
        })
      }

      // 创建阶段变更请求
      const stageRequest = await prisma.stageChangeRequest.create({
        data: {
          projectId: params.id,
          requesterId: session.user.id,
          fromStage: project.followStage,
          toStage: data.followStage,
          status: 'PENDING',
          comment: body.comment || null,
        },
      })

      return NextResponse.json({
        project: { id: params.id },
        stageChangeRequest: {
          id: stageRequest.id,
          fromStage: stageRequest.fromStage,
          toStage: stageRequest.toStage,
          status: stageRequest.status,
        },
        message: '阶段变更请求已提交，等待投资合伙人审批',
      })
    }

    // 普通阶段变更（无需审批）：更新 passedStages 和 stageChangedAt
    if (data.followStage && data.followStage !== project.followStage) {
      const { parsePassedStages, computePassedStages } = await import('@/lib/stage-utils')
      const currentPassed = parsePassedStages(project.passedStages)
      const newPassed = computePassedStages(currentPassed, data.followStage as any)
      data.passedStages = JSON.stringify(newPassed)
      data.stageChangedAt = new Date()
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
          { error: '初聊日期格式无效' },
          { status: 400 }
        )
      }
      data.targetDate = d.toISOString()
    } else if (targetDate === null || targetDate === '') {
      // 不允许清空 targetDate（必填字段），保留原值
    }

    const updatedProject = await prisma.project.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json(
      { project: { ...updatedProject, totalAmount: updatedProject.totalAmount, raisedAmount: updatedProject.raisedAmount } }
    )
  } catch (error) {
    console.error('Update project error:', error)
    const isDev = process.env.NODE_ENV !== 'production'
    return NextResponse.json(
      {
        error: '更新项目失败',
        ...(isDev && {
          detail: error instanceof Error ? error.message : String(error),
        }),
      },
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