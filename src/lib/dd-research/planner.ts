/**
 * 九大模块查询规划
 *
 * 纯函数：不访问网络/数据库，便于单测与成本预估。
 * 每模块最多 8 条查询，9 模块共 72 条，正好落在预算上限内。
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
  PROJECT_ENTITY: ({ entity, short, round, year }) => [
    `${entity} 工商信息 注册资本 股东 法定代表人`,
    `${entity} 成立时间 统一社会信用代码 参保人数`,
    `${short} 官网 公司简介 主营业务`,
    `${short} 融资历史 投资方 ${round} ${year}`.trim(),
    `${entity} 股权结构 增资 股权转让`,
    `${short} 品牌 商标 知识产权`,
    `${short} 招聘 规模 分支机构`,
    `${entity} 企查查 天眼查 经营状态`,
  ],
  PRODUCT_TECHNOLOGY: ({ short, industry, year }) => [
    `${short} 产品 型号 参数 规格`,
    `${short} 核心技术 技术路线 架构 算法`,
    `${short} 专利 发明专利 知识产权`,
    `${short} 量产 良率 产能 交付`,
    `${industry} ${short} 产品 评测 对比`,
    `${short} 研发投入 研发团队 实验室`,
    `${short} 客户案例 解决方案 部署`,
    `${industry} 技术趋势 ${year}`,
  ],
  TEAM_GOVERNANCE: ({ entity, short }) => [
    `${short} 创始人 履历 背景 教育`,
    `${short} 创始人 访谈 演讲 报道`,
    `${entity} 核心团队 CTO CFO COO`,
    `${short} 高管 履历 前任职`,
    `${short} 股权激励 期权池`,
    `${entity} 关联公司 关联交易`,
    `${short} 团队 离职 变动 招聘`,
    `${short} 董事会 治理 投资人 董事`,
  ],
  MARKET_CUSTOMERS: ({ short, industry, year, prev }) => [
    `${industry} 市场规模 ${year} ${prev}`,
    `${industry} 政策 规划 监管 十四五`,
    `${industry} 需求 趋势 渗透率`,
    `${industry} 产业链 上游 下游`,
    `${short} 客户 案例 落地`,
    `${short} 中标 采购 项目 招标`,
    `${industry} 细分市场 增长 预测`,
    `${industry} 出海 全球 市场 ${year}`,
  ],
  COMMERCIALIZATION: ({ short, industry }) => [
    `${short} 订单 合同 中标 金额`,
    `${short} 营收 收入 回款`,
    `${short} 客户 合作 复购`,
    `${short} 渠道 经销 代理 合作伙伴`,
    `${industry} 商业模式 客单价 付费`,
    `${short} 产能 交付 供应链`,
    `${short} 定价 收费 模式`,
    `${short} 客户 名单 大客户`,
  ],
  COMPETITION_MOATS: ({ short, industry, competitors, year }) => [
    `${industry} 竞品 竞争对手 格局`,
    `${short} 竞争对手 对比 ${competitors}`.trim(),
    `${industry} 市场份额 集中度 ${year}`,
    `${short} 技术壁垒 切换成本`,
    `${short} 替代方案 差异化`,
    `${industry} 头部企业 融资 ${year}`,
    `${short} 护城河 优势 劣势`,
    `${industry} 价格战 竞争 趋势`,
  ],
  FINANCE_ECONOMICS: ({ entity, short, industry }) => [
    `${short} 营收 利润 毛利率`,
    `${short} 融资 估值 轮次`,
    `${industry} 毛利率 成本结构`,
    `${short} 现金流 融资需求 亏损`,
    `${entity} 审计 财务报表`,
    `${short} 收入 构成 占比`,
    `${industry} 单位经济模型 UE`,
    `${short} 盈利 时间 预测`,
  ],
  LEGAL_COMPLIANCE: ({ entity, short, industry }) => [
    `${entity} 诉讼 仲裁 被执行人`,
    `${entity} 行政处罚 经营异常`,
    `${short} 知识产权 侵权 纠纷`,
    `${short} 资质 许可证 备案`,
    `${industry} 数据合规 监管 政策`,
    `${short} 合同 纠纷 劳动争议`,
    `${entity} 股权冻结 失信`,
    `${industry} 准入 标准 认证`,
  ],
  VALUATION_DEAL: ({ short, industry, year }) => [
    `${industry} 融资 估值 ${year}`,
    `${short} 融资 估值 轮次`,
    `${industry} 并购 案例 估值倍数`,
    `${short} IPO 上市 退出`,
    `${industry} 投资 条款 优先清算`,
    `${industry} 可比公司 PS PE`,
    `${short} 老股 转让 估值`,
    `${industry} 一级市场 融资 趋势 ${year}`,
  ],
}

interface QueryContext {
  entity: string
  short: string
  industry: string
  round: string
  competitors: string
  year: number
  prev: number
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
    prev: (options?.year ?? new Date().getFullYear()) - 1,
  }

  const keys = moduleKeys?.length
    ? moduleKeys.filter(k => (DD_MODULE_KEYS as readonly string[]).includes(k))
    : [...DD_MODULE_KEYS]

  const perModule = Math.min(8, Math.floor(DD_SEARCH_BUDGET.maxSearches / Math.max(keys.length, 1)))
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
