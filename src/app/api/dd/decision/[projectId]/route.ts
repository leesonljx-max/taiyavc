export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject, canEditResearchProject } from '@/lib/research-permissions'
import { isReportReady, getProjectModuleResources } from '@/lib/dd-workbench/resources'

/** 决策门槛：至少 3 位合伙人确认 */
const MIN_PARTNERS = 3

const DECISIONS = ['INVEST', 'NO_INVEST', 'UNDECIDED'] as const

/**
 * GET /api/dd/decision/[projectId]
 * 投资决策状态（报告生成后开放第 10 模块）：
 * - reportReady=false → 第 10 模块不开放
 * - 决策未收满 3 人 → PENDING（维护人看"待决策中"；合伙人另见"待其他合伙人决策中"）
 * - ≥3 人且全部 INVEST → INVEST（各合伙人 + 金额）
 * - 任一 NO_INVEST/UNDECIDED → NO_INVEST
 */
export async function GET(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const resources = await getProjectModuleResources(params.projectId)
    const reportReady = isReportReady(resources)

    const decisions = await prisma.dDInvestmentDecision.findMany({
      where: { projectId: params.projectId },
      include: { partner: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
    })

    const count = decisions.length
    const allInvest = count >= MIN_PARTNERS && decisions.every(d => d.decision === 'INVEST')
    const hasNegative = decisions.some(d => d.decision === 'NO_INVEST' || d.decision === 'UNDECIDED')
    const finalStatus = allInvest ? 'INVEST' : hasNegative ? 'NO_INVEST' : 'PENDING'

    return NextResponse.json({
      reportReady,
      finalStatus,
      minPartners: MIN_PARTNERS,
      decisionCount: count,
      canDecide: session.user.role === 'INVESTMENT_PARTNER' || session.user.role === 'ADMIN',
      myDecision: decisions.find(d => d.partnerId === session.user.id) || null,
      decisions: decisions.map(d => ({
        partnerName: d.partner.name || d.partner.email,
        partnerId: d.partnerId,
        decision: d.decision,
        amount: d.amount,
        reason: d.reason,
        updatedAt: d.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('DD decision get error:', error)
    return NextResponse.json({ error: '获取投资决策失败' }, { status: 500 })
  }
}

/**
 * POST /api/dd/decision/[projectId]
 * 提交/修改投资决策（仅投资合伙人/管理员；报告生成后开放）
 * body: { decision: 'INVEST'|'NO_INVEST'|'UNDECIDED', amount?: number, reason?: string }
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role
    if (role !== 'INVESTMENT_PARTNER' && role !== 'ADMIN') {
      return NextResponse.json({ error: '仅投资合伙人可提交投资决策' }, { status: 403 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: role as UserRole }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权操作该项目' }, { status: 403 })
    }

    // 报告生成后才可决策
    const resources = await getProjectModuleResources(params.projectId)
    if (!isReportReady(resources)) {
      return NextResponse.json({ error: '尽调报告尚未生成，生成后开放投资决策' }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      decision?: string
      amount?: number
      reason?: string
    }
    const decision = String(body.decision || '')
    if (!DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
      return NextResponse.json({ error: '决策值无效（投资/不投资/纠结中）' }, { status: 400 })
    }
    const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) && body.amount > 0 ? body.amount : null
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : ''
    if (decision === 'INVEST' && !amount) {
      return NextResponse.json({ error: '选择投资时必须填写投资金额' }, { status: 400 })
    }

    await prisma.dDInvestmentDecision.upsert({
      where: { projectId_partnerId: { projectId: params.projectId, partnerId: session.user.id } },
      create: {
        projectId: params.projectId,
        partnerId: session.user.id,
        decision,
        amount: decision === 'INVEST' ? amount : null,
        reason: reason || null,
      },
      update: {
        decision,
        amount: decision === 'INVEST' ? amount : null,
        reason: reason || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DD decision post error:', error)
    return NextResponse.json({ error: '提交投资决策失败' }, { status: 500 })
  }
}
