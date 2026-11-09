/**
 * 年度报告数据聚合（数据库查询 -> 快照 JSON）
 */

import prisma from '@/lib/prisma'
import { backfillStageEvents } from './stage-events'
import { buildAnnualMetrics, type ProjectInput } from './metrics'
import { yearRange } from './time-window'
import type { AnnualReportData, AnnualReportType } from './types'

const COMPANY_OWNER_KEY = '__company__'

export interface AggregateResult {
  data: AnnualReportData
  projects: ProjectInput[]
  metrics: ReturnType<typeof buildAnnualMetrics>
}

interface AggregateOptions {
  year: number
  type: AnnualReportType
  userId?: string | null
  ownerName?: string
}

export async function aggregateAnnualReport(options: AggregateOptions): Promise<AggregateResult> {
  const { year, type } = options
  const range = yearRange(year)

  // 历史项目补齐阶段事件（进程内只跑一次，失败不阻断报告）
  try {
    await backfillStageEvents()
  } catch (error) {
    console.error('[annual-report] 阶段事件回填失败，继续使用现有数据:', error)
  }

  const isPersonal = type === 'PERSONAL'
  if (isPersonal && !options.userId) throw new Error('个人版年报缺少用户信息')

  const projectsRaw = await prisma.project.findMany({
    where: isPersonal
      ? {
          OR: [
            { createdById: options.userId as string },
            { members: { some: { userId: options.userId as string } } },
          ],
        }
      : {},
    select: {
      id: true,
      name: true,
      companyFullName: true,
      industry: true,
      followStage: true,
      passedStages: true,
      targetDate: true,
      createdAt: true,
      stageChangedAt: true,
      totalAmount: true,
      investmentValuation: true,
      financingRound: true,
      companyPosition: true,
      description: true,
      createdById: true,
      createdBy: { select: { name: true, avatar: true } },
      members: { select: { userId: true } },
      stageEvents: {
        select: { toStage: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      },
    },
    orderBy: { targetDate: 'desc' },
  })

  const mainProjects = isPersonal
    ? projectsRaw.filter(project => project.createdById === options.userId)
    : projectsRaw
  const collaborationCount = isPersonal
    ? projectsRaw.filter(project => project.createdById !== options.userId).length
    : undefined

  const projects: ProjectInput[] = mainProjects.map(project => ({
    id: project.id,
    name: project.name,
    companyFullName: project.companyFullName,
    industry: project.industry,
    followStage: project.followStage,
    passedStages: project.passedStages,
    targetDate: project.targetDate,
    createdAt: project.createdAt,
    stageChangedAt: project.stageChangedAt,
    totalAmount: project.totalAmount,
    investmentValuation: project.investmentValuation,
    financingRound: project.financingRound,
    companyPosition: project.companyPosition,
    description: project.description,
    createdById: project.createdById,
    createdByName: project.createdBy?.name ?? '未知用户',
    createdByAvatar: project.createdBy?.avatar ?? null,
    memberIds: project.members.map(member => member.userId),
    events: project.stageEvents.map(event => ({ toStage: event.toStage, occurredAt: event.occurredAt })),
    counts: { documents: 0, notes: 0, reviews: 0 },
  }))

  const metrics = buildAnnualMetrics(projects, year, type)
  const projectIds = mainProjects.map(project => project.id)

  const [documents, notes, reviews, ddProjects, postInvestRows, leads] = await Promise.all([
    projectIds.length > 0
      ? prisma.projectDocument.count({
          where: { projectId: { in: projectIds }, createdAt: { gte: range.start, lt: range.end } },
        })
      : Promise.resolve(0),
    projectIds.length > 0
      ? prisma.followUpNote.count({
          where: { projectId: { in: projectIds }, createdAt: { gte: range.start, lt: range.end } },
        })
      : Promise.resolve(0),
    projectIds.length > 0
      ? prisma.partnerReview.count({
          where: { projectId: { in: projectIds }, createdAt: { gte: range.start, lt: range.end } },
        })
      : Promise.resolve(0),
    projectIds.length > 0
      ? prisma.dDReport.count({
          where: { projectId: { in: projectIds }, createdAt: { gte: range.start, lt: range.end } },
        })
      : Promise.resolve(0),
    projectIds.length > 0
      ? prisma.postInvestAnalysis.findMany({
          where: { projectId: { in: projectIds }, createdAt: { gte: range.start, lt: range.end } },
          select: { projectId: true },
          distinct: ['projectId'],
        })
      : Promise.resolve([]),
    isPersonal
      ? Promise.resolve([])
      : prisma.projectLead.findMany({
          where: { createdAt: { gte: range.start, lt: range.end } },
          select: { source: true, status: true },
        }),
  ])

  const pageCount = isPersonal ? 8 : 10
  const data: AnnualReportData = {
    meta: {
      year,
      type,
      ownerKey: isPersonal ? (options.userId as string) : COMPANY_OWNER_KEY,
      ownerName: isPersonal ? options.ownerName || '项目维护人' : '泰亚投资',
      generatedAt: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      templateVersion: 'v1',
      pageCount,
      scopeLabel: isPersonal ? '项目维护人版' : '公司版',
    },
    kpis: metrics.kpis,
    funnel: metrics.funnel,
    monthly: metrics.monthly,
    industries: metrics.industries,
    monthlyIndustry: metrics.monthlyIndustry,
    monthlyFocus: metrics.monthlyFocus,
    maintainers: metrics.maintainers,
    highlights: metrics.highlights,
    financing: [],
    milestones: metrics.milestones,
    activity: {
      documents,
      notes,
      reviews,
      ddProjects,
      postInvestProjects: postInvestRows.length,
    },
    leads: {
      total: leads.length,
      ai: leads.filter(lead => lead.source === 'AI').length,
      converted: leads.filter(lead => lead.status === 'CONVERTED').length,
    },
    quality: metrics.quality,
    insights: {
      keywords: [],
      theme: '',
      overview: '',
      highlights: [],
      gaps: [],
      nextYear: [],
    },
    ...(typeof collaborationCount === 'number' ? { collaborationCount } : {}),
    comparison: metrics.comparison,
  }

  return { data, projects, metrics }
}

export { COMPANY_OWNER_KEY }
