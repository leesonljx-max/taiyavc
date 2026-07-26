/**
 * 投研分析专用权限模块
 *
 * 权限规则：
 * - INVESTMENT_PARTNER（投资合伙人）：可见所有尽调阶段项目
 * - 其他角色：仅可见自己维护的项目（createdById 或 memberIds 包含自己）
 * - ADMIN：可见所有项目
 *
 * 编辑权限（上传文档/修改模块/触发 AI 分析）：
 * - 维护人自己（createdById 或 memberIds）
 * - ADMIN
 * - INVESTMENT_PARTNER 也可编辑（需能看到项目）
 */

import type { UserRole } from './auth'
import type { PermissionUser } from './permissions'

/** 投研分析 9 种模块类型 */
export type ResearchModuleType =
  | 'INDUSTRY'        // 行业分析
  | 'PRODUCT_TECH'    // 产品和技术
  | 'COMPETITION'     // 竞争分析
  | 'BUSINESS_DD'     // 业务尽调
  | 'FINANCIAL_DD'    // 财务尽调
  | 'TEAM'            // 核心团队
  | 'COMPANY'         // 公司概况
  | 'FINANCING'       // 融资规划和进展
  | 'RECOMMENDATION'  // 投资建议

/** 所有模块类型常量数组 */
export const ALL_MODULE_TYPES: ResearchModuleType[] = [
  'INDUSTRY',
  'PRODUCT_TECH',
  'COMPETITION',
  'BUSINESS_DD',
  'FINANCIAL_DD',
  'TEAM',
  'COMPANY',
  'FINANCING',
  'RECOMMENDATION',
]

/** 模块类型中文标签 */
export const MODULE_TYPE_LABELS: Record<ResearchModuleType, string> = {
  INDUSTRY: '行业分析',
  PRODUCT_TECH: '产品和技术',
  COMPETITION: '竞争分析',
  BUSINESS_DD: '业务尽调',
  FINANCIAL_DD: '财务尽调',
  TEAM: '核心团队',
  COMPANY: '公司概况',
  FINANCING: '融资规划和进展',
  RECOMMENDATION: '投资建议',
}

/** 模块类型描述 */
export const MODULE_TYPE_DESCRIPTIONS: Record<ResearchModuleType, string> = {
  INDUSTRY: '行业发展阶段，技术成熟度 TRL 分析',
  PRODUCT_TECH: '产品定位、技术路线、差异化优势',
  COMPETITION: '竞争对手的产品定位、市场策略、业务进展、团队背景',
  BUSINESS_DD: '前十大客户、已签订单、意向订单、客户评价',
  FINANCIAL_DD: '财务数据分析（基于上传文档）',
  TEAM: '核心团队背景（基于上传文档）',
  COMPANY: '公司概况（基于上传文档）',
  FINANCING: '融资金额、投前估值、老股估值、其它机构进展、核心条款',
  RECOMMENDATION: '投资金额区间、领投或跟投',
}

/** 验证 moduleType 是否合法 */
export function isValidModuleType(type: string): type is ResearchModuleType {
  return ALL_MODULE_TYPES.includes(type as ResearchModuleType)
}

/**
 * 判断用户是否可见投研分析项目
 *
 * 规则：
 * - ADMIN：可见所有
 * - INVESTMENT_PARTNER：可见所有（合伙人需要统筹尽调）
 * - 其他角色：仅可见自己维护的项目
 */
export function canViewResearchProject(
  user: PermissionUser,
  project: {
    createdById: string
    memberIds: string[]
  }
): boolean {
  // ADMIN 和投资合伙人可见所有
  if (user.role === 'ADMIN' || user.role === 'INVESTMENT_PARTNER') {
    return true
  }
  // 其他角色仅可见自己维护的项目
  return (
    project.createdById === user.id ||
    project.memberIds.includes(user.id)
  )
}

/**
 * 判断用户是否可编辑投研分析模块
 *
 * 规则：
 * - ADMIN：可编辑所有
 * - INVESTMENT_PARTNER：可编辑所有可见项目（合伙人需要参与尽调）
 * - 其他角色：仅可编辑自己维护的项目
 */
export function canEditResearchProject(
  user: PermissionUser,
  project: {
    createdById: string
    memberIds: string[]
  }
): boolean {
  // ADMIN 可编辑所有
  if (user.role === 'ADMIN') {
    return true
  }
  // 投资合伙人可编辑所有可见项目
  if (user.role === 'INVESTMENT_PARTNER') {
    return true
  }
  // 其他角色仅可编辑自己维护的项目
  return (
    project.createdById === user.id ||
    project.memberIds.includes(user.id)
  )
}

/**
 * 判断模块是否需要 AI 分析（Tavily + DeepSeek）
 *
 * FINANCING 和 RECOMMENDATION 是纯手动输入，不需要 AI
 */
export function needsAIAnalysis(moduleType: ResearchModuleType): boolean {
  return moduleType !== 'FINANCING' && moduleType !== 'RECOMMENDATION'
}

/**
 * 判断模块是否需要 Tavily 搜索（互联网信息收集）
 *
 * 行业分析、产品和技术、竞争分析、核心团队、公司概况 需要 Tavily
 * 业务尽调、财务尽调 主要依赖文档提取
 */
export function needsTavilySearch(moduleType: ResearchModuleType): boolean {
  return ['INDUSTRY', 'PRODUCT_TECH', 'COMPETITION', 'TEAM', 'COMPANY'].includes(moduleType)
}

/**
 * 判断模块是否主要依赖文档提取
 *
 * 业务尽调、财务尽调、核心团队、公司概况 主要依赖上传文档
 */
export function needsDocumentExtraction(moduleType: ResearchModuleType): boolean {
  return ['BUSINESS_DD', 'FINANCIAL_DD', 'TEAM', 'COMPANY'].includes(moduleType)
}
