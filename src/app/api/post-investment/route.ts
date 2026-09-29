export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject } from '@/lib/research-permissions'
import { getAvailableFunds } from '@/lib/post-investment/funds'
import type { PostInvestAnalysisResult } from '@/lib/post-investment/analysis'

/** 当前季度（用于统计"本季已提交/待提交"） */
function currentQuarter(): string {
  const now = new Date()
  return `${now.getFullYear()}Q${Math.floor(now.getMonth() / 3) + 1}`
}

/** 从分析结果提取风险等级（取风险提示与异常的最高级） */
function topRiskLevel(analysis: PostInvestAnalysisResult | null): 'high' | 'medium' | 'low' | null {
  if (!analysis) return null
  const levels = [
    ...analysis.risk_alerts.map(r => r.level),
    ...analysis.anomalies.filter(a => a.level !== 'positive').map(a => a.level),
  ] as Array<'high' | 'medium' | 'low'>
  if (levels.includes('high')) return 'high'
  if (levels.includes('medium')) return 'medium'
  if (levels.length > 0) return 'low'
  return null
}

/**
 * GET /api/post-investment
 * 投后管理列表：交割后（POST_INVESTMENT）阶段项目 + 各项目最新期 AI 分析摘要与风险
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const projects = await prisma.project.findMany({
      where: { followStage: 'POST_INVESTMENT' },
      select: {
        id: true, name: true, companyFullName: true, industry: true, totalAmount: true,
        postInvestFund: true, postInvestAmount: true, postInvestDate: true, postInvestConfirmed: true,
        createdById: true, updatedAt: true,
        members: { select: { userId: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })
    const visible = projects.filter(p =>
      canViewResearchProject(currentUser, { createdById: p.createdById, memberIds: p.members.map(m => m.userId) })
    )

    const quarter = currentQuarter()
    const items = []
    let submittedCount = 0
    let riskCount = 0
    for (const p of visible) {
      const [latestAnalysisRecord, docCount, quarterDocCount] = await Promise.all([
        prisma.postInvestAnalysis.findFirst({ where: { projectId: p.id }, orderBy: { period: 'desc' } }),
        prisma.postInvestDoc.count({ where: { projectId: p.id } }),
        prisma.postInvestDoc.count({ where: { projectId: p.id, period: quarter } }),
      ])
      let analysis: PostInvestAnalysisResult | null = null
      try {
        analysis = latestAnalysisRecord ? (JSON.parse(latestAnalysisRecord.summaryJson) as PostInvestAnalysisResult) : null
      } catch { analysis = null }
      const riskLevel = topRiskLevel(analysis)
      const submitted = quarterDocCount > 0
      if (submitted) submittedCount++
      if (riskLevel === 'high' || riskLevel === 'medium') riskCount++

      items.push({
        id: p.id,
        name: p.name,
        companyFullName: p.companyFullName,
        industry: p.industry,
        totalAmount: p.totalAmount,
        investment: p.postInvestConfirmed
          ? { fund: p.postInvestFund, amount: p.postInvestAmount, date: p.postInvestDate }
          : null,
        docCount,
        latestPeriod: latestAnalysisRecord?.period || null,
        latestSummary: analysis?.executive_summary || null,
        riskLevel,
        submittedThisQuarter: submitted,
        updatedAt: p.updatedAt.toISOString(),
      })
    }

    return NextResponse.json({
      projects: items,
      stats: {
        total: visible.length,
        quarter,
        submitted: submittedCount,
        pending: visible.length - submittedCount,
        riskCount,
      },
      funds: await getAvailableFunds(),
    })
  } catch (error) {
    console.error('Post-investment list error:', error)
    return NextResponse.json({ error: '获取投后项目列表失败' }, { status: 500 })
  }
}
