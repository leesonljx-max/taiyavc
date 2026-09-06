/**
 * 类型定义 —— 与主项目（Next.js 投资管理系统）API 响应结构对齐
 */

export type UserRole =
  | 'ADMIN'
  | 'INVESTMENT_MANAGER'
  | 'INVESTMENT_PARTNER'
  | 'POST_INVESTMENT_OFFICER'
  | 'TEMP_VISITOR'

export type FollowStage =
  | 'INITIAL_TALK'
  | 'PRE_DD'
  | 'PROJECT_INITIATION'
  | 'DUE_DILIGENCE'
  | 'AGREEMENT'
  | 'CLOSING'
  | 'POST_INVESTMENT'

export interface SessionUser {
  id: string
  name?: string | null
  email: string
  role: UserRole
  avatar?: string | null
}

/** 项目列表项（GET /api/projects） */
export interface ProjectListItem {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  financingRound: string | null
  financingPlan: string | null
  followStage: FollowStage
  status: string
  totalAmount: string
  raisedAmount: string | null
  investmentValuation: string | null
  targetDate: string
  createdAt: string
  updatedAt: string
  createdById: string
  passedStages: string | null
  createdBy?: { id: string; name: string | null } | null
}

/** 项目详情（GET /api/projects/[id]） */
export interface ProjectDetail {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  mainProducts?: string | null
  coreAdvantage?: string | null
  coreTeam?: string | null
  competitors?: string | null
  description: string | null
  totalAmount: string
  raisedAmount: string | null
  investmentValuation?: string | null
  financingRound: string | null
  financingPlan?: string | null
  financialData?: string | null
  followStage: FollowStage
  status: string
  targetDate: string
  createdAt: string
  manualHighlights?: string | null
  aiHighlightsJson?: string | null
  createdBy?: { id: string; name: string | null; email: string } | null
  members?: Array<{ userId: string; user: { id: string; name: string | null; email: string; username?: string } }>
  documents?: Array<{ id: string; fileName: string; fileUrl: string; fileType: string; fileSize: number; createdAt: string }>
}

/** AI 投资亮点（aiHighlightsJson 解析结果） */
export interface AiHighlights {
  highlights: string[]
  analyzedAt: string
}

/** 仪表盘统计（GET /api/dashboard） */
export interface DashboardStats {
  weeklyNew: number
  preDD: number
  initiated: number
  dueDiligence: number
}

export interface DashboardWeeklyProject {
  id: string
  name: string
  companyFullName?: string | null
  industry: string | null
  followStage: FollowStage
  targetDate: string
  createdAt: string
  aiCard: unknown
  maintainerName: string
}

export interface MaintainerStat {
  userId: string
  userName: string
  stageCounts: Record<string, number>
  projects: Array<{
    id: string
    name: string
    companyPosition: string | null
    industry: string | null
    financingRound: string | null
    totalAmount: string
    followStage: FollowStage
  }>
}

export interface DashboardData {
  stats: DashboardStats
  weekStart: string
  weeklyProjects: DashboardWeeklyProject[]
  maintainerStats: MaintainerStat[]
}
