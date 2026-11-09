/**
 * 尽调报告上下文
 *
 * 把项目、研究事实、来源、上传资料、模块报告与缺口汇总成
 * Writer 可消费的紧凑结构，并给事实/来源分配 E/F 引用编号。
 */

import prisma from '@/lib/prisma'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'
import { getGapOverview, type GapSummary } from '@/lib/dd-research/gap'

export interface DeckFact {
  ref: string
  id: string
  moduleKey: string
  fact: string
  value?: string
  unit?: string
  period?: string
  quote?: string
  grade: string
  importance: string
  status: string
  confidence: number
  sourceRef?: string
  sourceUrl?: string
  sourceTitle?: string
}

export interface DeckSource {
  ref: string
  id: string
  moduleKey: string
  title: string
  url: string
  domain: string
  grade: string
  sourceType: string
}

export interface DeckDoc {
  id: string
  fileName: string
  moduleKey: string
}

export interface DeckModuleReport {
  summary: string
  opportunities: string[]
  risks: string[]
}

export interface DeckModuleContext {
  moduleKey: string
  moduleName: string
  coreQuestion: string
  coverage: number
  status: string
  facts: DeckFact[]
  sources: DeckSource[]
  docs: DeckDoc[]
  report: DeckModuleReport | null
  gaps: Array<{ label: string; severity: string; status: string }>
}

export interface DeckContext {
  project: {
    id: string
    name: string
    companyFullName: string | null
    industry: string | null
    companyPosition: string | null
    mainProducts: string | null
    financingRound: string | null
    totalAmount: string
    investmentValuation: number | null
    followStage: string
    description: string | null
    coreAdvantage: string | null
    coreTeam: string | null
    competitors: string | null
    createdAt: Date
  }
  modules: DeckModuleContext[]
  facts: DeckFact[]
  sources: DeckSource[]
  docs: DeckDoc[]
  gaps: {
    summary: GapSummary
    items: Array<{
      id: string
      moduleKey: string
      label: string
      severity: string
      status: string
      reason: string | null
      suggestedTypes: string | null
      waiveReason: string | null
    }>
  }
  research: {
    runId: string | null
    status: string | null
    finishedAt: Date | null
    sourceCount: number
    factCount: number
    coverage: number
  }
}

function safeArray<T>(raw: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function safeObject<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as T : null
  } catch {
    return null
  }
}

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

export async function buildDeckContext(projectId: string): Promise<DeckContext> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      companyFullName: true,
      industry: true,
      companyPosition: true,
      mainProducts: true,
      financingRound: true,
      totalAmount: true,
      investmentValuation: true,
      followStage: true,
      description: true,
      coreAdvantage: true,
      coreTeam: true,
      competitors: true,
      createdAt: true,
    },
  })
  if (!project) throw new Error('项目不存在')

  const run = await prisma.dDResearchRun.findFirst({
    where: { projectId, status: { in: ['DONE', 'PARTIAL'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      modules: true,
      sources: { orderBy: { fetchedAt: 'asc' } },
      facts: { orderBy: { createdAt: 'asc' } },
    },
  })

  const resources = await prisma.dDModuleResource.findMany({
    where: { projectId },
    select: { moduleKey: true, documents: true, reportJson: true },
  })
  const resourceByModule = new Map(resources.map(r => [r.moduleKey, r]))

  const gapOverview = await getGapOverview(projectId)

  const allSources: DeckSource[] = []
  const sourceRefById = new Map<string, string>()
  if (run) {
    const sorted = [...run.sources].sort((a, b) => {
      const byGrade = (GRADE_RANK[a.grade] ?? 9) - (GRADE_RANK[b.grade] ?? 9)
      if (byGrade !== 0) return byGrade
      return a.fetchedAt.getTime() - b.fetchedAt.getTime()
    })
    for (const s of sorted) {
      if (allSources.length >= 60) break
      const ref = `E${allSources.length + 1}`
      sourceRefById.set(s.id, ref)
      allSources.push({
        ref,
        id: s.id,
        moduleKey: s.moduleKey,
        title: s.title || s.url,
        url: s.url,
        domain: s.domain,
        grade: s.grade,
        sourceType: s.sourceType,
      })
    }
  }

  const allFacts: DeckFact[] = []
  if (run) {
    const valid = run.facts.filter(f => f.status !== 'REJECTED')
    const sorted = [...valid].sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'CONFLICT') return 1
        if (b.status === 'CONFLICT') return -1
      }
      if (a.importance !== b.importance) return a.importance === 'CORE' ? -1 : 1
      return b.confidence - a.confidence
    })
    for (const f of sorted) {
      if (allFacts.length >= 90) break
      const ref = `F${allFacts.length + 1}`
      const sourceRef = f.sourceId ? sourceRefById.get(f.sourceId) : undefined
      const source = f.sourceId ? run.sources.find(s => s.id === f.sourceId) : undefined
      allFacts.push({
        ref,
        id: f.id,
        moduleKey: f.moduleKey,
        fact: f.fact,
        value: f.value || undefined,
        unit: f.unit || undefined,
        period: f.period || undefined,
        quote: f.quote || undefined,
        grade: f.grade,
        importance: f.importance,
        status: f.status,
        confidence: f.confidence,
        sourceRef,
        sourceUrl: source?.url,
        sourceTitle: source?.title || undefined,
      })
    }
  }

  const docs: DeckDoc[] = []
  for (const r of resources) {
    for (const doc of safeArray<{ id: string; fileName: string }>(r.documents)) {
      docs.push({ id: doc.id, fileName: doc.fileName, moduleKey: r.moduleKey })
    }
  }

  const modules: DeckModuleContext[] = DD_TEMPLATE_MODULES.map(tpl => {
    const moduleResearch = run?.modules.find(m => m.moduleKey === tpl.key)
    const moduleFacts = allFacts.filter(f => f.moduleKey === tpl.key).slice(0, 12)
    const moduleSources = allSources.filter(s => s.moduleKey === tpl.key).slice(0, 10)
    const resource = resourceByModule.get(tpl.key)
    const report = safeObject<DeckModuleReport>(resource?.reportJson || null)
    const moduleDocs = docs.filter(d => d.moduleKey === tpl.key).slice(0, 12)
    const moduleGaps = gapOverview.gaps
      .filter(g => g.moduleKey === tpl.key)
      .map(g => ({ label: g.label, severity: g.severity, status: g.status }))

    return {
      moduleKey: tpl.key,
      moduleName: tpl.name,
      coreQuestion: tpl.coreQuestion,
      coverage: moduleResearch?.coverage ?? 0,
      status: moduleResearch?.status ?? 'PENDING',
      facts: moduleFacts,
      sources: moduleSources,
      docs: moduleDocs,
      report: report && typeof report.summary === 'string'
        ? {
            summary: report.summary,
            opportunities: Array.isArray(report.opportunities) ? report.opportunities.map(String) : [],
            risks: Array.isArray(report.risks) ? report.risks.map(String) : [],
          }
        : null,
      gaps: moduleGaps,
    }
  })

  let stats: { sourceCount?: number; factCount?: number; coverage?: number } = {}
  if (run?.statsJson) {
    try {
      stats = JSON.parse(run.statsJson) as typeof stats
    } catch {
      stats = {}
    }
  }

  const averageCoverage = run?.modules.length
    ? Math.round(run.modules.reduce((sum, m) => sum + m.coverage, 0) / run.modules.length * 100) / 100
    : 0

  return {
    project,
    modules,
    facts: allFacts,
    sources: allSources,
    docs,
    gaps: {
      summary: gapOverview.summary,
      items: gapOverview.gaps.map(g => ({
        id: g.id,
        moduleKey: g.moduleKey,
        label: g.label,
        severity: g.severity,
        status: g.status,
        reason: g.reason,
        suggestedTypes: g.suggestedTypes,
        waiveReason: g.waiveReason,
      })),
    },
    research: {
      runId: run?.id ?? null,
      status: run?.status ?? null,
      finishedAt: run?.finishedAt ?? null,
      sourceCount: stats.sourceCount ?? allSources.length,
      factCount: stats.factCount ?? allFacts.length,
      coverage: stats.coverage ?? averageCoverage,
    },
  }
}
