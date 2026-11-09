/**
 * 年度报告聚合口径（纯函数，便于测试）
 *
 * 口径说明：
 * - 初聊：targetDate（初聊日期）落在年度内
 * - 阶段进入：该阶段在年度内第一次有日期的事件；历史无日期事件只进漏斗、不进月度
 * - 年末存量：年末前最后一次有日期事件所处阶段；投后计入交割存量
 * - 行业：自由文本按别名表归一化
 */

import {
  REPORT_STAGES,
  REPORT_STAGE_LABELS,
  FINANCING_STAGES,
  type AnnualReportType,
  type FunnelStage,
  type IndustryStat,
  type KpiItem,
  type MaintainerStat,
  type MilestoneItem,
  type MonthlyFocus,
  type MonthlyIndustry,
  type MonthlyPoint,
  type ProjectHighlight,
  type QualityStats,
  type ReportStage,
} from './types'
import { shanghaiParts, yearRange, monthLabel } from './time-window'
import { normalizeIndustry, UNCLASSIFIED_INDUSTRY } from './industry-alias'

export interface StageEventInput {
  toStage: string
  occurredAt: Date | null
}

export interface ProjectInput {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  followStage: string
  passedStages: string | null
  targetDate: Date
  createdAt: Date
  stageChangedAt: Date | null
  totalAmount: string | null
  investmentValuation: number | null
  financingRound: string | null
  companyPosition: string | null
  description: string | null
  createdById: string
  createdByName: string
  createdByAvatar: string | null
  memberIds: string[]
  events: StageEventInput[]
  counts: { documents: number; notes: number; reviews: number }
}

export interface CoreMetrics {
  year: number
  newProjects: number
  entered: Record<ReportStage, number>
  stock: Record<ReportStage, number>
  cohortIds: Set<string>
  projectEntries: Map<string, Set<ReportStage>>
  monthly: MonthlyPoint[]
  industryCounts: Map<string, number>
  monthlyIndustries: Map<number, Map<string, number>>
  ownerEntries: Map<string, Record<ReportStage, number>>
  ownerProjects: Map<string, Set<string>>
  rejected: number
  postInvest: number
  totalProjects: number
}

const STAGE_INDEX: Record<string, number> = Object.fromEntries(REPORT_STAGES.map((s, i) => [s, i]))

const STAGE_PRIORITY: Record<string, number> = {
  CLOSING: 60,
  POST_INVESTMENT: 55,
  AGREEMENT: 50,
  DUE_DILIGENCE: 40,
  PROJECT_INITIATION: 30,
  PRE_DD: 20,
  INITIAL_TALK: 10,
  REJECTED: 0,
}

function emptyStageRecord(): Record<ReportStage, number> {
  return Object.fromEntries(REPORT_STAGES.map(stage => [stage, 0])) as Record<ReportStage, number>
}

function emptyMonthly(): MonthlyPoint[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: monthLabel(i + 1),
    newProjects: 0,
    entries: emptyStageRecord(),
    totalEntries: 0,
  }))
}

function percentile(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 100)
}

export function parsePassedStageList(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function inRange(date: Date, range: { start: Date; end: Date }): boolean {
  return date >= range.start && date < range.end
}

function stageLabelOf(stage: string): string {
  return REPORT_STAGE_LABELS[stage as ReportStage] ?? (stage === 'POST_INVESTMENT' ? '投后' : stage === 'REJECTED' ? '已否' : stage)
}

/** 计算某年度的核心口径 */
export function computeCore(projects: ProjectInput[], year: number): CoreMetrics {
  const range = yearRange(year)
  const monthly = emptyMonthly()
  const entered: Record<ReportStage, number> = emptyStageRecord()
  const stock: Record<ReportStage, number> = emptyStageRecord()
  const cohortIds = new Set<string>()
  const projectEntries = new Map<string, Set<ReportStage>>()
  const industryCounts = new Map<string, number>()
  const monthlyIndustries = new Map<number, Map<string, number>>()
  const ownerEntries = new Map<string, Record<ReportStage, number>>()
  const ownerProjects = new Map<string, Set<string>>()
  let newProjects = 0
  let rejected = 0
  let postInvest = 0

  for (const project of projects) {
    const target = project.targetDate ?? project.createdAt
    const newInYear = inRange(target, range)
    const datedEvents = project.events
      .filter(event => event.occurredAt && inRange(event.occurredAt, range))
      .sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime())
    const hasActivity = newInYear || datedEvents.length > 0

    if (newInYear) newProjects += 1

    if (hasActivity) {
      cohortIds.add(project.id)
      const industry = normalizeIndustry(project.industry)
      industryCounts.set(industry, (industryCounts.get(industry) ?? 0) + 1)
    }

    const reached = new Set<ReportStage>()
    const markEntry = (stage: ReportStage, date: Date | null) => {
      if (reached.has(stage)) return
      reached.add(stage)
      if (date) {
        const parts = shanghaiParts(date)
        if (parts.year === year) {
          const point = monthly[parts.month - 1]
          point.entries[stage] += 1
          point.totalEntries += 1
        }
      }
    }

    // 初聊
    if (newInYear) {
      markEntry('INITIAL_TALK', target)
      monthly[shanghaiParts(target).month - 1].newProjects += 1
    } else {
      const initialEvent = datedEvents.find(event => event.toStage === 'INITIAL_TALK')
      if (initialEvent?.occurredAt) markEntry('INITIAL_TALK', initialEvent.occurredAt)
    }

    const passedStages = parsePassedStageList(project.passedStages)

    for (const stage of REPORT_STAGES) {
      if (stage === 'INITIAL_TALK') continue
      const dated = datedEvents.find(event => event.toStage === stage)
      if (dated?.occurredAt) {
        markEntry(stage, dated.occurredAt)
        continue
      }
      if (!passedStages.includes(stage)) continue

      // 历史项目：只有「本年度新建」才能推断该阶段发生在本年度
      if (newInYear) {
        markEntry(stage, null)
      } else if (
        project.followStage === stage &&
        project.stageChangedAt &&
        inRange(project.stageChangedAt, range)
      ) {
        markEntry(stage, project.stageChangedAt)
      }
    }

    if (hasActivity) {
      projectEntries.set(project.id, reached)
      for (const stage of reached) {
        entered[stage] += 1
        if (!ownerEntries.has(project.createdById)) {
          ownerEntries.set(project.createdById, emptyStageRecord())
        }
        ownerEntries.get(project.createdById)![stage] += 1
      }
      if (reached.size > 0) {
        if (!ownerProjects.has(project.createdById)) ownerProjects.set(project.createdById, new Set())
        ownerProjects.get(project.createdById)!.add(project.id)
      }

      // 月度赛道：该月有初聊或任一阶段事件的项目，按行业去重计数
      const monthProjectIds = new Map<number, Set<string>>()
      if (newInYear) {
        const month = shanghaiParts(target).month
        if (!monthProjectIds.has(month)) monthProjectIds.set(month, new Set())
        monthProjectIds.get(month)!.add(project.id)
      }
      for (const event of datedEvents) {
        if (!event.occurredAt) continue
        const month = shanghaiParts(event.occurredAt).month
        if (!monthProjectIds.has(month)) monthProjectIds.set(month, new Set())
        monthProjectIds.get(month)!.add(project.id)
      }
      for (const [month, ids] of monthProjectIds) {
        if (!ids.has(project.id)) continue
        if (!monthlyIndustries.has(month)) monthlyIndustries.set(month, new Map())
        const bucket = monthlyIndustries.get(month)!
        const industry = normalizeIndustry(project.industry)
        bucket.set(industry, (bucket.get(industry) ?? 0) + 1)
      }
    }

    // 年末存量：只统计年末前已存在的项目
    if (project.createdAt < range.end) {
      const stockEvents = project.events
        .filter(event => event.occurredAt && (event.occurredAt as Date) < range.end)
        .sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime())
      const lastStage = stockEvents.length > 0 ? stockEvents[stockEvents.length - 1].toStage : project.followStage
      if (lastStage === 'POST_INVESTMENT') {
        postInvest += 1
        stock.CLOSING += 1
      } else if (lastStage === 'REJECTED') {
        if (hasActivity) rejected += 1
      } else if (lastStage in STAGE_INDEX) {
        stock[lastStage as ReportStage] += 1
      }
    } else if (project.followStage === 'POST_INVESTMENT' && hasActivity) {
      postInvest += 1
    }
  }

  return {
    year,
    newProjects,
    entered,
    stock,
    cohortIds,
    projectEntries,
    monthly,
    industryCounts,
    monthlyIndustries,
    ownerEntries,
    ownerProjects,
    rejected,
    postInvest,
    totalProjects: projects.length,
  }
}

function buildIndustries(
  current: CoreMetrics,
  previous: CoreMetrics
): IndustryStat[] {
  const total = Array.from(current.industryCounts.values()).reduce((sum, value) => sum + value, 0)
  const previousIndustries = new Set(previous.industryCounts.keys())
  return Array.from(current.industryCounts.entries())
    .map(([name, count]) => ({
      name,
      count,
      share: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      isNew: !previousIndustries.has(name),
    }))
    .sort((a, b) => b.count - a.count)
}

function buildMonthlyIndustry(core: CoreMetrics): {
  monthlyIndustry: MonthlyIndustry[]
  monthlyFocus: MonthlyFocus[]
} {
  const monthlyIndustry: MonthlyIndustry[] = []
  const monthlyFocus: MonthlyFocus[] = []
  for (let month = 1; month <= 12; month += 1) {
    const bucket = core.monthlyIndustries.get(month) ?? new Map<string, number>()
    const industries = Array.from(bucket.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
    const total = industries.reduce((sum, item) => sum + item.count, 0)
    monthlyIndustry.push({ month, label: monthLabel(month), total, industries })
    const top = industries.slice(0, 2)
    monthlyFocus.push({
      month,
      label: monthLabel(month),
      industries: top.map(item => item.name),
      note:
        top.length === 0
          ? '本月没有新增初聊或阶段进展'
          : `${top[0].name} 为本月最活跃赛道（${top[0].count} 个项目）${
              top[1] ? `，其次为 ${top[1].name}` : ''
            }`,
    })
  }
  return { monthlyIndustry, monthlyFocus }
}

function buildMaintainers(projects: ProjectInput[], core: CoreMetrics): MaintainerStat[] {
  const byId = new Map(projects.map(project => [project.createdById, project]))
  return Array.from(core.ownerEntries.entries())
    .map(([userId, counts]) => {
      const project = byId.get(userId)
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
      const projectIds = core.ownerProjects.get(userId) ?? new Set()
      return {
        userId,
        name: project?.createdByName ?? '未知用户',
        avatar: project?.createdByAvatar ?? null,
        counts,
        total,
        closing: counts.CLOSING,
        projects: projectIds.size,
      }
    })
    .sort((a, b) => b.total - a.total || b.closing - a.closing)
}

function buildHighlights(projects: ProjectInput[], core: CoreMetrics, limit: number): ProjectHighlight[] {
  return projects
    .filter(project => core.cohortIds.has(project.id))
    .sort((a, b) => {
      const diff = (STAGE_PRIORITY[b.followStage] ?? 0) - (STAGE_PRIORITY[a.followStage] ?? 0)
      if (diff !== 0) return diff
      return b.targetDate.getTime() - a.targetDate.getTime()
    })
    .slice(0, limit)
    .map(project => {
      const noteSource = (project.companyPosition || project.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return {
        id: project.id,
        name: project.name,
        industry: normalizeIndustry(project.industry),
        stage: project.followStage,
        stageLabel: stageLabelOf(project.followStage),
        amount: project.totalAmount || '—',
        valuation: project.investmentValuation,
        note: noteSource.slice(0, 56) || (project.financingRound ? `${project.financingRound}轮` : '暂无项目备注'),
        month: shanghaiParts(project.targetDate).month,
      }
    })
}

function buildMilestones(projects: ProjectInput[], core: CoreMetrics): MilestoneItem[] {
  const items: MilestoneItem[] = []
  const projectMap = new Map(projects.map(project => [project.id, project]))

  for (const [projectId, stages] of core.projectEntries) {
    if (!stages.has('CLOSING')) continue
    const project = projectMap.get(projectId)
    if (!project) continue
    items.push({
      id: project.id,
      name: project.name,
      kind: '交割',
      title: '完成交割',
      detail: `${normalizeIndustry(project.industry)} · ${project.financingRound || '融资轮次未填'}`,
      month: project.stageChangedAt ? shanghaiParts(project.stageChangedAt).month : null,
      amount: project.totalAmount || null,
    })
  }

  const valued = projects
    .filter(project => core.cohortIds.has(project.id) && typeof project.investmentValuation === 'number')
    .sort((a, b) => (b.investmentValuation ?? 0) - (a.investmentValuation ?? 0))
  if (valued[0]) {
    items.push({
      id: valued[0].id,
      name: valued[0].name,
      kind: '估值',
      title: '年度最高估值项目',
      detail: `${normalizeIndustry(valued[0].industry)} · 投后估值 ${valued[0].investmentValuation} 亿元`,
      month: shanghaiParts(valued[0].targetDate).month,
      amount: valued[0].totalAmount || null,
    })
  }

  return items.slice(0, 8)
}

function buildQuality(projects: ProjectInput[], core: CoreMetrics): QualityStats {
  let missingStageDates = 0
  for (const project of projects) {
    if (!core.cohortIds.has(project.id)) continue
    const passed = parsePassedStageList(project.passedStages)
    const dated = new Set(
      project.events.filter(event => event.occurredAt).map(event => event.toStage)
    )
    if (passed.some(stage => stage !== 'INITIAL_TALK' && !dated.has(stage))) {
      missingStageDates += 1
    }
  }
  let unclassifiedIndustry = 0
  for (const project of projects) {
    if (!core.cohortIds.has(project.id)) continue
    if (normalizeIndustry(project.industry) === UNCLASSIFIED_INDUSTRY) unclassifiedIndustry += 1
  }
  const nameCount = new Map<string, number>()
  for (const project of projects) {
    const key = project.name.trim().toLowerCase()
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1)
  }
  const duplicateNames = Array.from(nameCount.values()).filter(count => count > 1).length

  return {
    totalProjects: projects.length,
    missingStageDates,
    unclassifiedIndustry,
    duplicateNames,
    researchFailed: 0,
  }
}

export interface AnnualMetricsResult {
  core: CoreMetrics
  kpis: KpiItem[]
  funnel: FunnelStage[]
  monthly: MonthlyPoint[]
  industries: IndustryStat[]
  monthlyIndustry: MonthlyIndustry[]
  monthlyFocus: MonthlyFocus[]
  maintainers: MaintainerStat[]
  highlights: ProjectHighlight[]
  milestones: MilestoneItem[]
  quality: QualityStats
  comparison: {
    year: number
    newProjects: number
    entered: Record<ReportStage, number>
    activeProjects: number
    industries: number
  }
}

export function buildAnnualMetrics(
  projects: ProjectInput[],
  year: number,
  type: AnnualReportType
): AnnualMetricsResult {
  const core = computeCore(projects, year)
  const previous = computeCore(projects, year - 1)
  const { monthlyIndustry, monthlyFocus } = buildMonthlyIndustry(core)

  const kpis: KpiItem[] = [
    {
      key: 'newProjects',
      label: '新初聊项目',
      value: core.newProjects,
      unit: '个',
      yoy: percentile(core.newProjects, previous.newProjects),
      hint: `${year} 年新增初聊`,
    },
    ...REPORT_STAGES.filter(stage => stage !== 'INITIAL_TALK').map(stage => ({
      key: stage,
      label: `进入${REPORT_STAGE_LABELS[stage]}`,
      value: core.entered[stage],
      unit: '个',
      yoy: percentile(core.entered[stage], previous.entered[stage]),
      hint: `${year} 年首次进入该阶段`,
    })),
    {
      key: 'activeProjects',
      label: '年度活跃项目',
      value: core.cohortIds.size,
      unit: '个',
      yoy: percentile(core.cohortIds.size, previous.cohortIds.size),
      hint: '年内有初聊或阶段进展',
    },
  ]

  const funnel: FunnelStage[] = REPORT_STAGES.map((stage, index) => {
    const current = core.entered[stage]
    const before = index === 0 ? null : core.entered[REPORT_STAGES[index - 1]]
    return {
      stage,
      label: REPORT_STAGE_LABELS[stage],
      entered: current,
      conversion: before === null ? null : before === 0 ? null : Math.round((current / before) * 1000) / 10,
      stock: core.stock[stage],
    }
  })

  const industries = buildIndustries(core, previous)
  const maintainers = type === 'COMPANY' ? buildMaintainers(projects, core) : []
  const highlights = buildHighlights(projects, core, type === 'COMPANY' ? 6 : 6)
  const milestones = type === 'COMPANY' ? buildMilestones(projects, core) : []
  const quality = buildQuality(projects, core)

  return {
    core,
    kpis,
    funnel,
    monthly: core.monthly,
    industries,
    monthlyIndustry,
    monthlyFocus,
    maintainers,
    highlights,
    milestones,
    quality,
    comparison: {
      year: year - 1,
      newProjects: previous.newProjects,
      entered: previous.entered,
      activeProjects: previous.cohortIds.size,
      industries: previous.industryCounts.size,
    },
  }
}

/** 年度融资追踪 cohort 项目（进入 PreDD/立项/尽调 的项目） */
export function selectFinancingCohort(
  projects: ProjectInput[],
  metrics: AnnualMetricsResult,
  limit: number
): ProjectInput[] {
  return projects
    .filter(project => {
      const stages = metrics.core.projectEntries.get(project.id)
      return stages ? FINANCING_STAGES.some(stage => stages.has(stage)) : false
    })
    .sort((a, b) => (STAGE_PRIORITY[b.followStage] ?? 0) - (STAGE_PRIORITY[a.followStage] ?? 0))
    .slice(0, limit)
}
