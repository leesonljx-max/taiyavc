/**
 * 缺口引擎
 *
 * 只对「必备证据目录」中未覆盖的条目生成缺口；
 * 公开事实、模块资料、未分类资料任一命中关键词即视为覆盖。
 */

import prisma from '@/lib/prisma'
import { DD_REQUIREMENTS, requirementsForModule, type DDRequirement } from './constants'

export interface GapSummary {
  total: number
  open: number
  blocking: number
  recommended: number
  resolved: number
  waived: number
}

export interface GapView {
  id: string
  moduleKey: string
  gapKey: string
  label: string
  severity: string
  reason: string | null
  suggestedTypes: string | null
  status: string
  waiveReason: string | null
  resolvedAt: Date | null
  createdAt: Date
}

export interface GapOverview {
  summary: GapSummary
  gaps: GapView[]
}

function normalize(text: string): string {
  return text.toLocaleLowerCase()
}

/** 关键词任一命中即视为覆盖 */
export function evaluateRequirementCoverage(
  requirement: Pick<DDRequirement, 'keywords'>,
  factTexts: string[],
  docTexts: string[]
): boolean {
  const haystack = normalize([...factTexts, ...docTexts].join('\n'))
  if (!haystack) return false
  return requirement.keywords.some(keyword => haystack.includes(normalize(keyword)))
}

function safeJsonArray(raw: string | null): Array<Record<string, unknown>> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface EvidenceMaps {
  runId: string | null
  factsByModule: Map<string, string[]>
  docsByModule: Map<string, string[]>
  globalDocs: string[]
}

async function collectEvidence(projectId: string): Promise<EvidenceMaps> {
  // 研究收尾时 run 仍为 RUNNING，缺口引擎需要读取本轮已落库的事实
  const run = await prisma.dDResearchRun.findFirst({
    where: { projectId, status: { in: ['RUNNING', 'DONE', 'PARTIAL'] } },
    orderBy: { createdAt: 'desc' },
  })

  const factsByModule = new Map<string, string[]>()
  if (run) {
    const facts = await prisma.dDResearchFact.findMany({
      where: { runId: run.id, status: { not: 'REJECTED' } },
    })
    for (const f of facts) {
      const arr = factsByModule.get(f.moduleKey) || []
      arr.push([f.fact, f.value, f.unit, f.period, f.quote].filter(Boolean).join(' '))
      factsByModule.set(f.moduleKey, arr)
    }
  }

  const docsByModule = new Map<string, string[]>()
  const resources = await prisma.dDModuleResource.findMany({
    where: { projectId },
    select: { moduleKey: true, documents: true, textBlocks: true, conclusion: true },
  })
  for (const r of resources) {
    const texts: string[] = []
    for (const doc of safeJsonArray(r.documents)) {
      if (typeof doc.text === 'string') texts.push(doc.text)
      if (typeof doc.fileName === 'string') texts.push(doc.fileName)
    }
    for (const block of safeJsonArray(r.textBlocks)) {
      if (typeof block.content === 'string') texts.push(block.content)
    }
    if (r.conclusion) texts.push(r.conclusion)
    docsByModule.set(r.moduleKey, texts)
  }

  // 未分类资料对全部模块生效：只要内容命中关键词即可关闭缺口
  const assets = await prisma.dDUnclassifiedAsset.findMany({
    where: { projectId },
    select: { text: true, fileName: true, status: true },
  })
  const globalDocs: string[] = []
  for (const a of assets) {
    if (a.text) globalDocs.push(a.text)
    if (a.fileName) globalDocs.push(a.fileName)
  }

  return { runId: run?.id ?? null, factsByModule, docsByModule, globalDocs }
}

function summarize(gaps: Array<{ status: string; severity: string }>): GapSummary {
  return {
    total: gaps.length,
    open: gaps.filter(g => g.status === 'OPEN').length,
    blocking: gaps.filter(g => g.status === 'OPEN' && g.severity === 'BLOCKING').length,
    recommended: gaps.filter(g => g.status === 'OPEN' && g.severity === 'RECOMMENDED').length,
    resolved: gaps.filter(g => g.status === 'RESOLVED').length,
    waived: gaps.filter(g => g.status === 'WAIVED').length,
  }
}

/**
 * 研究完成后/资料变化后重建缺口。
 * 没有研究 Run 时不生成缺口，避免在用户未检索前制造噪音。
 */
export async function rebuildGaps(projectId: string): Promise<GapSummary> {
  const evidence = await collectEvidence(projectId)
  if (!evidence.runId) {
    return { total: 0, open: 0, blocking: 0, recommended: 0, resolved: 0, waived: 0 }
  }

  const existing = await prisma.dDGap.findMany({ where: { projectId } })
  const existingMap = new Map(existing.map(g => [`${g.moduleKey}::${g.gapKey}`, g]))
  const now = new Date()

  for (const req of DD_REQUIREMENTS) {
    const covered = evaluateRequirementCoverage(
      req,
      evidence.factsByModule.get(req.moduleKey) || [],
      [...(evidence.docsByModule.get(req.moduleKey) || []), ...evidence.globalDocs]
    )
    const current = existingMap.get(`${req.moduleKey}::${req.key}`)

    if (covered) {
      if (current && current.status === 'OPEN') {
        await prisma.dDGap.update({
          where: { id: current.id },
          data: {
            status: 'RESOLVED',
            resolvedBy: 'AUTO',
            resolvedAt: now,
            reason: req.reason,
            label: req.label,
            severity: req.severity,
            suggestedTypes: req.suggestedTypes,
          },
        })
      }
      continue
    }

    if (current) {
      if (current.status === 'WAIVED') continue
      if (current.status === 'RESOLVED') {
        await prisma.dDGap.update({
          where: { id: current.id },
          data: {
            status: 'OPEN',
            resolvedBy: null,
            resolvedAt: null,
            resolvedAssetId: null,
            reason: req.reason,
            label: req.label,
            severity: req.severity,
            suggestedTypes: req.suggestedTypes,
          },
        })
      } else {
        await prisma.dDGap.update({
          where: { id: current.id },
          data: {
            reason: req.reason,
            label: req.label,
            severity: req.severity,
            suggestedTypes: req.suggestedTypes,
          },
        })
      }
      continue
    }

    await prisma.dDGap.create({
      data: {
        projectId,
        moduleKey: req.moduleKey,
        gapKey: req.key,
        label: req.label,
        severity: req.severity,
        reason: req.reason,
        suggestedTypes: req.suggestedTypes,
        status: 'OPEN',
      },
    })
  }

  // 清理已从目录移除的旧缺口
  const validKeys = new Set(DD_REQUIREMENTS.map(r => `${r.moduleKey}::${r.key}`))
  const stale = existing.filter(g => !validKeys.has(`${g.moduleKey}::${g.gapKey}`))
  if (stale.length > 0) {
    await prisma.dDGap.deleteMany({ where: { id: { in: stale.map(g => g.id) } } })
  }

  const all = await prisma.dDGap.findMany({ where: { projectId } })
  const summary = summarize(all)

  // 同步每模块缺口数（仅最新 Run）
  for (const moduleKey of new Set(DD_REQUIREMENTS.map(r => r.moduleKey))) {
    const openCount = all.filter(g => g.moduleKey === moduleKey && g.status === 'OPEN').length
    await prisma.dDModuleResearch.updateMany({
      where: { runId: evidence.runId, moduleKey },
      data: { gapCount: openCount },
    })
  }

  return summary
}

/** 资料上传/归类/删除后调用；没有 Run 时安全返回空 */
export async function refreshGapsForProject(projectId: string): Promise<GapSummary> {
  return rebuildGaps(projectId)
}

export async function getGapOverview(projectId: string): Promise<GapOverview> {
  const gaps = await prisma.dDGap.findMany({ where: { projectId } })
  const severityRank = (s: string) => (s === 'BLOCKING' ? 0 : 1)
  const statusRank = (s: string) => (s === 'OPEN' ? 0 : s === 'RESOLVED' ? 1 : 2)
  const sorted = [...gaps].sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status)
    if (byStatus !== 0) return byStatus
    const bySeverity = severityRank(a.severity) - severityRank(b.severity)
    if (bySeverity !== 0) return bySeverity
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  return { summary: summarize(gaps), gaps: sorted as GapView[] }
}

export async function waiveGap(
  projectId: string,
  gapId: string,
  userId: string,
  reason: string
): Promise<void> {
  const gap = await prisma.dDGap.findFirst({ where: { id: gapId, projectId } })
  if (!gap) throw new Error('缺口不存在')
  if (gap.status === 'RESOLVED') throw new Error('该缺口已由资料自动关闭，无需豁免')
  await prisma.dDGap.update({
    where: { id: gapId },
    data: {
      status: 'WAIVED',
      waivedBy: userId,
      waivedAt: new Date(),
      waiveReason: reason.slice(0, 500),
    },
  })
}

export function gapStatsByModule(gaps: Array<{ moduleKey: string; status: string; severity: string }>) {
  const map = new Map<string, { open: number; blocking: number }>()
  for (const g of gaps) {
    if (g.status !== 'OPEN') continue
    const cur = map.get(g.moduleKey) || { open: 0, blocking: 0 }
    cur.open += 1
    if (g.severity === 'BLOCKING') cur.blocking += 1
    map.set(g.moduleKey, cur)
  }
  return map
}

export async function blockingGapsForProject(projectId: string) {
  return prisma.dDGap.findMany({
    where: { projectId, status: 'OPEN', severity: 'BLOCKING' },
    orderBy: { createdAt: 'asc' },
  })
}

export function requirementsOf(moduleKey: string) {
  return requirementsForModule(moduleKey)
}
