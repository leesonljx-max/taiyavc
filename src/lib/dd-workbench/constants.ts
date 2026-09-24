/**
 * 尽调工作台常量：状态机、证据等级、红旗级别
 *
 * 依据：《项目尽调模块优化技术规划与执行方案》§3 尽调框架、§4 证据链设计
 * - 状态机与等级白名单供 API 校验与前端渲染共用
 */

// ── 尽调批次状态 ──
// IN_PROGRESS 尽调推进中 → IN_REVIEW 复核中 → FROZEN 报告冻结（快照固化，可进投委会）
export const DD_BATCH_STATUSES = ['IN_PROGRESS', 'IN_REVIEW', 'FROZEN'] as const
export type DDBatchStatus = (typeof DD_BATCH_STATUSES)[number]

// ── 模块任务状态机 ──
// PENDING 待启动 → IN_PROGRESS 分析中 → IN_REVIEW 待复核 → DONE 复核通过
// BLOCKED 阻塞（缺资料/待外部反馈，可从任意状态进入，需在结论中说明阻塞原因）
export const DD_TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED'] as const
export type DDTaskStatus = (typeof DD_TASK_STATUSES)[number]

/** 任务状态允许的流转（DONE 为终态；BLOCKED 可从任意非终态进入） */
export const DD_TASK_TRANSITIONS: Record<DDTaskStatus, DDTaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'],
  IN_PROGRESS: ['IN_REVIEW', 'DONE', 'BLOCKED'],
  IN_REVIEW: ['DONE', 'IN_PROGRESS', 'BLOCKED'],
  DONE: ['IN_PROGRESS'], // 复核后重开（重新补充分析）
  BLOCKED: ['IN_PROGRESS', 'PENDING'],
}

// ── 红旗级别（风险标记） ──
export const DD_RED_FLAG_LEVELS = ['NONE', 'MEDIUM', 'HIGH'] as const
export type DDRedFlagLevel = (typeof DD_RED_FLAG_LEVELS)[number]

// ── 证据来源类型 ──
// DOCUMENT 批次资料引用 / WEB 外部链接快照 / MANUAL 访谈与口述（一手陈述）
export const DD_EVIDENCE_SOURCE_TYPES = ['DOCUMENT', 'WEB', 'MANUAL'] as const
export type DDEvidenceSourceType = (typeof DD_EVIDENCE_SOURCE_TYPES)[number]

// ── 证据等级（文档 §4 事实核验与冲突处理） ──
// A 原始或权威：审计报表、政府登记、合同、监管披露、盖章文件
// B 一手陈述：管理层/客户/专家访谈（MANUAL 来源固定为 B）
// C 可信二手：主流媒体、券商报告、行业协会、数据库摘要
// D 待核验：搜索摘要、无作者网页、模型推断 —— 不得支撑关键结论，仅进待办/附录
export const DD_EVIDENCE_GRADES = ['A', 'B', 'C', 'D'] as const
export type DDEvidenceGrade = (typeof DD_EVIDENCE_GRADES)[number]

/** 可支撑关键结论的证据等级（A/B/C 且已确认） */
export const REPORT_SUPPORTED_GRADES: DDEvidenceGrade[] = ['A', 'B', 'C']

// ── 证据确认状态 ──
// PENDING 待确认 → CONFIRMED 已确认（责任人复核）→ CONFLICT 存在冲突（不静默覆盖，需人工裁决）
export const DD_EVIDENCE_STATUSES = ['PENDING', 'CONFIRMED', 'CONFLICT'] as const
export type DDEvidenceStatus = (typeof DD_EVIDENCE_STATUSES)[number]

// ── 报告版本类型 ──
// FULL_PACKAGE 项目尽调整包（投委会会前材料）
// MODULE 单模块报告（专业复核与追问闭环）
export const DD_REPORT_TYPES = ['FULL_PACKAGE', 'MODULE'] as const
export type DDReportType = (typeof DD_REPORT_TYPES)[number]

// ── 中文标签（前端渲染与报告导出共用） ──
export const DD_BATCH_STATUS_LABELS: Record<DDBatchStatus, string> = {
  IN_PROGRESS: '尽调推进中',
  IN_REVIEW: '复核中',
  FROZEN: '报告已冻结',
}

export const DD_TASK_STATUS_LABELS: Record<DDTaskStatus, string> = {
  PENDING: '待启动',
  IN_PROGRESS: '分析中',
  IN_REVIEW: '待复核',
  DONE: '已完成',
  BLOCKED: '阻塞',
}

export const DD_RED_FLAG_LABELS: Record<DDRedFlagLevel, string> = {
  NONE: '无',
  MEDIUM: '中',
  HIGH: '高',
}

export const DD_EVIDENCE_SOURCE_TYPE_LABELS: Record<DDEvidenceSourceType, string> = {
  DOCUMENT: '批次资料',
  WEB: '外部链接',
  MANUAL: '访谈/口述',
}

export const DD_EVIDENCE_GRADE_LABELS: Record<DDEvidenceGrade, string> = {
  A: 'A 原始或权威',
  B: 'B 一手陈述',
  C: 'C 可信二手',
  D: 'D 待核验',
}

export const DD_EVIDENCE_STATUS_LABELS: Record<DDEvidenceStatus, string> = {
  PENDING: '待确认',
  CONFIRMED: '已确认',
  CONFLICT: '存在冲突',
}

// ── 类型守卫 ──
export function isDDBatchStatus(v: string): v is DDBatchStatus {
  return (DD_BATCH_STATUSES as readonly string[]).includes(v)
}
export function isDDTaskStatus(v: string): v is DDTaskStatus {
  return (DD_TASK_STATUSES as readonly string[]).includes(v)
}
export function isDDRedFlagLevel(v: string): v is DDRedFlagLevel {
  return (DD_RED_FLAG_LEVELS as readonly string[]).includes(v)
}
export function isDDEvidenceSourceType(v: string): v is DDEvidenceSourceType {
  return (DD_EVIDENCE_SOURCE_TYPES as readonly string[]).includes(v)
}
export function isDDEvidenceGrade(v: string): v is DDEvidenceGrade {
  return (DD_EVIDENCE_GRADES as readonly string[]).includes(v)
}
export function isDDEvidenceStatus(v: string): v is DDEvidenceStatus {
  return (DD_EVIDENCE_STATUSES as readonly string[]).includes(v)
}
