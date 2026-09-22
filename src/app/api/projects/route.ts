export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'
import { buildProjectListWhere, buildProjectScopeWhere } from '@/lib/project-where'
import { isHighlyOverlapping, similarity } from '@/lib/lead-match'

/** 解析 passedStages JSON 数组字符串（累计阶段，与前端 getPassedStages 口径一致） */
function parsePassedStages(passedStages: string | null): string[] {
  if (!passedStages) return ['INITIAL_TALK']
  try {
    const arr = JSON.parse(passedStages)
    return Array.isArray(arr) && arr.length > 0 ? arr : ['INITIAL_TALK']
  } catch {
    return ['INITIAL_TALK']
  }
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    const currentUser: PermissionUser | null = session?.user
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

    // 未登录统一返回 401（项目规范）
    if (!session?.user?.id || !currentUser) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    // scope=all: 项目库（所有可见项目）；scope=mine: 我的项目（仅自己维护的）
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') === 'mine' ? 'mine' : 'all'

    // ── 用户筛选参数（全部下推到数据库 where） ──
    const filters = {
      keyword: (searchParams.get('keyword') || '').trim().slice(0, 100) || undefined,
      stage: (searchParams.get('stage') || '').trim().slice(0, 40) || undefined,
      industry: (searchParams.get('industry') || '').trim().slice(0, 50) || undefined,
      managerId: (searchParams.get('managerId') || '').trim() || undefined,
    }
    const yearNum = parseInt(searchParams.get('year') || '', 10)
    const filtersWithYear = {
      ...filters,
      year: Number.isFinite(yearNum) && yearNum > 1900 && yearNum < 3000 ? yearNum : undefined,
    }

    // ── 分页参数（不传 page = 兼容全量模式，老前端不受影响） ──
    const pageParam = searchParams.get('page')
    const paged = pageParam !== null && pageParam.trim() !== ''
    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10) || 50))

    // 可见性 + 筛选条件完全在 DB 层（等价性由 tests/project-where-equivalence.test.ts 保证）
    const where = buildProjectListWhere(currentUser, scope, filtersWithYear)

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(paged ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        // 只查询列表页需要的字段，避免返回大文本字段
        select: {
          id: true,
          name: true,
          companyFullName: true,
          industry: true,
          companyPosition: true,
          financingRound: true,
          financingPlan: true,
          followStage: true,
          status: true,
          totalAmount: true,
          raisedAmount: true,
          investmentValuation: true,
          targetDate: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          passedStages: true,
          _count: {
            select: {
              investors: true,
              investments: true,
            },
          },
          members: { select: { userId: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.project.count({ where }),
    ])

    const result = projects.map(p => ({
      id: p.id,
      name: p.name,
      companyFullName: p.companyFullName,
      industry: p.industry,
      companyPosition: p.companyPosition,
      financingRound: p.financingRound,
      financingPlan: p.financingPlan,
      followStage: p.followStage,
      status: p.status,
      totalAmount: p.totalAmount,
      raisedAmount: p.raisedAmount,
      investmentValuation: p.investmentValuation,
      targetDate: p.targetDate,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      createdById: p.createdById,
      passedStages: p.passedStages,
      investmentCount: p._count.investments,
      investorCount: p._count.investors,
      memberIds: p.members.map(m => m.userId),
      createdBy: p.createdBy,
    }))

    // ── facets（筛选下拉与统计卡片的数据源） ──
    // 轻量查询：scope 基础集（不含 keyword/stage 筛选），只取 4 个统计字段
    const facetRows = await prisma.project.findMany({
      where: buildProjectScopeWhere(currentUser, scope),
      select: { industry: true, targetDate: true, passedStages: true },
      // workbench 场景不需要全量行排序，加个合理上限防御
      take: 10000,
    })

    // 行业下拉：基础集去重（不随筛选变化，保证选项完整）
    const industries = Array.from(
      new Set(facetRows.map(r => r.industry).filter((i): i is string => !!i))
    ).sort()

    // 年份下拉：基础集 targetDate 年份降序
    const years = Array.from(
      new Set(
        facetRows
          .map(r => (r.targetDate ? new Date(r.targetDate).getFullYear() : null))
          .filter((y): y is number => y !== null)
      )
    ).sort((a, b) => b - a)

    // 累计阶段统计：随行业/年份筛选联动（不随搜索词/阶段本身，与前端原语义一致）
    const yearAndIndustryRows = facetRows.filter(r => {
      const matchesIndustry = !filtersWithYear.industry || r.industry === filtersWithYear.industry
      const matchesYear =
        filtersWithYear.year === undefined ||
        (r.targetDate && new Date(r.targetDate).getFullYear() === filtersWithYear.year)
      return matchesIndustry && matchesYear
    })
    const stageCounts: Record<string, number> = {}
    for (const row of yearAndIndustryRows) {
      for (const stage of parsePassedStages(row.passedStages)) {
        stageCounts[stage] = (stageCounts[stage] || 0) + 1
      }
    }

    // 当前所处阶段统计（workbench 阶段卡片用）：followStage 口径 + 经理筛选
    let currentStageCounts: Record<string, number> | undefined
    if ((searchParams.get('facets') || '').includes('current')) {
      const grouped = await prisma.project.groupBy({
        by: ['followStage'],
        where: buildProjectListWhere(currentUser, scope, { managerId: filters.managerId }),
        _count: { _all: true },
      })
      currentStageCounts = Object.fromEntries(grouped.map(g => [g.followStage, g._count._all]))
    }

    return NextResponse.json({
      projects: result,
      total,
      page: paged ? page : 1,
      pageSize: paged ? pageSize : total,
      scope,
      facets: { industries, years, stageCounts, ...(currentStageCounts ? { currentStageCounts } : {}) },
    })
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
        totalAmount: data.totalAmount as string,
        targetDate: data.targetDate as string,
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