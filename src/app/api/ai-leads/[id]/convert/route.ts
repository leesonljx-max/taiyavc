export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'

/**
 * AI 线索转化为项目
 *
 * POST /api/ai-leads/[id]/convert
 * Body: {
 *   totalAmount: string,           // 必填，融资金额（用户自填单位）
 *   investmentValuation?: number,  // 必填，投资估值（亿元）
 *   targetDate?: string,           // 初聊日期（YYYY-MM-DD 或 ISO-8601）
 *   industry?: string,             // 行业（如未提供则用线索的）
 *   companyPosition?: string,      // 公司定位
 *   // 其他可选字段覆盖
 * }
 *
 * 流程：
 * 1. 校验线索存在且为 AI 来源
 * 2. 校验项目名称不重复
 * 3. 创建 Project（合并线索信息）
 * 4. 更新线索 status=CONVERTED
 */
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

    // 查找线索
    const lead = await prisma.projectLead.findUnique({
      where: { id: params.id },
    })
    if (!lead || lead.source !== 'AI') {
      return NextResponse.json(
        { error: 'AI 线索不存在' },
        { status: 404 }
      )
    }

    if (lead.status === 'CONVERTED') {
      return NextResponse.json(
        { error: '该线索已转化为项目' },
        { status: 400 }
      )
    }

    // 权限：
    // - ADMIN / PARTNER 可转化任意线索
    // - 其他：已释放的全部可转化；未释放的仅创建者可转化
    const canConvert =
      currentUser.role === 'ADMIN' ||
      currentUser.role === 'INVESTMENT_PARTNER' ||
      !!lead.releasedAt ||
      lead.createdById === currentUser.id

    if (!canConvert) {
      return NextResponse.json(
        { error: '无权转化该 AI 线索（线索尚未释放）' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      totalAmount,
      investmentValuation,
      targetDate,
      industry,
      companyPosition,
      mainProducts,
      description,
      companyFullName,
      financingRound,
      financingPlan,
    } = body ?? {}

    // 必填字段校验
    if (!totalAmount || !String(totalAmount).trim()) {
      return NextResponse.json(
        { error: '融资金额是必填项' },
        { status: 400 }
      )
    }

    // 投资估值校验
    let valuation: number | null = null
    if (investmentValuation !== undefined && investmentValuation !== null && investmentValuation !== '') {
      valuation = Number(investmentValuation)
      if (isNaN(valuation)) {
        return NextResponse.json(
          { error: '投资估值格式无效' },
          { status: 400 }
        )
      }
    }
    if (valuation === null) {
      return NextResponse.json(
        { error: '投资估值是必填项' },
        { status: 400 }
      )
    }

    // 行业 / 公司定位 必填
    const finalIndustry = String(industry || lead.industry || '').trim()
    const finalPosition = String(companyPosition || lead.companyPosition || '').trim()
    if (!finalIndustry) {
      return NextResponse.json(
        { error: '所处行业是必填项' },
        { status: 400 }
      )
    }
    if (!finalPosition) {
      return NextResponse.json(
        { error: '公司定位是必填项' },
        { status: 400 }
      )
    }

    // 项目名称重复检查
    const existing = await prisma.project.findFirst({
      where: { name: lead.name },
      select: { id: true, name: true },
    })
    if (existing) {
      return NextResponse.json(
        {
          error: '项目名称已存在',
          warning: '数据库中已存在同名项目，请先重命名线索或接手原项目',
          existingProject: { id: existing.id, name: existing.name },
        },
        { status: 409 }
      )
    }

    // targetDate 转换为 ISO-8601
    let initialTalkDate: Date
    if (targetDate) {
      const d = new Date(targetDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: '初聊日期格式无效' },
          { status: 400 }
        )
      }
      initialTalkDate = d
    } else {
      // 默认用线索的 announceDate 或当前时间
      initialTalkDate = new Date()
    }

    // 转化时合并线索数据：用户输入优先，线索字段作为默认值
    const projectData: any = {
      name: lead.name,
      companyFullName: companyFullName || null,
      industry: finalIndustry,
      companyPosition: finalPosition,
      mainProducts: mainProducts || lead.mainProducts || null,
      description: description || lead.description || lead.aiSummary || null,
      financingRound: financingRound || lead.fundingRound || null,
      financingPlan: financingPlan || null,
      totalAmount: String(totalAmount).trim(),
      raisedAmount: lead.fundingAmount || '', // 历史累计融资金额，复用线索的融资信息
      investmentValuation: valuation,
      targetDate: initialTalkDate,
      followStage: 'INITIAL_TALK',
      status: 'PENDING',
      createdById: session.user.id,
      // 保护期：3个月
      protectionExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      passedStages: JSON.stringify(['INITIAL_TALK']),
      stageChangedAt: new Date(),
    }

    // 创建项目（事务，确保项目创建和线索状态更新同时成功）
    const [project] = await prisma.$transaction([
      prisma.project.create({ data: projectData }),
      prisma.projectLead.update({
        where: { id: lead.id },
        data: {
          status: 'CONVERTED',
        },
      }),
    ])

    return NextResponse.json(
      {
        success: true,
        project,
        leadId: lead.id,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('AI lead convert error:', error)
    return NextResponse.json(
      { error: '转化 AI 线索失败' },
      { status: 500 }
    )
  }
}
