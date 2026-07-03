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
      totalAmount: Number(p.totalAmount),
      raisedAmount: Number(p.raisedAmount),
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
        { error: '登录已过期，请退出后重新登录', detail: 'session.user.id is missing' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { name, checkDuplicate, financialData, ...data } = body

    // financialData: 前端可能发送对象或字符串，统一转为字符串存储
    if (financialData && typeof financialData === 'object') {
      data.financialData = JSON.stringify(financialData)
    } else if (financialData) {
      data.financialData = financialData
    }

    // targetDate: 确保是完整的 ISO-8601 DateTime
    if (data.targetDate) {
      const d = new Date(data.targetDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: '目标日期格式无效', detail: `targetDate: ${data.targetDate}` },
          { status: 400 }
        )
      }
      data.targetDate = d.toISOString()
    } else {
      // targetDate 是必填字段，给一个默认值
      data.targetDate = new Date().toISOString()
    }

    // totalAmount: 确保是数字
    if (data.totalAmount !== undefined) {
      const n = Number(data.totalAmount)
      if (isNaN(n)) {
        return NextResponse.json(
          { error: '目标金额格式无效', detail: `totalAmount: ${data.totalAmount}` },
          { status: 400 }
        )
      }
      data.totalAmount = n
    }

    // 移除不应由前端直接设置的字段
    delete data.id
    delete data.createdAt
    delete data.updatedAt
    delete data.createdById

    if (!name) {
      return NextResponse.json(
        { error: '项目名称是必填项' },
        { status: 400 }
      )
    }

    if (checkDuplicate) {
      const existingProject = await prisma.project.findFirst({
        where: { name },
      })

      if (existingProject) {
        return NextResponse.json(
          { 
            error: '可能存在重复项目', 
            warning: '数据库中已存在同名项目',
            existingProject: {
              id: existingProject.id,
              name: existingProject.name,
              companyFullName: existingProject.companyFullName,
            }
          },
          { status: 409 }
        )
      }

      return NextResponse.json({ exists: false })
    }

    const existingProject = await prisma.project.findFirst({
      where: { name },
    })

    if (existingProject) {
      return NextResponse.json(
        {
          error: '可能存在重复项目',
          warning: '数据库中已存在同名项目',
          existingProject: {
            id: existingProject.id,
            name: existingProject.name,
            companyFullName: existingProject.companyFullName,
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

    const project = await prisma.project.create({
      data: {
        name,
        createdById: session.user.id,
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
        project: { ...project, totalAmount: Number(project.totalAmount), raisedAmount: Number(project.raisedAmount) },
        mergedLead,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Create project error:', error)
    return NextResponse.json(
      { error: '创建项目失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}