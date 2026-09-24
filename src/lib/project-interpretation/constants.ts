/**
 * 项目解读 · 固定分析框架模板（每个上传项目按此框架执行）
 *
 * 框架 v1 内容固化自需求：
 * 1. 七维解读：市场地位 / 技术领先性 / 团队行业咖位 / 竞争分析 /
 *    创业窗口 / 业务进展与客户 logo 预估市场地位 / 10 条行业融资案例
 * 2. 问题清单：15-20 个必问问题，其中技术问题 ≥10，
 *    每题附行业与技术视角的理想答案
 * 3. 访谈闭环：逐题对比项目方回答与理想答案 → 差距分析 → 综合结论
 */

// ── 解读记录状态 ──
export const PI_STATUSES = ['UPLOADED', 'INTERPRETING', 'INTERPRETED', 'FAILED'] as const
export type PIStatus = (typeof PI_STATUSES)[number]

// ── 问题清单状态 ──
export const PI_QUESTIONS_STATUSES = ['PENDING', 'GENERATING', 'READY', 'FAILED'] as const
export type PIQuestionsStatus = (typeof PI_QUESTIONS_STATUSES)[number]

// ── 问题分类 ──
export const PI_QUESTION_CATEGORIES = ['TECH', 'MARKET', 'TEAM', 'BUSINESS', 'FINANCE'] as const
export type PIQuestionCategory = (typeof PI_QUESTION_CATEGORIES)[number]

export const PI_CATEGORY_LABELS: Record<PIQuestionCategory, string> = {
  TECH: '技术',
  MARKET: '市场',
  TEAM: '团队',
  BUSINESS: '业务',
  FINANCE: '财务',
}

// ── 问题清单数量规则（校验 AI 输出，不达标拒绝落库） ──
export const PI_RULES = {
  /** 问题总数下限 */
  minQuestions: 15,
  /** 问题总数上限 */
  maxQuestions: 20,
  /** 技术问题（TECH 分类）最少数量 */
  minTechQuestions: 10,
} as const

// ── 访谈校验吻合度 ──
// UNCOVERED：访谈纪要中未涉及该问题（批量校验时区分"问了差距大"与"根本没聊到"）
export const PI_MATCH_LEVELS = ['HIGH', 'PARTIAL', 'GAP', 'UNCOVERED'] as const
export type PIMatchLevel = (typeof PI_MATCH_LEVELS)[number]

export const PI_MATCH_LEVEL_LABELS: Record<PIMatchLevel, string> = {
  HIGH: '高度吻合',
  PARTIAL: '部分吻合',
  GAP: '差距较大',
  UNCOVERED: '访谈未涉及',
}

// ── 批量访谈校验状态（整个项目一次上传访谈纪要） ──
export const PI_VERIFY_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const
export type PIVerifyStatus = (typeof PI_VERIFY_STATUSES)[number]

export function isPIVerifyStatus(v: string): v is PIVerifyStatus {
  return (PI_VERIFY_STATUSES as readonly string[]).includes(v)
}

// ── 上传限制 ──
/** 项目文档：PDF / Word(docx) / PPT(pptx) / Excel / 文本（可提取文本的格式） */
export const PI_DOC_MAX_SIZE = 50 * 1024 * 1024 // 50MB（与项目文档一致）
export const PI_DOC_ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md']

/** 访谈文件：文档（自动提取文本）+ 音频（暂无 ASR，需粘贴转写文本） */
export const PI_INTERVIEW_MAX_SIZE = 50 * 1024 * 1024
export const PI_INTERVIEW_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']
export const PI_INTERVIEW_DOC_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'pptx']

// ── 七维解读模板（interpretationJson 固定结构） ──

export interface FinancingCase {
  company: string
  round: string
  amount: string
  date: string
  investors: string
  brief: string
}

export interface InterpretationResult {
  /** AI 推断的项目名（用户未填时使用） */
  projectName: string
  /** AI 推断的行业 */
  industry: string
  /** 市场地位 */
  marketPosition: string
  /** 技术领先性 */
  techLeadership: string
  /** 团队所在行业的咖位 */
  teamStanding: string
  /** 竞争分析 */
  competitionAnalysis: string
  /** 所处行业的创业窗口 */
  startupWindow: string
  /** 根据业务进展和客户 logo 情况预估市场地位 */
  marketEstimate: string
  /** 该行业 10 条融资案例 */
  financingCases: FinancingCase[]
}

// ── 校验结果模板（verifyResultJson 固定结构） ──

export interface VerifyResult {
  /** 吻合度：HIGH 高度吻合 / PARTIAL 部分吻合 / GAP 差距较大 */
  matchLevel: PIMatchLevel
  /** 项目方回答要点摘要 */
  answerSummary: string
  /** 与理想答案的差距分析 */
  gapAnalysis: string
  /** 该问题结论（如：对方技术壁垒不高） */
  conclusion: string
}

// ── 综合结论模板（conclusionJson 固定结构） ──

export interface DimensionConclusion {
  /** 维度（技术壁垒/市场地位/团队/商业化/财务） */
  aspect: string
  /** 差距等级：HIGH/PARTIAL/GAP */
  gapLevel: PIMatchLevel
  conclusion: string
}

export interface OverallConclusion {
  /** 总体判断 */
  summary: string
  /** 分维度结论（如：技术壁垒方面差距较大 → 技术壁垒不高） */
  dimensions: DimensionConclusion[]
  /** 给投资的建议 */
  advice: string
}

// ── 类型守卫 ──

export function isPIStatus(v: string): v is PIStatus {
  return (PI_STATUSES as readonly string[]).includes(v)
}
export function isPIQuestionsStatus(v: string): v is PIQuestionsStatus {
  return (PI_QUESTIONS_STATUSES as readonly string[]).includes(v)
}
export function isPIQuestionCategory(v: string): v is PIQuestionCategory {
  return (PI_QUESTION_CATEGORIES as readonly string[]).includes(v)
}
export function isPIMatchLevel(v: string): v is PIMatchLevel {
  return (PI_MATCH_LEVELS as readonly string[]).includes(v)
}

/** 文件扩展名 */
export function fileExt(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() || ''
}
