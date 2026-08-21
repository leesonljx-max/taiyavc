/**
 * AI行研 Harness 工具：search_projects（内部项目库检索，零 token）
 *
 * 优先投后/尽调/交割阶段项目，返回：项目名/行业/定位/融资/阶段/尽调结论摘要
 * 字段白名单控制上下文长度（安全考虑：不给原始财务明细等敏感字段）
 */

import prisma from '@/lib/prisma'
import type { HarnessTool } from './types'
import { followStageLabels } from '@/app/projects/types'

/** 项目库检索结果（白名单字段） */
export interface ProjectHit {
  projectId: string
  projectName: string
  industry: string | null
  companyPosition: string | null
  financingRound: string | null
  totalAmount: string
  raisedAmount: string
  followStage: string
  followStageLabel: string
  ddConclusion: string | null
}

/** 投后/深度阶段优先排序权重（数字越小越优先） */
const STAGE_PRIORITY: Record<string, number> = {
  POST_INVESTMENT: 0,
  CLOSING: 1,
  AGREEMENT: 1,
  DUE_DILIGENCE: 2,
  PROJECT_INITIATION: 3,
  PRE_DD: 4,
  INITIAL_TALK: 5,
  REJECTED: 6,
}

/**
 * 检索项目库（名称/行业/定位/产品 LIKE 匹配）
 * - keywords：LLM 传入的检索词数组
 * - 优先返回投后/尽调等深度阶段项目
 * - 附带尽调结论摘要（如有）
 */
export async function searchProjectsInternal(keywords: string[], limit = 5): Promise<ProjectHit[]> {
  const kws = (keywords || []).filter(k => typeof k === 'string' && k.trim().length > 0).slice(0, 6)
  if (kws.length === 0) return []

  const or = kws.flatMap(k => [
    { name: { contains: k, mode: 'insensitive' as const } },
    { industry: { contains: k, mode: 'insensitive' as const } },
    { companyPosition: { contains: k, mode: 'insensitive' as const } },
    { mainProducts: { contains: k, mode: 'insensitive' as const } },
    { companyFullName: { contains: k, mode: 'insensitive' as const } },
  ])

  const projects = await prisma.project.findMany({
    where: { status: { not: 'REJECTED' }, OR: or },
    select: {
      id: true, name: true, industry: true, companyPosition: true,
      financingRound: true, totalAmount: true, raisedAmount: true, followStage: true,
      ddReport: {
        select: {
          moduleResults: {
            where: { status: 'COMPLETED' },
            select: { moduleName: true, conclusion: true },
            take: 3,
          },
        },
      },
    },
    take: 20,
  })

  // 阶段优先排序（投后/交割/尽调在前）
  const sorted = projects
    .sort((a, b) => (STAGE_PRIORITY[a.followStage] ?? 9) - (STAGE_PRIORITY[b.followStage] ?? 9))
    .slice(0, limit)

  return sorted.map(p => {
    const conclusions = (p.ddReport?.moduleResults || [])
      .filter(m => m.conclusion)
      .map(m => `${m.moduleName}：${m.conclusion!.substring(0, 120)}`)
    return {
      projectId: p.id,
      projectName: p.name,
      industry: p.industry,
      companyPosition: p.companyPosition,
      financingRound: p.financingRound,
      totalAmount: p.totalAmount,
      raisedAmount: p.raisedAmount,
      followStage: p.followStage,
      followStageLabel: followStageLabels[p.followStage as keyof typeof followStageLabels] || p.followStage,
      ddConclusion: conclusions.length > 0 ? conclusions.join('；') : null,
    }
  })
}

/** 项目检索结果 → 子Agent 可读文本 */
export function formatProjectHits(hits: ProjectHit[]): string {
  if (hits.length === 0) return '项目库中未找到相关项目。'
  return hits
    .map((h, i) => {
      const lines = [
        `[${i + 1}] ${h.projectName}（${h.followStageLabel}${h.industry ? ` · ${h.industry}` : ''}）`,
        h.companyPosition ? `定位：${h.companyPosition}` : null,
        `本轮融资：${h.totalAmount}${h.raisedAmount ? ` · 累计融资：${h.raisedAmount}` : ''}${h.financingRound ? ` · 轮次：${h.financingRound}` : ''}`,
        h.ddConclusion ? `尽调结论摘要：${h.ddConclusion}` : null,
      ].filter(Boolean)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** search_projects 工具定义（Harness 插件） */
export const searchProjectsTool: HarnessTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_projects',
      description:
        '检索我们内部项目库（含投后/尽调/交割阶段项目），查看是否有与查询相关的项目及其投研结论。回答投资相关问题时应优先调用本工具。参数 keywords 为检索词数组（公司名/行业词/产品词）。',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '检索词数组，如 ["脑机接口"] 或 ["光枢科技", "苏州"]',
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

    const hits = await searchProjectsInternal(keywords, 5)
    return formatProjectHits(hits)
  },
}
