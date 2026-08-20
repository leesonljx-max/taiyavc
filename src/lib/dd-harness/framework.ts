/**
 * 尽调框架纯函数核心（无 prisma / 无网络依赖，可独立单测）
 *
 * - 7 大必选模块强制包含（硬约束）
 * - inputHash：模块输入指纹，增量重跑判断
 * - filterCitations：引用交叉验证（只保留真实搜索结果中的 URL，防编造）
 * - aggregateGaps：缺口清单汇总
 */

import { createHash } from 'crypto'
import type {
  DDFramework,
  FrameworkGenOutput,
  FrameworkModule,
  ModuleAnalysisOutput,
  DDGap,
} from './types'

/** 7 大必选模块（强制包含，不可被 AI 移除） */
export const FIXED_MODULES: FrameworkModule[] = [
  {
    key: 'mainProducts',
    name: '主要产品',
    required: true,
    focus: '产品形态、目标用户、商业化路径、与竞品的差异化',
    projectField: 'mainProducts',
    researchModuleTypes: ['PRODUCT_TECH'],
  },
  {
    key: 'coreAdvantage',
    name: '核心优势',
    required: true,
    focus: '技术壁垒、数据/客户资源、成本优势、可防御性',
    projectField: 'coreAdvantage',
    researchModuleTypes: ['PRODUCT_TECH', 'COMPETITION'],
  },
  {
    key: 'coreTeam',
    name: '核心团队',
    required: true,
    focus: '创始团队背景、履历真实性、股权结构、关键岗位完备度',
    projectField: 'coreTeam',
    researchModuleTypes: ['TEAM'],
  },
  {
    key: 'financialData',
    name: '财务数据',
    required: true,
    focus: '营收/毛利/烧钱速度、现金流与跑道、关键财务假设合理性',
    projectField: 'financialData',
    researchModuleTypes: ['FINANCIAL_DD'],
  },
  {
    key: 'orderProgress',
    name: '订单进展',
    required: true,
    focus: '已签订单/意向订单、头部客户质量、复购与流失',
    projectField: 'orderProgress',
    researchModuleTypes: ['BUSINESS_DD'],
  },
  {
    key: 'competitors',
    name: '竞争对手',
    required: true,
    focus: '直接/间接竞品、竞争格局变化、标的相对位置',
    projectField: 'competitors',
    researchModuleTypes: ['COMPETITION'],
  },
  {
    key: 'financingPlan',
    name: '融资规划',
    required: true,
    focus: '本轮融资用途、历史融资估值曲线、老股/条款风险',
    projectField: 'financingPlan',
    researchModuleTypes: ['FINANCING'],
  },
]

/** 必选模块 key 集合 */
export const FIXED_MODULE_KEYS = new Set(FIXED_MODULES.map(m => m.key))

/**
 * 组装尽调框架：7 大必选模块 + AI 定制模块
 * 硬约束：必选模块永远存在；定制模块 key 自动加 custom: 前缀、去重、数量限 0-5
 */
export function buildFramework(gen: Partial<FrameworkGenOutput> | null | undefined): DDFramework {
  const modules: FrameworkModule[] = FIXED_MODULES.map(m => ({
    ...m,
    focus: gen?.focusNotes?.[m.key]?.trim() || m.focus,
  }))

  const seen = new Set(FIXED_MODULE_KEYS)
  const custom = Array.isArray(gen?.customModules) ? gen!.customModules : []
  for (const c of custom.slice(0, 5)) {
    const name = typeof c?.name === 'string' ? c.name.trim() : ''
    if (!name) continue
    // key 规范化：custom: 前缀 + 安全字符，与必选模块去重
    const rawKey = typeof c.key === 'string' && c.key.trim() ? c.key.trim() : name
    const key = `custom:${rawKey.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '').slice(0, 40) || name}`
    if (seen.has(key)) continue
    seen.add(key)
    modules.push({
      key,
      name: name.slice(0, 30),
      required: false,
      focus: (typeof c.focus === 'string' ? c.focus : '').trim().slice(0, 200) || `针对该模块的尽调关注点`,
      projectField: null,
      researchModuleTypes: [],
    })
  }

  return { modules, generatedAt: new Date().toISOString() }
}

/**
 * 计算模块输入指纹（sha256，截取前16位）
 * 输入：项目字段值 + 关联投研模块内容/aiJson + 文档提取文本 + 框架关注点
 * 稳定性：键排序后序列化，输入不变则指纹不变；任一输入变化则指纹变化
 */
export function computeInputHash(input: Record<string, unknown>): string {
  const normalized = JSON.stringify(input, (_k, v) =>
    v === null || v === undefined ? '' : v
  )
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

/**
 * 引用交叉验证：只保留 URL 真实出现在 web_search 会话日志中的引用（防模型编造来源）
 */
export function filterCitations(
  citations: ModuleAnalysisOutput['citations'] | undefined | null,
  searchedUrls: string[]
): Array<{ label: string; url: string }> {
  if (!Array.isArray(citations) || citations.length === 0) return []
  const urlSet = new Set(searchedUrls)
  const seen = new Set<string>()
  const out: Array<{ label: string; url: string }> = []
  for (const c of citations) {
    const url = typeof c?.url === 'string' ? c.url.trim() : ''
    if (!url || !/^https?:\/\//.test(url)) continue
    if (!urlSet.has(url)) continue // 编造的 URL：不在会话日志中，丢弃
    if (seen.has(url)) continue
    seen.add(url)
    const label =
      (typeof c.label === 'string' && c.label.trim() ? c.label.trim() : url).slice(0, 80)
    out.push({ label, url })
  }
  return out.slice(0, 10)
}

/**
 * 汇总缺口清单：仅收集 INSUFFICIENT_DATA 模块的缺失说明
 */
export function aggregateGaps(
  results: Array<{ moduleKey: string; moduleName: string; status: string; missing?: string | null }>
): DDGap[] {
  return results
    .filter(r => r.status === 'INSUFFICIENT_DATA')
    .map(r => ({
      moduleKey: r.moduleKey,
      moduleName: r.moduleName,
      missing: (r.missing || '资料不足，请补充相关文档或信息').slice(0, 300),
    }))
}

/**
 * 判断模块是否需要（重新）分析（增量重跑核心逻辑）
 * - 从未分析过 → 需要
 * - 上次失败/资料不足 → 需要（输入可能已补充）
 * - 已完成但输入指纹变化 → 需要
 * - 已完成且输入未变 → 跳过
 */
export function needsAnalysis(
  result: { status: string; inputHash?: string | null } | null | undefined,
  currentInputHash: string
): boolean {
  if (!result) return true
  if (result.status !== 'COMPLETED') return true
  return result.inputHash !== currentInputHash
}
