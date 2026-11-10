/**
 * 深度报告上下文
 *
 * 在 buildDeckContext 基础上补充资料中心文档全文、文本框、截图、人工结论、
 * 公开来源正文与模块级限制，并计算报告图表所需的真实数据。
 */

import prisma from '@/lib/prisma'
import { buildDeckContext, type DeckContext, type DeckFact, type DeckModuleContext } from '@/lib/dd-deck/context'
import type { DeepBlock } from './spec'

const MODULE_DOC_BUDGET = 8000
const SINGLE_DOC_BUDGET = 4000
const SOURCE_EXCERPT_MAX = 1200

export interface DeepDocument {
  id: string
  fileName: string
  fileUrl: string
  fileType?: string
  text: string
  textLength: number
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

export async function buildDeepContext(projectId: string): Promise<DeepContext> {
  const base = await buildDeckContext(projectId)

  const [resources, run] = await Promise.all([
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
  ])

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
    const rawDocs = safeArray<RawDoc>(resource?.documents || null)

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

/** 图表数据全部来自真实统计，不调用 LLM */
export function buildDeepCharts(context: DeepContext): {
  coverage: DeepBlock | null
  grades: DeepBlock | null
  evidenceByModule: DeepBlock | null
  financeFacts: DeepBlock | null
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

  return { coverage, grades, evidenceByModule, financeFacts }
}
