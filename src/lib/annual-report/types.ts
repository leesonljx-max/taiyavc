/**
 * 年度报告：类型与口径常量
 */

export type AnnualReportType = 'PERSONAL' | 'COMPANY'
export type AnnualReportStatus = 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'
export type AnnualReportPhase = 'COLLECTING' | 'RESEARCHING' | 'COMPOSING'

/** 年报主漏斗阶段（协议阶段保留在时间线中，避免尽调→交割断层） */
export const REPORT_STAGES = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
] as const

export type ReportStage = (typeof REPORT_STAGES)[number]

export const REPORT_STAGE_LABELS: Record<ReportStage, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  AGREEMENT: '协议',
  CLOSING: '交割',
}

/** 融资追踪 cohort：年度进入以下阶段的项目 */
export const FINANCING_STAGES: ReportStage[] = ['PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE']

export interface KpiItem {
  key: string
  label: string
  value: number
  unit?: string
  yoy: number | null
  hint?: string
}

export interface FunnelStage {
  stage: ReportStage
  label: string
  entered: number
  conversion: number | null
  stock: number
}

export interface MonthlyPoint {
  month: number
  label: string
  newProjects: number
  entries: Record<ReportStage, number>
  totalEntries: number
}

export interface IndustryStat {
  name: string
  count: number
  share: number
  isNew: boolean
}

export interface MonthlyIndustryCell {
  name: string
  count: number
}

export interface MonthlyIndustry {
  month: number
  label: string
  total: number
  industries: MonthlyIndustryCell[]
}

export interface MonthlyFocus {
  month: number
  label: string
  industries: string[]
  note: string
}

export interface MaintainerStat {
  userId: string
  name: string
  avatar: string | null
  counts: Record<ReportStage, number>
  total: number
  closing: number
  projects: number
}

export interface ProjectHighlight {
  id: string
  name: string
  industry: string
  stage: string
  stageLabel: string
  amount: string
  valuation: number | null
  note: string
  month: number | null
}

export interface FinancingItem {
  projectId: string
  projectName: string
  stageLabel: string
  progressType: 'NEW_ROUND' | 'ROUND_UP' | 'SAME_AS_DB' | 'NO_PUBLIC_INFO' | 'FAILED'
  latestRound: string | null
  amount: string | null
  investors: string[]
  valuation: string | null
  eventDate: string | null
  sourceUrl: string | null
  sourceTitle: string | null
  confidence: number | null
}

export interface MilestoneItem {
  id: string
  name: string
  kind: string
  title: string
  detail: string
  month: number | null
  amount: string | null
}

export interface ActivityStats {
  documents: number
  notes: number
  reviews: number
  ddProjects: number
  postInvestProjects: number
}

export interface LeadStats {
  total: number
  ai: number
  converted: number
}

export interface QualityStats {
  totalProjects: number
  missingStageDates: number
  unclassifiedIndustry: number
  duplicateNames: number
  researchFailed: number
}

export interface AnnualReportInsights {
  keywords: string[]
  theme: string
  overview: string
  highlights: string[]
  gaps: string[]
  nextYear: string[]
}

export interface AnnualReportData {
  meta: {
    year: number
    type: AnnualReportType
    ownerKey: string
    ownerName: string
    generatedAt: string
    timezone: 'Asia/Shanghai'
    templateVersion: string
    pageCount: number
    scopeLabel: string
  }
  kpis: KpiItem[]
  funnel: FunnelStage[]
  monthly: MonthlyPoint[]
  industries: IndustryStat[]
  monthlyIndustry: MonthlyIndustry[]
  monthlyFocus: MonthlyFocus[]
  maintainers: MaintainerStat[]
  highlights: ProjectHighlight[]
  financing: FinancingItem[]
  milestones: MilestoneItem[]
  activity: ActivityStats
  leads: LeadStats
  quality: QualityStats
  insights: AnnualReportInsights
  /** 个人版：协作项目数（非主维护） */
  collaborationCount?: number
  /** 公司版：上一年度对比 */
  comparison?: {
    year: number
    newProjects: number
    entered: Record<ReportStage, number>
    activeProjects: number
    industries: number
  }
}
