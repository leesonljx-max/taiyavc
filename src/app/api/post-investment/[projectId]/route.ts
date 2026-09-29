export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject, canEditResearchProject } from '@/lib/research-permissions'
import { getAvailableFunds } from '@/lib/post-investment/funds'
import { computeMetricsWithChange, type MetricWithChange } from '@/lib/post-investment/calc'
import type { PostInvestAnalysisResult } from '@/lib/post-investment/analysis'

/**
 * GET /api/post-investment/[projectId]
 * 投后管理详情：项目信息 + 文档（按期分组）+ 指标时序 + 各期 AI 分析
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
      select: {
        id: true, name: true, companyFullName: true, industry: true, totalAmount: true,
        followStage: true, createdById: true,
        postInvestFund: true, postInvestAmount: true, postInvestDate: true, postInvestConfirmed: true,
        members: { select: { userId: true } },
      },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const [docs, metrics, analyses] = await Promise.all([
      prisma.postInvestDoc.findMany({
        where: { projectId: params.projectId },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.postInvestMetric.findMany({ where: { projectId: params.projectId } }),
      prisma.postInvestAnalysis.findMany({ where: { projectId: params.projectId }, orderBy: { period: 'desc' } }),
    ])

    // 期次页签 = 文档 ∪ 指标 ∪ 分析 的并集（新上传的以往季度立即出现页签，可直接分析），最新在前
    const periodSet = new Set<string>()
    docs.forEach(d => periodSet.add(d.period))
    metrics.forEach(m => periodSet.add(m.period))
    analyses.forEach(a => periodSet.add(a.period))
    const periods = Array.from(periodSet).sort((a, b) => b.localeCompare(a))

    // 指标时序：period → metricKey → value
    const historyByPeriod = new Map<string, Map<string, number>>()
    for (const m of metrics) {
      if (!historyByPeriod.has(m.period)) historyByPeriod.set(m.period, new Map())
      historyByPeriod.get(m.period)!.set(m.metricKey, m.value)
    }

    // 各期带同比环比的指标
    const metricsByPeriod: Record<string, MetricWithChange[]> = {}
    for (const period of periods) {
      const rows = metrics
        .filter(m => m.period === period)
        .map(m => ({ metricKey: m.metricKey, metricName: m.metricName, category: m.category, unit: m.unit, value: m.value, sourceText: m.sourceText }))
      metricsByPeriod[period] = computeMetricsWithChange(period, rows, historyByPeriod)
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        companyFullName: project.companyFullName,
        industry: project.industry,
        totalAmount: project.totalAmount,
        followStage: project.followStage,
      },
      canEdit: canEditResearchProject(currentUser, { createdById: project.createdById, memberIds }),
      investment: project.postInvestConfirmed
        ? { fund: project.postInvestFund, amount: project.postInvestAmount, date: project.postInvestDate, confirmed: true }
        : { fund: null, amount: null, date: null, confirmed: false },
      funds: await getAvailableFunds(),
      periods,
      docs: docs.map(d => ({
        id: d.id,
        docType: d.docType,
        period: d.period,
        fileName: d.fileName,
        fileUrl: d.fileUrl,
        fileType: d.fileType,
        fileSize: d.fileSize,
        hasText: d.text.length > 0,
        uploadedBy: d.user.name || d.user.email,
        uploadedAt: d.createdAt.toISOString(),
      })),
      metricsByPeriod,
      analyses: analyses.map(a => ({
        period: a.period,
        result: (() => {
          try { return JSON.parse(a.summaryJson) as PostInvestAnalysisResult } catch { return null }
        })(),
        createdAt: a.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Post-investment detail error:', error)
    return NextResponse.json({ error: '获取投后详情失败' }, { status: 500 })
  }
}
