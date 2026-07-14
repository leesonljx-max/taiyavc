export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, isMaintainedByUser, type PermissionUser } from '@/lib/permissions'
import { isHighlyOverlapping, similarity } from '@/lib/lead-match'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    const currentUser: PermissionUser | null = session?.user
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

    // scope=all: 项目库（所有可见项目）；scope=mine: 我的项目（仅自己维护的）
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') === 'mine' ? 'mine' : 'all'

    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        investors: { select: { id: true, name: true } },
        investments: { select: { id: true, amount: true, date: true } },
        members: { select: { userId: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })

    const filteredProjects = projects.filter(project => {
      const memberIds = project.members.map(m => m.userId)
      const permProject = {
        followStage: project.followStage,
        createdById: project.createdById,
        memberIds,
      }

      // 1. 必须能查看该项目
      if (!canViewProject(currentUser, permProject)) return false

      // 2. scope=mine 时仅返回自己维护的项目
      if (scope === 'mine') {
        if (!currentUser) return false
        if (!isMaintainedByUser(currentUser, permProject)) return false
      }

      return true
    })

    const result = filteredProjects.map(p => ({
      ...p,
      totalAmount: p.totalAmount,
      raisedAmount: p.raisedAmount,  // 字符串类型，不再 Number() 转换
      investmentCount: p.investments.length,
      investorCount: p.investors.length,
      memberIds: p.members.map(m => m.userId),
    }))

    return NextResponse.json({ projects: result, scope })
  } catch (error) {
    return NextResponse.json(
      { error: '获取项目列表失败' },
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
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      name,
      checkDuplicate,
      financialData,
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
      targetDate,
      keywords,
      aiCardJson,
    } = body ?? {}

    // 显式字段白名单：仅允许以下字段写入数据库，杜绝 mass-assignment
    // 禁止客户端设置：id, createdAt, updatedAt, createdById,
    // passedStages, protectionExpiresAt, stageChangedAt,
    // competitorAnalysisJson, status
    const data: Record<string, any> = {
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

    // financialData: 前端可能发送对象或字符串，统一转为字符串存储
    if (financialData && typeof financialData === 'object') {
      data.financialData = JSON.stringify(financialData)
    } else if (financialData) {
      data.financialData = financialData
    }

    // targetDate: 确保是完整的 ISO-8601 DateTime（"YYYY-MM-DD" → ISO-8601）
    if (targetDate) {
      const d = new Date(targetDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: '初聊日期格式无效' },
          { status: 400 }
        )
      }
      data.targetDate = d.toISOString()
    } else {
      // targetDate 是必填字段，给一个默认值
      data.targetDate = new Date().toISOString()
    }

    // totalAmount: 字符串类型（用户自填单位，如"500万"、"2亿"）
    if (data.totalAmount !== undefined && data.totalAmount !== null) {
      data.totalAmount = String(data.totalAmount).trim()
      if (!data.totalAmount) {
        return NextResponse.json(
          { error: '融资金额不能为空' },
          { status: 400 }
        )
      }
    }

    // raisedAmount: 字符串类型（用户自填单位，如"500万"、"2亿"）
    if (data.raisedAmount !== undefined && data.raisedAmount !== null) {
      data.raisedAmount = String(data.raisedAmount).trim()
    }

    // investmentValuation: 投资估值（亿元），必填字段
    if (data.investmentValuation !== undefined && data.investmentValuation !== null && data.investmentValuation !== '') {
      const v = Number(data.investmentValuation)
      if (isNaN(v)) {
        return NextResponse.json(
          { error: '投资估值格式无效' },
          { status: 400 }
        )
      }
      data.investmentValuation = v
    } else {
      // 空字符串或未提供时存 null
      data.investmentValuation = null
    }

    if (!name) {
      return NextResponse.json(
        { error: '项目名称是必填项' },
        { status: 400 }
      )
    }

    // 必填项校验：所处行业、公司定位、投资估值
    if (!industry || !String(industry).trim()) {
      return NextResponse.json(
        { error: '所处行业是必填项' },
        { status: 400 }
      )
    }
    if (!companyPosition || !String(companyPosition).trim()) {
      return NextResponse.json(
        { error: '公司定位是必填项' },
        { status: 400 }
      )
    }
    if (data.investmentValuation === null || data.investmentValuation === undefined) {
      return NextResponse.json(
        { error: '投资估值是必填项' },
        { status: 400 }
      )
    }

    if (checkDuplicate) {
      const existingProject = await prisma.project.findFirst({
        where: { name },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      })

      if (existingProject) {
        // 计算保护期状态：protectionExpiresAt > now = 保护中；否则已过期
        const now = new Date()
        const protectionExpiresAt = existingProject.protectionExpiresAt
        const isProtected = protectionExpiresAt ? protectionExpiresAt > now : false

        return NextResponse.json(
          {
            error: '项目名称已存在，不允许重复创建',
            warning: '数据库中已存在同名项目，您可以申请接手',
            existingProject: {
              id: existingProject.id,
              name: existingProject.name,
              companyFullName: existingProject.companyFullName,
              createdById: existingProject.createdById,
              createdByName: existingProject.createdBy?.name || existingProject.createdBy?.email || '未知',
              createdAt: existingProject.createdAt,
              protectionExpiresAt: protectionExpiresAt,
              isProtected, // true = 3个月保护期内，需审批；false = 已过期，可直接接手
            }
          },
          { status: 409 }
        )
      }

      return NextResponse.json({ exists: false })
    }

    // 实际创建前再次检查同名（防止并发）
    const existingProject = await prisma.project.findFirst({
      where: { name },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })

    if (existingProject) {
      const now = new Date()
      const protectionExpiresAt = existingProject.protectionExpiresAt
      const isProtected = protectionExpiresAt ? protectionExpiresAt > now : false

      return NextResponse.json(
        {
          error: '项目名称已存在，不允许重复创建',
          warning: '数据库中已存在同名项目，您可以申请接手',
          existingProject: {
            id: existingProject.id,
            name: existingProject.name,
            companyFullName: existingProject.companyFullName,
            createdById: existingProject.createdById,
            createdByName: existingProject.createdBy?.name || existingProject.createdBy?.email || '未知',
            createdAt: existingProject.createdAt,
            protectionExpiresAt: protectionExpiresAt,
            isProtected,
          }
        },
        { status: 409 }
      )
    }

    // ── 项目线索重合检测与合并 ──
    // 查询当前用户可见的全部项目线索
    const leadWhere: any = {}
    if (session.user.role !== 'ADMIN' && session.user.role !== 'INVESTMENT_PARTNER' && session.user.role !== 'INVESTMENT_MANAGER') {
      leadWhere.createdById = session.user.id
    }
    const allLeads = await prisma.projectLead.findMany({ where: leadWhere })

    // 找出与新建项目名称"高度重合"的线索（取相似度最高的一条）
    const overlappingLeads = allLeads
      .map(lead => ({
        lead,
        similarity: similarity(name, lead.name),
        isHighlyOverlapping: isHighlyOverlapping(name, lead.name),
      }))
      .filter(m => m.isHighlyOverlapping)
      .sort((a, b) => b.similarity - a.similarity)

    let mergedLead: { id: string; name: string } | null = null

    if (overlappingLeads.length > 0) {
      const best = overlappingLeads[0].lead

      // 合并线索信息到新建项目（仅填充用户未提供的字段，不覆盖用户输入）
      // 字段映射：线索 → 项目
      const fillIfEmpty = (target: any, key: string, value: string | null | undefined) => {
        if (value && (target[key] === undefined || target[key] === null || target[key] === '')) {
          target[key] = value
        }
      }
      fillIfEmpty(data, 'industry', best.industry)
      fillIfEmpty(data, 'companyPosition', best.companyPosition)
      fillIfEmpty(data, 'mainProducts', best.mainProducts)
      // 融资经历 → 财务数据 / 融资规划（优先 financialData，其次 financingPlan）
      fillIfEmpty(data, 'financialData', best.financingHistory)
      fillIfEmpty(data, 'financingPlan', best.financingHistory)
      fillIfEmpty(data, 'description', best.description)

      mergedLead = { id: best.id, name: best.name }
    }

    // 设置保护期：创建时间 + 3个月（90天）
    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000
    const protectionExpiresAt = new Date(Date.now() + THREE_MONTHS_MS)

    // 设置 passedStages：新建项目默认经过 INITIAL_TALK
    // 如果用户指定了其他阶段，补齐中间阶段
    const initialStage = (data.followStage as string) || 'INITIAL_TALK'
    const { computePassedStages } = await import('@/lib/stage-utils')
    const passedStages = computePassedStages([], initialStage as any)

    const project = await prisma.project.create({
      data: {
        name,
        createdById: session.user.id,
        protectionExpiresAt,
        passedStages: JSON.stringify(passedStages),
        ...data,
      },
    })

    // 创建成功后删除被合并的项目线索
    if (mergedLead) {
      try {
        await prisma.projectLead.delete({ where: { id: mergedLead.id } })
      } catch {
        // 线索可能已被删除，忽略错误
      }
    }

    return NextResponse.json(
      {
        project: { ...project, totalAmount: project.totalAmount, raisedAmount: project.raisedAmount },
        mergedLead,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Create project error:', error)
    // 开发环境返回详细错误信息，便于诊断
    const isDev = process.env.NODE_ENV !== 'production'
    return NextResponse.json(
      {
        error: '创建项目失败',
        ...(isDev && {
          detail: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 }
    )
  }
}