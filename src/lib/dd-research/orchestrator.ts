/**
 * 研究编排：PLAN → SEARCH → EXTRACT → SCORE → GAP
 *
 * 单模块失败不阻塞整轮；所有阶段状态写库，队列重启后可恢复。
 */

import prisma from '@/lib/prisma'
import { DD_SEARCH_BUDGET, DD_MODULE_KEYS } from './constants'
import { buildQueryPlan } from './planner'
import { searchModuleSources, type ResearchSourceDraft } from './search'
import { extractModuleFacts } from './extract'
import { computeModuleCoverage } from './coverage'
import { rebuildGaps } from './gap'

export interface CreateResearchRunOptions {
  modules?: string[]
  force?: boolean
  userId: string
}

export interface CreateResearchRunResult {
  runId: string
  existing: boolean
  status: string
}

export async function createResearchRun(
  projectId: string,
  options: CreateResearchRunOptions
): Promise<CreateResearchRunResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!project) throw new Error('项目不存在')

  if (!options.force) {
    const recent = await prisma.dDResearchRun.findFirst({
      where: {
        projectId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        status: { in: ['QUEUED', 'RUNNING', 'DONE', 'PARTIAL'] },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (recent) return { runId: recent.id, existing: true, status: recent.status }
  }

  const active = await prisma.dDResearchRun.findFirst({
    where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (active) return { runId: active.id, existing: true, status: active.status }

  const modules = (options.modules || [])
    .filter(k => (DD_MODULE_KEYS as readonly string[]).includes(k))
    .slice(0, DD_MODULE_KEYS.length)

  const run = await prisma.dDResearchRun.create({
    data: {
      projectId,
      status: 'QUEUED',
      phase: 'PLAN',
      progress: 0,
      scopeJson: JSON.stringify({ modules, force: Boolean(options.force), userId: options.userId }),
    },
  })

  return { runId: run.id, existing: false, status: 'QUEUED' }
}

interface ModuleState {
  moduleKey: string
  moduleName: string
  coreQuestion: string
  sources: ResearchSourceDraft[]
  searchCount: number
  errors: string[]
}

function parseScope(raw: string | null): { modules?: string[] } {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as { modules?: unknown }
    return { modules: Array.isArray(parsed.modules) ? parsed.modules.map(String) : undefined }
  } catch {
    return {}
  }
}

async function setRunProgress(runId: string, phase: string, progress: number): Promise<void> {
  await prisma.dDResearchRun.update({
    where: { id: runId },
    data: { phase, progress },
  })
}

export async function runResearch(runId: string): Promise<void> {
  const run = await prisma.dDResearchRun.findUnique({
    where: { id: runId },
    include: { project: true },
  })
  if (!run) throw new Error('研究任务不存在')
  if (run.status !== 'QUEUED' && run.status !== 'RUNNING') return

  try {
    await prisma.dDResearchRun.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        phase: 'PLAN',
        progress: 2,
        startedAt: run.startedAt || new Date(),
        error: null,
      },
    })

    // 恢复/重跑时清理旧中间结果，保证幂等
    await prisma.dDResearchSource.deleteMany({ where: { runId } })
    await prisma.dDResearchFact.deleteMany({ where: { runId } })
    await prisma.dDModuleResearch.deleteMany({ where: { runId } })

    const scope = parseScope(run.scopeJson)
    const plan = buildQueryPlan(run.project, scope.modules)

    await prisma.dDModuleResearch.createMany({
      data: plan.map(p => ({ runId, moduleKey: p.moduleKey, status: 'PENDING' })),
      skipDuplicates: true,
    })

    const states: ModuleState[] = plan.map(p => ({
      moduleKey: p.moduleKey,
      moduleName: p.moduleName,
      coreQuestion: p.coreQuestion,
      sources: [],
      searchCount: 0,
      errors: [],
    }))

    // ── SEARCH ──
    await setRunProgress(runId, 'SEARCH', 8)
    const seenUrls = new Set<string>()
    let usedSearches = 0

    for (let i = 0; i < plan.length; i++) {
      const remaining = DD_SEARCH_BUDGET.maxSearches - usedSearches
      if (remaining <= 0) {
        states[i].errors.push('搜索预算已用尽')
        continue
      }
      const result = await searchModuleSources([plan[i]], { maxSearches: remaining, seenUrls })
      const found = result.modules[0]
      usedSearches += result.totalSearchCount
      states[i].sources = found?.sources || []
      states[i].searchCount = result.totalSearchCount
      states[i].errors.push(...(found?.errors || []))
      const progress = 8 + Math.round((i + 1) / plan.length * 22)
      await setRunProgress(runId, 'SEARCH', progress)
    }

    const sourceRows = states.flatMap(s => s.sources.map(src => ({
      runId,
      moduleKey: s.moduleKey,
      url: src.url,
      title: src.title,
      domain: src.domain,
      snippet: src.snippet,
      content: src.content,
      sourceType: src.sourceType,
      grade: src.grade,
      contentHash: src.contentHash,
    })))
    if (sourceRows.length > 0) {
      await prisma.dDResearchSource.createMany({ data: sourceRows, skipDuplicates: true })
    }
    const dbSources = await prisma.dDResearchSource.findMany({
      where: { runId },
      select: { id: true, url: true },
    })
    const sourceIdByUrl = new Map(dbSources.map(s => [s.url, s.id]))

    // ── EXTRACT ──
    let hadError = false
    await setRunProgress(runId, 'EXTRACT', 32)

    for (let i = 0; i < states.length; i++) {
      const state = states[i]
      await prisma.dDModuleResearch.updateMany({
        where: { runId, moduleKey: state.moduleKey },
        data: { status: 'RUNNING' },
      })

      let factCount = 0
      let extractError: string | null = null

      if (state.sources.length === 0) {
        extractError = '未检索到可用来源'
      } else {
        try {
          const extraction = await extractModuleFacts(
            state.moduleKey,
            state.moduleName,
            state.coreQuestion,
            state.sources
          )
          if (extraction.error) extractError = extraction.error

          const factRows = extraction.facts.flatMap(f => {
            const source = state.sources[f.sourceIdx]
            const sourceId = source ? sourceIdByUrl.get(source.url) : undefined
            if (!sourceId) return []
            return [{
              runId,
              moduleKey: state.moduleKey,
              fact: f.fact,
              value: f.value || null,
              unit: f.unit || null,
              period: f.period || null,
              quote: f.quote,
              sourceId,
              confidence: f.confidence,
              grade: f.grade,
              importance: f.importance,
              status: f.status,
            }]
          })
          if (factRows.length > 0) {
            await prisma.dDResearchFact.createMany({ data: factRows })
            factCount = factRows.length
          }
        } catch (error) {
          extractError = error instanceof Error ? error.message : String(error)
        }
      }

      const factsForCoverage = extractError && factCount === 0
        ? []
        : await prisma.dDResearchFact.findMany({
            where: { runId, moduleKey: state.moduleKey },
            select: { importance: true, confidence: true, status: true },
          })

      const coverage = computeModuleCoverage(state.moduleKey, factsForCoverage, state.sources)
      const status = state.sources.length === 0
        ? 'INSUFFICIENT'
        : factCount === 0
          ? 'PARTIAL'
          : coverage.status

      const errors = [...state.errors]
      if (extractError) errors.push(extractError)
      if (errors.length > 0) hadError = true

      await prisma.dDModuleResearch.updateMany({
        where: { runId, moduleKey: state.moduleKey },
        data: {
          status,
          coverage: coverage.coverage,
          factCount,
          sourceCount: state.sources.length,
          error: errors.length > 0 ? errors.join('；').slice(0, 500) : null,
        },
      })

      const progress = 32 + Math.round((i + 1) / states.length * 48)
      await setRunProgress(runId, 'EXTRACT', progress)
    }

    // ── SCORE / GAP ──
    await setRunProgress(runId, 'SCORE', 85)
    await rebuildGaps(run.projectId)
    await setRunProgress(runId, 'GAP', 95)

    const modules = await prisma.dDModuleResearch.findMany({ where: { runId } })
    const sourceCount = await prisma.dDResearchSource.count({ where: { runId } })
    const factCount = await prisma.dDResearchFact.count({ where: { runId } })
    const gapCount = await prisma.dDGap.count({
      where: { projectId: run.projectId, status: 'OPEN' },
    })
    const coverageAvg = modules.length
      ? Math.round(modules.reduce((sum, m) => sum + m.coverage, 0) / modules.length * 100) / 100
      : 0

    const allEmpty = modules.every(m => m.sourceCount === 0 && m.factCount === 0)
    const finalStatus = allEmpty ? 'FAILED' : hadError ? 'PARTIAL' : 'DONE'

    await prisma.dDResearchRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        phase: 'GAP',
        progress: 100,
        finishedAt: new Date(),
        statsJson: JSON.stringify({
          sourceCount,
          factCount,
          gapCount,
          coverage: coverageAvg,
          searchCount: usedSearches,
        }),
        error: finalStatus === 'FAILED' ? '未检索到任何可用公开资料，请检查项目名称/公司全称后重试' : null,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[dd-research] 研究任务失败 ${runId}:`, error)
    await prisma.dDResearchRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        progress: 100,
        error: message.slice(0, 1000),
        finishedAt: new Date(),
      },
    }).catch(() => undefined)
  }
}
