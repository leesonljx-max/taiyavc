/**
 * 深度报告上下文
 *
 * 在 buildDeckContext 基础上补充资料中心文档全文、文本框、截图、人工结论、
 * 公开来源正文与模块级限制，并计算报告图表所需的真实数据。
 */

import prisma from '@/lib/prisma'
import { buildDeckContext, type DeckContext, type DeckFact, type DeckModuleContext } from '@/lib/dd-deck/context'
import type { DeepBlock } from './spec'

const MODULE_DOC_BUDGET = 14000
const SINGLE_DOC_BUDGET = 6000
const SOURCE_EXCERPT_MAX = 1200

export interface DeepDocument {
  id: string
  fileName: string
  fileUrl: string
  fileType?: string
  text: string
  textLength: number
  /** unclassified = 资料中心未归类资料池中按内容候选并入的资料 */
  origin?: 'module' | 'unclassified'
}

export interface DeepSourceExcerpt {
  ref: string
  title: string
  url: string
  domain: string
  grade: string
  excerpt: string
}

export interface DeepScreenshot {
  id: string
  url: string
  fileName: string
}

export interface DeepModuleContext {
  moduleKey: string
  moduleName: string
  coreQuestion: string
  coverage: number
  facts: DeckFact[]
  sources: DeepSourceExcerpt[]
  documents: DeepDocument[]
  textBlocks: string[]
  screenshots: DeepScreenshot[]
  humanConclusion: string | null
  report: DeckModuleContext['report']
  verificationSummary: string | null
  analysisFacts: string[]
  gaps: Array<{ label: string; severity: string; status: string }>
  truncatedDocs: number
}

export interface DeepContext {
  base: DeckContext
  modules: DeepModuleContext[]
  limitations: string[]
}

interface RawDoc {
  id?: string
  fileName?: string
  fileUrl?: string
  fileType?: string
  text?: string
}

interface RawScreenshot {
  id?: string
  url?: string
  fileName?: string
}

interface RawAsset {
  id: string
  fileName: string
  fileUrl: string
  fileType: string
  text: string | null
  moduleKey: string | null
  classificationJson: string | null
}

interface RawSource {
  moduleKey: string
  title: string | null
  url: string
  domain: string
  grade: string
  content: string | null
  snippet: string | null
  fetchedAt: Date
}

function safeArray<T>(raw: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function safeObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function cleanText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }
const DEFAULT_ASSET_MODULE = 'PROJECT_ENTITY'
const ASSET_CONFIDENCE_FLOOR = 0.5

/** 未归类资料归属：已归类模块 > 分类候选（≥0.5）> 项目与主体 */
function resolveAssetModule(asset: RawAsset, validKeys: Set<string>): string {
  if (asset.moduleKey && validKeys.has(asset.moduleKey)) return asset.moduleKey
  const parsed = safeObject(asset.classificationJson)
  const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates as Array<Record<string, unknown>> : []
  const best = candidates
    .map(item => ({
      moduleKey: String(item?.moduleKey || ''),
      confidence: Number(item?.confidence),
    }))
    .filter(item => validKeys.has(item.moduleKey) && Number.isFinite(item.confidence) && item.confidence >= ASSET_CONFIDENCE_FLOOR)
    .sort((a, b) => b.confidence - a.confidence)[0]
  if (best) return best.moduleKey
  return validKeys.has(DEFAULT_ASSET_MODULE) ? DEFAULT_ASSET_MODULE : [...validKeys][0] || DEFAULT_ASSET_MODULE
}

export async function buildDeepContext(projectId: string): Promise<DeepContext> {
  const base = await buildDeckContext(projectId)

  const [resources, run, assets] = await Promise.all([
    prisma.dDModuleResource.findMany({
      where: { projectId },
      select: {
        moduleKey: true,
        documents: true,
        textBlocks: true,
        screenshots: true,
        reportJson: true,
        verificationJson: true,
        analysisJson: true,
        conclusion: true,
      },
    }),
    prisma.dDResearchRun.findFirst({
      where: { projectId, status: { in: ['DONE', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        sources: {
          select: {
            moduleKey: true,
            title: true,
            url: true,
            domain: true,
            grade: true,
            content: true,
            snippet: true,
            fetchedAt: true,
          },
        },
      },
    }),
    prisma.dDUnclassifiedAsset.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        fileType: true,
        text: true,
        moduleKey: true,
        classificationJson: true,
      },
    }),
  ])

  // 资料中心未归类资料池：按模块归属并入对应模块，避免 BP 等资料被漏掉
  const validKeys = new Set(base.modules.map(module => module.moduleKey))
  const assetsByModule = new Map<string, RawAsset[]>()
  for (const asset of assets) {
    const moduleKey = resolveAssetModule(asset, validKeys)
    const list = assetsByModule.get(moduleKey) || []
    list.push(asset)
    assetsByModule.set(moduleKey, list)
  }
  let unclassifiedDocTotal = 0

  const resourceByModule = new Map(resources.map(r => [r.moduleKey, r]))
  const sourceByModule = new Map<string, RawSource[]>()
  if (run) {
    const sorted = [...run.sources].sort((a, b) => {
      const byGrade = (GRADE_RANK[a.grade] ?? 9) - (GRADE_RANK[b.grade] ?? 9)
      if (byGrade !== 0) return byGrade
      return a.fetchedAt.getTime() - b.fetchedAt.getTime()
    })
    for (const source of sorted) {
      const list = sourceByModule.get(source.moduleKey) || []
      list.push(source)
      sourceByModule.set(source.moduleKey, list)
    }
  }

  let truncatedDocTotal = 0
  const modules: DeepModuleContext[] = base.modules.map(module => {
    const resource = resourceByModule.get(module.moduleKey)
    const moduleDocs = safeArray<RawDoc>(resource?.documents || null)
    const existingIds = new Set(moduleDocs.map(doc => doc.id).filter(Boolean) as string[])
    const existingUrls = new Set(moduleDocs.map(doc => doc.fileUrl).filter(Boolean) as string[])
    const assetDocs: RawDoc[] = []
    for (const asset of assetsByModule.get(module.moduleKey) || []) {
      const id = `asset-${asset.id}`
      if (existingIds.has(id) || existingUrls.has(asset.fileUrl)) continue
      const text = typeof asset.text === 'string' ? asset.text.trim() : ''
      assetDocs.push({
        id,
        fileName: asset.fileName,
        fileUrl: asset.fileUrl,
        fileType: asset.fileType,
        text,
      })
      existingIds.add(id)
      unclassifiedDocTotal += 1
    }
    const assetIds = new Set(assetDocs.map(doc => doc.id) as string[])
    // 未归类资料（通常是 BP/融资材料）优先纳入预算，避免被模块资料挤占
    const rawDocs = [...assetDocs, ...moduleDocs]

    const documents: DeepDocument[] = []
    let remaining = MODULE_DOC_BUDGET
    let truncatedDocs = 0
    for (const doc of rawDocs) {
      const fileName = doc.fileName || '未命名资料'
      const fullText = typeof doc.text === 'string' ? doc.text.replace(/\s+/g, ' ').trim() : ''
      if (!fullText) {
        documents.push({
          id: doc.id || fileName,
          fileName,
          fileUrl: doc.fileUrl || '',
          fileType: doc.fileType,
          text: '',
          textLength: 0,
          origin: assetIds.has(doc.id || '') ? 'unclassified' : 'module',
        })
        continue
      }
      if (remaining <= 0) {
        truncatedDocs += 1
        continue
      }
      const take = Math.min(SINGLE_DOC_BUDGET, remaining, fullText.length)
      if (take < fullText.length) truncatedDocs += 1
      documents.push({
        id: doc.id || fileName,
        fileName,
        fileUrl: doc.fileUrl || '',
        fileType: doc.fileType,
        text: take >= fullText.length ? fullText : `${fullText.slice(0, take)}…`,
        textLength: fullText.length,
        origin: assetIds.has(doc.id || '') ? 'unclassified' : 'module',
      })
      remaining -= take
    }
    truncatedDocTotal += truncatedDocs

    const textBlocks = safeArray<{ content?: string }>(resource?.textBlocks || null)
      .map(block => cleanText(block.content, 800))
      .filter(Boolean)
      .slice(0, 6)

    const screenshots = safeArray<RawScreenshot>(resource?.screenshots || null)
      .map((shot, index) => ({
        id: shot.id || `${module.moduleKey}-shot-${index + 1}`,
        url: shot.url || '',
        fileName: shot.fileName || `截图 ${index + 1}`,
      }))
      .filter(shot => shot.url)
      .slice(0, 6)

    const verification = safeObject(resource?.verificationJson || null)
    const verificationSummary = verification && typeof verification.summary === 'string'
      ? cleanText(verification.summary, 300)
      : null

    const analysis = safeObject(resource?.analysisJson || null)
    const analysisFacts = Array.isArray(analysis?.facts)
      ? (analysis?.facts as Array<{ fact?: unknown }>)
          .map(item => cleanText(item?.fact, 240))
          .filter(Boolean)
          .slice(0, 8)
      : []

    const sources: DeepSourceExcerpt[] = (sourceByModule.get(module.moduleKey) || []).slice(0, 4).map(source => ({
      ref: module.sources.find(s => s.url === source.url)?.ref || '',
      title: source.title || source.url,
      url: source.url,
      domain: source.domain,
      grade: source.grade,
      excerpt: cleanText(source.content || source.snippet || '', SOURCE_EXCERPT_MAX),
    }))

    return {
      moduleKey: module.moduleKey,
      moduleName: module.moduleName,
      coreQuestion: module.coreQuestion,
      coverage: module.coverage,
      facts: module.facts,
      sources,
      documents,
      textBlocks,
      screenshots,
      humanConclusion: resource?.conclusion ? cleanText(resource.conclusion, 1200) : null,
      report: module.report,
      verificationSummary,
      analysisFacts,
      gaps: module.gaps,
      truncatedDocs,
    }
  })

  const limitations: string[] = []
  if (!base.research.runId) {
    limitations.push('尚未完成全网研究，公开事实与来源主要来自资料中心，结论的时效性与完整性受限。')
  }
  const openGaps = base.gaps.items.filter(g => g.status === 'OPEN')
  if (openGaps.length > 0) {
    const blocking = openGaps.filter(g => g.severity === 'BLOCKING')
    const recommended = openGaps.filter(g => g.severity !== 'BLOCKING')
    if (blocking.length > 0) {
      limitations.push(`仍有关键资料缺口 ${blocking.length} 项：${blocking.slice(0, 6).map(g => g.label).join('、')}。`)
    }
    if (recommended.length > 0) {
      limitations.push(`仍有建议补充资料 ${recommended.length} 项：${recommended.slice(0, 6).map(g => g.label).join('、')}。`)
    }
  }
  if (truncatedDocTotal > 0) {
    limitations.push(`有 ${truncatedDocTotal} 篇资料因篇幅限制未完整纳入本次分析，结论可能遗漏细节。`)
  }
  if (unclassifiedDocTotal > 0) {
    limitations.push(`资料中心有 ${unclassifiedDocTotal} 份未归类资料（含 BP/融资材料），已按内容候选并入对应模块；有文本的参与原文引用，无文本的用于图表与截图。`)
  }
  for (const module of modules) {
    if (module.documents.length === 0 && module.facts.length === 0) {
      limitations.push(`${module.moduleName}：资料中心无上传资料，公开检索也未形成可引用事实。`)
    } else if (module.documents.every(doc => !doc.text)) {
      limitations.push(`${module.moduleName}：上传资料未提取到文本（可能为扫描件），未能参与分析。`)
    }
    if (module.verificationSummary) {
      limitations.push(`${module.moduleName} 交叉核验：${module.verificationSummary}`)
    }
  }
  if (limitations.length === 0) {
    limitations.push('未发现显著资料缺口；结论仍以公开信息与已上传资料为限。')
  }

  return { base, modules, limitations: limitations.slice(0, 18) }
}

function numericFacts(module: DeepModuleContext): Array<{ label: string; value: number; unit: string }> {
  const items: Array<{ label: string; value: number; unit: string }> = []
  for (const fact of module.facts) {
    if (!fact.value) continue
    const value = Number(String(fact.value).replace(/[^\d.-]/g, ''))
    if (!Number.isFinite(value) || value === 0) continue
    items.push({ label: fact.fact.slice(0, 14), value, unit: fact.unit || '' })
    if (items.length >= 8) break
  }
  return items
}

/** 图表数据全部来自真实统计，不调用 LLM */
export function buildDeepCharts(
  context: DeepContext,
  imageCounts: Record<string, number> = {}
): {
  coverage: DeepBlock | null
  grades: DeepBlock | null
  evidenceByModule: DeepBlock | null
  financeFacts: DeepBlock | null
  docContribution: DeepBlock | null
  moduleEvidence: DeepBlock | null
  moduleCharts: Record<string, DeepBlock | null>
  docUsage: DeepBlock | null
} {
  const modules = context.modules
  const coverage: DeepBlock = {
    type: 'chart',
    title: '九大模块信息覆盖度',
    unit: '%',
    note: '覆盖度 = 已确认事实与有效来源的相对完整度，仅反映信息充分性，不代表投资价值。',
    chart: {
      kind: 'bar',
      series: modules.map((module, index) => ({
        label: module.moduleName,
        value: Math.round(Math.max(0, Math.min(1, module.coverage)) * 100),
        color: ['#0B1F33', '#14B8A6', '#C9A227'][index % 3],
      })),
    },
  }

  const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const fact of context.base.facts) {
    const grade = (fact.grade || 'C').toUpperCase()
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1
  }
  const totalFacts = Object.values(gradeCounts).reduce((sum, value) => sum + value, 0)
  const grades: DeepBlock | null = totalFacts > 0
    ? {
        type: 'chart',
        title: '证据等级分布',
        unit: '条',
        note: 'A=政府/工商/专利/交易所；B=一线媒体/协会/研报；C=普通媒体/企业稿；D=自媒体/论坛。',
        chart: {
          kind: 'donut',
          series: [
            { label: 'A 级', value: gradeCounts.A, color: '#0B1F33' },
            { label: 'B 级', value: gradeCounts.B, color: '#C9A227' },
            { label: 'C 级', value: gradeCounts.C, color: '#14B8A6' },
            { label: 'D 级', value: gradeCounts.D, color: '#9AA7B4' },
          ],
        },
      }
    : null

  const evidenceByModule: DeepBlock = {
    type: 'table',
    title: '各模块证据与资料汇总',
    columns: ['模块', '覆盖度', '公开事实', '公开来源', '上传资料'],
    rows: modules.map(module => [
      module.moduleName,
      `${Math.round(module.coverage * 100)}%`,
      String(module.facts.length),
      String(module.sources.length),
      String(module.documents.length),
    ]),
    note: `合计：公开事实 ${context.base.facts.length} 条，公开来源 ${context.base.sources.length} 条，上传资料 ${context.base.docs.length} 篇。`,
  }

  const finance = modules.find(module => module.moduleKey === 'FINANCE_ECONOMICS')
  const financeRows = (finance?.facts || [])
    .filter(fact => fact.value)
    .slice(0, 10)
    .map(fact => [
      fact.fact,
      `${fact.value}${fact.unit || ''}`,
      fact.period || '—',
      fact.sourceRef || fact.grade,
    ])
  const financeFacts: DeepBlock | null = financeRows.length > 0
    ? {
        type: 'table',
        title: '关键财务与经营数值（公开信息）',
        columns: ['指标', '数值', '期间', '来源'],
        rows: financeRows,
        note: '仅包含公开检索到的带数值事实；未经审计，口径以来源原文为准。',
      }
    : null

  // ── 资料中心利用情况（直接回应"是否用了资料"） ──
  const docModules = modules.filter(module => module.documents.some(doc => doc.textLength > 0))
  const docContribution: DeepBlock | null = docModules.length > 0
    ? {
        type: 'chart',
        title: '资料中心文本贡献',
        unit: '千字',
        note: '按模块统计已纳入分析的资料正文规模；同一份资料归入其所属模块。',
        chart: {
          kind: 'bar',
          series: modules.map((module, index) => ({
            label: module.moduleName,
            value: Math.round((module.documents.reduce((sum, doc) => sum + doc.textLength, 0) / 1000) * 10) / 10,
            color: ['#0B1F33', '#14B8A6', '#C9A227'][index % 3],
          })),
        },
      }
    : null

  const moduleGradeCounts = new Map<string, Record<string, number>>()
  for (const module of modules) {
    moduleGradeCounts.set(module.moduleKey, { A: 0, B: 0, C: 0, D: 0 })
  }
  for (const fact of context.base.facts) {
    const counts = moduleGradeCounts.get(fact.moduleKey)
    if (!counts) continue
    const grade = (fact.grade || 'C').toUpperCase()
    counts[grade] = (counts[grade] || 0) + 1
  }
  const hasModuleFacts = modules.some(module => {
    const counts = moduleGradeCounts.get(module.moduleKey) || {}
    return Object.values(counts).some(value => value > 0)
  })
  const moduleEvidence: DeepBlock | null = hasModuleFacts
    ? {
        type: 'chart',
        title: '各模块证据等级构成',
        unit: '条',
        note: '按模块拆分 A/B/C/D 级事实数量，用于识别证据薄弱环节。',
        chart: {
          kind: 'stackedBar',
          categories: modules.map(module => module.moduleName),
          series: (['A', 'B', 'C', 'D'] as const).map((grade, index) => ({
            label: `${grade} 级`,
            values: modules.map(module => moduleGradeCounts.get(module.moduleKey)?.[grade] || 0),
            color: ['#0B1F33', '#C9A227', '#14B8A6', '#9AA7B4'][index],
          })),
        },
      }
    : null

  // ── 模块专属图表：优先数值指标，其次证据构成，再次资料贡献 ──
  const moduleCharts: Record<string, DeepBlock | null> = {}
  for (const module of modules) {
    const numeric = numericFacts(module)
    if (numeric.length >= 2) {
      const units = Array.from(new Set(numeric.map(item => item.unit).filter(Boolean)))
      moduleCharts[module.moduleKey] = {
        type: 'chart',
        title: `${module.moduleName}：关键数值`,
        unit: units.length === 1 ? units[0] : undefined,
        note: units.length > 1 ? '不同指标单位不一致，数值仅用于相对比较，口径以原文为准。' : '数据来自公开检索与资料中心中的带数值事实。',
        chart: {
          kind: 'bar',
          series: numeric.map((item, index) => ({
            label: item.label,
            value: item.value,
            color: ['#0B1F33', '#14B8A6', '#C9A227', '#8FA3B5'][index % 4],
          })),
        },
      }
      continue
    }

    const counts = moduleGradeCounts.get(module.moduleKey) || { A: 0, B: 0, C: 0, D: 0 }
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
    if (total > 0) {
      moduleCharts[module.moduleKey] = {
        type: 'chart',
        title: `${module.moduleName}：证据等级构成`,
        unit: '条',
        note: '该模块公开事实的等级分布，A 级最高、D 级最低。',
        chart: {
          kind: 'donut',
          series: [
            { label: 'A 级', value: counts.A, color: '#0B1F33' },
            { label: 'B 级', value: counts.B, color: '#C9A227' },
            { label: 'C 级', value: counts.C, color: '#14B8A6' },
            { label: 'D 级', value: counts.D, color: '#9AA7B4' },
          ],
        },
      }
      continue
    }

    const docs = module.documents.filter(doc => doc.textLength > 0)
    moduleCharts[module.moduleKey] = docs.length >= 2
      ? {
          type: 'chart',
          title: `${module.moduleName}：资料文本量`,
          unit: '千字',
          note: '该模块各份资料的正文规模，反映可用于分析的信息量。',
          chart: {
            kind: 'bar',
            series: docs.slice(0, 8).map((doc, index) => ({
              label: doc.fileName.slice(0, 16),
              value: Math.round((doc.textLength / 1000) * 10) / 10,
              color: ['#0B1F33', '#14B8A6', '#C9A227'][index % 3],
            })),
          },
        }
      : null
  }

  const docUsage: DeepBlock = {
    type: 'table',
    title: '资料中心使用明细',
    columns: ['模块', '资料数', '文本量', '公开事实', '公开来源', '关键图'],
    rows: modules.map(module => {
      const textLength = module.documents.reduce((sum, doc) => sum + doc.textLength, 0)
      return [
        module.moduleName,
        String(module.documents.length),
        `${Math.round((textLength / 1000) * 10) / 10}k 字`,
        String(module.facts.length),
        String(module.sources.length),
        String(imageCounts[module.moduleKey] || 0),
      ]
    }),
    note: `合计：资料 ${context.base.docs.length} 篇、公开事实 ${context.base.facts.length} 条、公开来源 ${context.base.sources.length} 条、关键图 ${Object.values(imageCounts).reduce((sum, value) => sum + value, 0)} 张。`,
  }

  return {
    coverage,
    grades,
    evidenceByModule,
    financeFacts,
    docContribution,
    moduleEvidence,
    moduleCharts,
    docUsage,
  }
}
