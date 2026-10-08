/**
 * Harness 工具：search_post_investment（投后分析报告检索，零 token）
 *
 * 检索投后管理中生成的 AI 经营分析报告（PostInvestAnalysis），
 * 返回：项目名/行业/报告期/核心结论/异常指标/现金流评估/风险提示
 * 字段白名单控制上下文长度
 */

import prisma from '@/lib/prisma'
import type { HarnessTool } from './types'

/** 投后分析报告摘要（summaryJson 白名单字段） */
interface AnalysisSummary {
  executive_summary?: string
  cashflow_analysis?: { cash_balance?: string; runway_months?: number; assessment?: string }
  anomalies?: Array<{ level?: string; title?: string; detail?: string }>
  risk_alerts?: Array<{ type?: string; level?: string; description?: string }>
}

/** 投后分析检索结果 */
export interface PostInvestHit {
  projectId: string
  projectName: string
  industry: string | null
  period: string
  executiveSummary: string | null
  cashflow: string | null
  anomalies: string[]
  risks: string[]
  analyzedAt: Date
}

/**
 * 检索投后分析报告（按项目名/行业 LIKE 匹配，取最近报告期）
 * - keywords：LLM 传入的检索词数组
 * - 每个项目仅返回最近一期分析（最新报告期优先）
 */
export async function searchPostInvestmentInternal(keywords: string[], limit = 5): Promise<PostInvestHit[]> {
  const kws = (keywords || []).filter(k => typeof k === 'string' && k.trim().length > 0).slice(0, 6)
  if (kws.length === 0) return []

  const or = kws.flatMap(k => [
    { project: { name: { contains: k, mode: 'insensitive' as const } } },
    { project: { industry: { contains: k, mode: 'insensitive' as const } } },
    { project: { companyFullName: { contains: k, mode: 'insensitive' as const } } },
  ])

  const analyses = await prisma.postInvestAnalysis.findMany({
    where: { OR: or },
    select: {
      period: true,
      summaryJson: true,
      createdAt: true,
      project: {
        select: { id: true, name: true, industry: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })

  // 每个项目仅保留最近一期分析
  const byProject = new Map<string, (typeof analyses)[number]>()
  for (const a of analyses) {
    if (!byProject.has(a.project.id)) byProject.set(a.project.id, a)
  }

  return Array.from(byProject.values())
    .slice(0, limit)
    .map(a => {
      let summary: AnalysisSummary = {}
      try {
        summary = JSON.parse(a.summaryJson) as AnalysisSummary
      } catch {
        summary = {}
      }
      const cf = summary.cashflow_analysis
      return {
        projectId: a.project.id,
        projectName: a.project.name,
        industry: a.project.industry,
        period: a.period,
        executiveSummary: summary.executive_summary || null,
        cashflow: cf
          ? [cf.cash_balance ? `现金余额 ${cf.cash_balance}` : null,
             typeof cf.runway_months === 'number' ? `可覆盖约 ${cf.runway_months} 个月` : null,
             cf.assessment].filter(Boolean).join('；') || null
          : null,
        anomalies: (summary.anomalies || [])
          .slice(0, 3)
          .map(x => `${x.title || '异常'}：${(x.detail || '').substring(0, 100)}`)
          .filter(x => !x.endsWith('：')),
        risks: (summary.risk_alerts || [])
          .slice(0, 3)
          .map(x => `[${x.level || '?'}] ${x.type || '风险'}：${(x.description || '').substring(0, 100)}`)
          .filter(x => !x.endsWith('：')),
        analyzedAt: a.createdAt,
      }
    })
}

/** 投后分析检索结果 → Agent 可读文本 */
export function formatPostInvestHits(hits: PostInvestHit[]): string {
  if (hits.length === 0) return '投后管理中未找到相关项目的分析报告。'
  return hits
    .map((h, i) => {
      const lines = [
        `[${i + 1}] ${h.projectName}（${h.period} 报告期${h.industry ? ` · ${h.industry}` : ''}）`,
        h.executiveSummary ? `核心结论：${h.executiveSummary.substring(0, 200)}` : null,
        h.cashflow ? `资金流评估：${h.cashflow}` : null,
        h.anomalies.length > 0 ? `异常指标：${h.anomalies.join('；')}` : null,
        h.risks.length > 0 ? `风险提示：${h.risks.join('；')}` : null,
      ].filter(Boolean)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** search_post_investment 工具定义（Harness 插件） */
export const searchPostInvestmentTool: HarnessTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_post_investment',
      description:
        '检索我们投后管理中已生成的 AI 经营分析报告（含核心结论/异常指标/资金流评估/风险提示），了解已投项目的经营状况。分析已投项目时应优先调用本工具。参数 keywords 为检索词数组（公司名/行业词）。',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '检索词数组，如 ["具身智能"] 或 ["光枢科技"]',
          },
        },
        required: ['keywords'],
      },
    },
  },

  async execute(args) {
    const keywords = Array.isArray(args.keywords)
      ? args.keywords.filter(k => typeof k === 'string')
      : []
    if (keywords.length === 0) return '错误：keywords 不能为空'

    const hits = await searchPostInvestmentInternal(keywords, 5)
    return formatPostInvestHits(hits)
  },
}
