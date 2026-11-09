/**
 * 九大模块查询规划
 *
 * 纯函数：不访问网络/数据库，便于单测与成本预估。
 * 每模块 5 条查询，9 模块共 45 条，正好落在预算上限内。
 */

import { DD_MODULE_KEYS, DD_SEARCH_BUDGET } from './constants'
import { DD_TEMPLATE_MODULES, getTemplateModule } from '@/lib/dd-workbench/template'

export interface ResearchProjectInput {
  name: string
  companyFullName?: string | null
  industry?: string | null
  companyPosition?: string | null
  mainProducts?: string | null
  financingRound?: string | null
  coreAdvantage?: string | null
  competitors?: string | null
  description?: string | null
}

export interface DDModuleQueryPlan {
  moduleKey: string
  moduleName: string
  coreQuestion: string
  queries: string[]
}

const QUERIES: Record<string, (ctx: QueryContext) => string[]> = {
  PROJECT_ENTITY: ({ entity, short, round }) => [
    `${entity} 工商信息 注册资本 股东`,
    `${entity} 成立时间 法定代表人 统一社会信用代码`,
    `${short} 融资历史 投资方 ${round}`.trim(),
    `${entity} 股权结构 增资 股权转让`,
    `${short} 官网 公司简介 主营业务`,
  ],
  PRODUCT_TECHNOLOGY: ({ entity, short, industry }) => [
    `${short} 产品 型号 参数 规格`,
    `${short} 核心技术 技术路线 架构`,
    `${entity} 专利 知识产权 发明`,
    `${short} 量产 良率 产能 交付`,
    `${industry} ${short} 产品 评测 对比`,
  ],
  TEAM_GOVERNANCE: ({ entity, short }) => [
    `${short} 创始人 履历 背景`,
    `${entity} 核心团队 CTO CFO COO`,
    `${short} 股权激励 期权池`,
    `${entity} 关联公司 关联交易`,
    `${short} 团队 离职 变动 招聘`,
  ],
  MARKET_CUSTOMERS: ({ short, industry, year }) => [
    `${industry} 市场规模 ${year}`,
    `${industry} 政策 规划 监管`,
    `${short} 客户 案例 落地`,
    `${industry} 需求 趋势 渗透率`,
    `${short} 中标 采购 项目`,
  ],
  COMMERCIALIZATION: ({ short, industry }) => [
    `${short} 订单 合同 中标`,
    `${short} 营收 收入 回款`,
    `${short} 客户 合作 复购`,
    `${short} 渠道 经销 代理`,
    `${industry} 商业模式 客单价`,
  ],
  COMPETITION_MOATS: ({ short, industry, competitors, year }) => [
    `${industry} 竞品 竞争对手`,
    `${short} 竞争对手 对比 ${competitors}`.trim(),
    `${industry} 市场份额 竞争格局 ${year}`,
    `${short} 技术壁垒 切换成本`,
    `${short} 替代方案 差异化`,
  ],
  FINANCE_ECONOMICS: ({ entity, short, industry }) => [
    `${short} 营收 利润 毛利率`,
    `${short} 融资 估值`,
    `${industry} 毛利率 成本结构`,
    `${short} 现金流 融资需求`,
    `${entity} 审计 财务报表`,
  ],
  LEGAL_COMPLIANCE: ({ entity, short, industry }) => [
    `${entity} 诉讼 仲裁 被执行人`,
    `${entity} 行政处罚 经营异常`,
    `${short} 知识产权 侵权 纠纷`,
    `${short} 资质 许可证 备案`,
    `${industry} 数据合规 监管 政策`,
  ],
  VALUATION_DEAL: ({ short, industry, year }) => [
    `${industry} 融资 估值 ${year}`,
    `${short} 融资 估值 轮次`,
    `${industry} 并购 案例 估值倍数`,
    `${short} IPO 上市 退出`,
    `${industry} 投资 条款 优先清算`,
  ],
}

interface QueryContext {
  entity: string
  short: string
  industry: string
  round: string
  competitors: string
  year: number
}

function cleanQuery(q: string): string {
  return q.replace(/\s+/g, ' ').trim()
}

export function buildQueryPlan(
  project: ResearchProjectInput,
  moduleKeys?: string[],
  options?: { year?: number }
): DDModuleQueryPlan[] {
  const baseIndustry = (project.industry || '').trim()
  const industry = baseIndustry || project.companyPosition?.trim() || '行业'
  const ctx: QueryContext = {
    entity: (project.companyFullName || project.name).trim(),
    short: project.name.trim(),
    industry,
    round: (project.financingRound || '').trim(),
    competitors: (project.competitors || '').trim().slice(0, 30),
    year: options?.year ?? new Date().getFullYear(),
  }

  const keys = moduleKeys?.length
    ? moduleKeys.filter(k => (DD_MODULE_KEYS as readonly string[]).includes(k))
    : [...DD_MODULE_KEYS]

  const perModule = Math.min(6, Math.floor(DD_SEARCH_BUDGET.maxSearches / Math.max(keys.length, 1)))
  const limit = Math.max(4, perModule)

  return keys.map(key => {
    const tpl = getTemplateModule(key) || DD_TEMPLATE_MODULES[0]
    const builder = QUERIES[key]
    const raw = builder ? builder(ctx) : [`${ctx.short} ${tpl.name}`]
    const seen = new Set<string>()
    const queries: string[] = []
    for (const q of raw) {
      const cleaned = cleanQuery(q)
      if (!cleaned || seen.has(cleaned)) continue
      seen.add(cleaned)
      queries.push(cleaned)
      if (queries.length >= limit) break
    }
    return {
      moduleKey: key,
      moduleName: tpl.name,
      coreQuestion: tpl.coreQuestion,
      queries,
    }
  })
}
