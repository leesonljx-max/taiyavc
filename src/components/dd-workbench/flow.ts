/**
 * 尽调工作台共享流程逻辑（主布局与模块详情共用，避免循环依赖）
 *
 * 统一流形：资料归集 → 事实抽取 → 人工复核 → 报告冻结
 * 分段进度由真实证据状态驱动，不以"有文字"替代"完成"。
 */

/** 模块四段流程状态 */
export function flowSteps(t: {
  evidenceCount: number
  confirmedEvidenceCount: number
  conclusion: string | null
  status: string
}) {
  return [
    { key: 'collect', label: '资料归集', done: t.evidenceCount > 0 },
    { key: 'extract', label: '事实抽取', done: t.confirmedEvidenceCount > 0 },
    { key: 'review', label: '人工复核', done: !!t.conclusion?.trim() },
    { key: 'freeze', label: '报告冻结', done: t.status === 'DONE' },
  ]
}

/** 模块状态 → 设计稿状态标签（已复核/验证中/待补充/待决策/待启动/待复核） */
export function moduleStatusLabel(moduleKey: string, status: string): { label: string; cls: string } {
  if (status === 'DONE') return { label: '已复核', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' }
  if (status === 'IN_REVIEW') {
    // 估值与交易模块在投委会语境下是"待决策"
    if (moduleKey === 'VALUATION_DEAL') return { label: '待决策', cls: 'bg-amber-50 text-amber-700 border border-amber-200' }
    return { label: '待复核', cls: 'bg-amber-50 text-amber-700 border border-amber-200' }
  }
  if (status === 'IN_PROGRESS') return { label: '验证中', cls: 'bg-blue-50 text-blue-700 border border-blue-200' }
  if (status === 'BLOCKED') return { label: '待补充', cls: 'bg-orange-50 text-orange-600 border border-orange-200' }
  if (moduleKey === 'VALUATION_DEAL') return { label: '待决策', cls: 'bg-gray-100 text-gray-500 border border-gray-200' }
  return { label: '待启动', cls: 'bg-gray-100 text-gray-500 border border-gray-200' }
}

/** 项目阶段顺序（概览卡"尽调阶段"用） */
export const STAGE_ORDER = ['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING', 'POST_INVESTMENT']

export const STAGE_LABELS: Record<string, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '深度验证',
  AGREEMENT: '协议',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
}
