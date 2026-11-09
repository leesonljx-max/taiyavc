/**
 * 年度报告生成任务
 *
 * 队列状态：QUEUED -> GENERATING -> READY / FAILED
 */

import prisma from '@/lib/prisma'
import { aggregateAnnualReport } from './aggregate'
import { selectFinancingCohort } from './metrics'
import { researchFinancingProgress } from './research'
import { buildRuleInsights, enhanceInsightsWithAi } from './insights'
import type { AnnualReportData, AnnualReportType } from './types'

const RESEARCH_LIMIT: Record<AnnualReportType, number> = {
  PERSONAL: 8,
  COMPANY: 12,
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : '生成失败').slice(0, 300)
}

export async function generateAnnualReport(reportId: string): Promise<void> {
  const report = await prisma.annualReport.findUnique({ where: { id: reportId } })
  if (!report) return
  if (report.status === 'READY') return

  const claimed = await prisma.annualReport.updateMany({
    where: { id: reportId, status: { in: ['QUEUED', 'FAILED'] } },
    data: {
      status: 'GENERATING',
      phase: 'COLLECTING',
      progress: 5,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    },
  })
  if (claimed.count === 0) return

  try {
    const type = report.type as AnnualReportType
    const result = await aggregateAnnualReport({
      year: report.year,
      type,
      userId: report.ownerId,
      ownerName: report.ownerKey === '__company__' ? '泰亚投资' : undefined,
    })
    const data: AnnualReportData = result.data

    // 融资进展（只查年度进入 PreDD/立项/尽调 的项目，限额）
    const cohort = selectFinancingCohort(result.projects, result.metrics, RESEARCH_LIMIT[type])
    if (cohort.length > 0) {
      await prisma.annualReport.update({
        where: { id: reportId },
        data: { phase: 'RESEARCHING', progress: 35 },
      })
      const research = await researchFinancingProgress(cohort, report.year, cohort.length, async (done, total) => {
        const progress = 35 + Math.round((done / Math.max(total, 1)) * 45)
        await prisma.annualReport
          .update({ where: { id: reportId }, data: { progress: Math.min(progress, 80) } })
          .catch(() => {})
      })
      data.financing = research.items
      data.quality.researchFailed = research.failed

      // 把有公开新融资的项目补进里程碑
      const financingMilestones = research.items
        .filter(item => item.progressType === 'NEW_ROUND' || item.progressType === 'ROUND_UP')
        .slice(0, 2)
        .map(item => ({
          id: `financing-${item.projectId}`,
          name: item.projectName,
          kind: '融资',
          title: item.latestRound ? `完成${item.latestRound}融资` : '公开融资进展',
          detail: [item.amount, item.investors.slice(0, 2).join('、')].filter(Boolean).join(' · ') || '公开信息检索到新进展',
          month: item.eventDate ? Number(item.eventDate.slice(5, 7)) || null : null,
          amount: item.amount,
        }))
      data.milestones = [...financingMilestones, ...data.milestones].slice(0, 8)
    }

    await prisma.annualReport.update({
      where: { id: reportId },
      data: { phase: 'COMPOSING', progress: 85 },
    })

    const ruleInsights = buildRuleInsights(data)
    const aiInsights = await enhanceInsightsWithAi(data)
    data.insights = aiInsights || ruleInsights

    await prisma.annualReport.update({
      where: { id: reportId },
      data: {
        status: 'READY',
        phase: null,
        progress: 100,
        dataJson: JSON.stringify(data),
        summaryJson: JSON.stringify({
          theme: data.insights.theme,
          overview: data.insights.overview,
          keywords: data.insights.keywords,
        }),
        pageCount: data.meta.pageCount,
        generatedAt: new Date(),
        finishedAt: new Date(),
        error: null,
      },
    })
  } catch (error) {
    console.error(`[annual-report] 生成失败 ${reportId}:`, error)
    await prisma.annualReport
      .update({
        where: { id: reportId },
        data: { status: 'FAILED', phase: null, error: errorText(error), finishedAt: new Date() },
      })
      .catch(() => {})
  }
}
