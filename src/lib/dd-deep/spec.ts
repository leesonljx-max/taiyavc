/**
 * 深度尽调报告文档规格（A4）
 *
 * AI 只提供内容块；页面由服务端按高度预算装页，页数随内容自然增长。
 * 文档结构：封面 → 目录 → 执行摘要 → 行业与时机 → 九大模块 → 风险估值结论 → 资料局限 → 附录。
 */

export type DeepBlock =
  | { type: 'heading'; text: string; level?: 1 | 2 }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'qa'; items: Array<{ question: string; answer: string; refs?: string[] }> }
  | { type: 'table'; title?: string; columns: string[]; rows: string[][]; note?: string }
  | {
      type: 'chart'
      title: string
      unit?: string
      note?: string
      chart:
        | { kind: 'bar'; series: Array<{ label: string; value: number; color?: string }> }
        | { kind: 'donut'; series: Array<{ label: string; value: number; color?: string }> }
    }
  | { type: 'image'; url: string; caption: string; source?: string }
  | { type: 'callout'; title?: string; text: string; tone?: 'gold' | 'red' | 'teal' }

export type DeepPageKind = 'cover' | 'toc' | 'section' | 'content' | 'appendix'

export interface DeepPage {
  pageNo: number
  kind: DeepPageKind
  sectionNo?: string
  sectionTitle?: string
  kicker?: string
  blocks: DeepBlock[]
}

export interface DeepTocItem {
  no: string
  title: string
  page: number
}

export interface DeepDocSpec {
  kind: 'DOCUMENT'
  type: 'DEEP'
  title: string
  subtitle: string
  projectName: string
  companyFullName?: string
  industry?: string
  financingRound?: string
  totalAmount?: string
  generatedAt: string
  theme: 'navy-gold'
  pageCount: number
  toc: DeepTocItem[]
  stats: {
    sourceCount: number
    factCount: number
    docCount: number
    imageCount: number
  }
  pages: DeepPage[]
}

export interface DeepNarrative {
  headline: string
  paragraphs: string[]
  bullets: string[]
}

export interface DeepRisk {
  title: string
  detail: string
  mitigation: string
  refs?: string[]
}

export interface DeepModuleContent {
  moduleKey: string
  headline: string
  questions: Array<{ question: string; answer: string; refs?: string[] }>
  facts: string[]
  analysis: string[]
  conclusion: string
  metrics?: Array<{ label: string; value: string; hint?: string }>
  limitations?: string[]
  dataLimited?: boolean
}

export interface DeepImage {
  moduleKey: string
  url: string
  caption: string
  source?: string
  kind: 'screenshot' | 'doc' | 'web'
}

export interface DeepModuleInput {
  moduleKey: string
  moduleName: string
  coreQuestion: string
  content: DeepModuleContent
}

export interface DeepAppendixFact {
  ref: string
  moduleName: string
  fact: string
  grade: string
  source?: string
}

export interface DeepAppendixSource {
  ref: string
  title: string
  domain: string
  grade: string
  url: string
}

export interface DeepDocInput {
  project: {
    name: string
    companyFullName?: string | null
    industry?: string | null
    companyPosition?: string | null
    financingRound?: string | null
    totalAmount?: string | null
  }
  generatedAt: string
  executive: DeepNarrative & { conclusion: string }
  outlook: {
    industry: DeepNarrative
    timing: DeepNarrative
    risks: DeepRisk[]
    valuation: { headline: string; bullets: string[]; metrics?: Array<{ label: string; value: string; hint?: string }> }
    conclusion: { headline: string; conditions: string[]; nextSteps: string[] }
  }
  modules: DeepModuleInput[]
  charts: {
    coverage: DeepBlock | null
    grades: DeepBlock | null
    evidenceByModule: DeepBlock | null
    financeFacts: DeepBlock | null
  }
  images: DeepImage[]
  limitations: string[]
  appendix: {
    facts: DeepAppendixFact[]
    sources: DeepAppendixSource[]
  }
  stats: {
    sourceCount: number
    factCount: number
    docCount: number
    imageCount: number
  }
}

const PAGE_BUDGET = 880
const PARAGRAPH_CHUNK = 700
const TABLE_BUDGET = 700

function textHeight(text: string, charsPerLine = 42, lineHeight = 26): number {
  return Math.ceil(Math.max(text.length, 1) / charsPerLine) * lineHeight
}

function tableRowHeight(row: string[], columns: number): number {
  const charsPerLine = Math.max(10, Math.floor(64 / Math.max(columns, 1)))
  const longest = row.reduce((max, cell) => Math.max(max, cell.length), 0)
  return Math.max(30, Math.ceil(longest / charsPerLine) * 18 + 14)
}

function blockHeight(block: DeepBlock): number {
  switch (block.type) {
    case 'heading':
      return block.level === 2 ? 44 : 52
    case 'paragraph':
      return textHeight(block.text) + 10
    case 'bullets':
      return block.items.reduce((sum, item) => sum + textHeight(item, 40, 24) + 10, 4)
    case 'qa':
      return block.items.reduce(
        (sum, item) => sum + 30 + textHeight(item.question, 40, 22) + textHeight(item.answer, 40, 24) + 12,
        4
      )
    case 'table': {
      const rows = block.rows.reduce((sum, row) => sum + tableRowHeight(row, block.columns.length), 0)
      return rows + 64
    }
    case 'chart':
      return 340
    case 'image':
      return 380
    case 'callout':
      return 44 + textHeight(block.text, 40, 24)
    default:
      return 60
  }
}

/** 超长段落按句号/分号切块，避免单块超过一页 */
function splitParagraph(text: string, maxLen = PARAGRAPH_CHUNK): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= maxLen) return [clean]

  const sentences = clean.split(/(?<=[。！？；])/)
  const out: string[] = []
  let buffer = ''
  const pushBuffer = () => {
    if (buffer.trim()) out.push(buffer.trim())
    buffer = ''
  }

  for (const sentence of sentences) {
    if (!sentence) continue
    if (sentence.length > maxLen) {
      pushBuffer()
      for (let i = 0; i < sentence.length; i += maxLen) {
        out.push(sentence.slice(i, i + maxLen))
      }
      continue
    }
    if (buffer.length + sentence.length > maxLen) pushBuffer()
    buffer += sentence
  }
  pushBuffer()
  return out.length > 0 ? out : [clean.slice(0, maxLen)]
}

function expandBlock(block: DeepBlock): DeepBlock[] {
  switch (block.type) {
    case 'paragraph':
      return splitParagraph(block.text).map(text => ({ type: 'paragraph' as const, text }))
    case 'bullets': {
      const chunks: string[][] = []
      let current: string[] = []
      let used = 0
      for (const item of block.items) {
        const height = textHeight(item, 40, 24) + 10
        if (current.length > 0 && used + height > PAGE_BUDGET - 80) {
          chunks.push(current)
          current = []
          used = 0
        }
        current.push(item)
        used += height
      }
      if (current.length > 0) chunks.push(current)
      return chunks.map(items => ({ type: 'bullets' as const, items }))
    }
    case 'qa': {
      const chunks: Array<Array<{ question: string; answer: string; refs?: string[] }>> = []
      let current: Array<{ question: string; answer: string; refs?: string[] }> = []
      let used = 0
      for (const item of block.items) {
        const height = 30 + textHeight(item.question, 40, 22) + textHeight(item.answer, 40, 24) + 12
        if (current.length > 0 && used + height > PAGE_BUDGET - 80) {
          chunks.push(current)
          current = []
          used = 0
        }
        current.push(item)
        used += height
      }
      if (current.length > 0) chunks.push(current)
      return chunks.map(items => ({ type: 'qa' as const, items }))
    }
    case 'table': {
      if (block.rows.length === 0) return [{ ...block, rows: [block.columns.map(() => '—')] }]
      const chunks: string[][][] = []
      let current: string[][] = []
      let used = 0
      for (const row of block.rows) {
        const h = tableRowHeight(row, block.columns.length)
        if (current.length > 0 && (used + h > TABLE_BUDGET || current.length >= 8)) {
          chunks.push(current)
          current = []
          used = 0
        }
        current.push(row)
        used += h
      }
      if (current.length > 0) chunks.push(current)
      return chunks.map((rows, index) => ({
        ...block,
        title: index === 0 ? block.title : block.title ? `${block.title}（续）` : undefined,
        rows,
        note: index === chunks.length - 1 ? block.note : undefined,
      }))
    }
    default:
      return [block]
  }
}

function packBlocks(
  meta: { sectionNo: string; sectionTitle: string; kicker?: string },
  blocks: DeepBlock[]
): DeepPage[] {
  const pages: DeepPage[] = []
  let current: DeepBlock[] = []
  let used = 0

  const flush = () => {
    if (current.length === 0) return
    pages.push({
      pageNo: 0,
      kind: 'content',
      sectionNo: meta.sectionNo,
      sectionTitle: meta.sectionTitle,
      kicker: meta.kicker,
      blocks: current,
    })
    current = []
    used = 0
  }

  for (const block of blocks) {
    for (const piece of expandBlock(block)) {
      const height = blockHeight(piece)
      if (used + height > PAGE_BUDGET && current.length > 0) {
        const last = current[current.length - 1]
        if (last.type === 'heading') {
          current.pop()
          used -= blockHeight(last)
          flush()
          current.push(last)
          used += blockHeight(last)
          if (used + height > PAGE_BUDGET) flush()
        } else {
          flush()
        }
      }
      current.push(piece)
      used += height
    }
  }
  flush()
  return pages
}

function sectionPage(no: string, title: string, kicker?: string): DeepPage {
  return {
    pageNo: 0,
    kind: 'section',
    sectionNo: no,
    sectionTitle: title,
    kicker,
    blocks: [],
  }
}

function moduleBlocks(module: DeepModuleInput, images: DeepImage[], charts: DeepBlock[]): DeepBlock[] {
  const content = module.content
  const blocks: DeepBlock[] = []

  blocks.push({ type: 'heading', text: '模块核心问题' })
  if (content.questions.length > 0) {
    blocks.push({
      type: 'qa',
      items: content.questions.map(q => ({ question: q.question, answer: q.answer, refs: q.refs })),
    })
  } else {
    blocks.push({
      type: 'qa',
      items: [{ question: module.coreQuestion, answer: '公开信息不足，需结合资料中心原始材料进一步验证。' }],
    })
  }

  blocks.push({ type: 'heading', text: '资料与发现' })
  if (content.facts.length > 0) {
    blocks.push({ type: 'bullets', items: content.facts })
  } else {
    blocks.push({
      type: 'paragraph',
      text: `本模块已汇总 ${content.questions.length} 个核心问题，但资料中心与公开检索均未形成可引用的事实，以下分析以行业常识与待验证假设为主。`,
    })
  }

  blocks.push({ type: 'heading', text: '分析' })
  if (content.analysis.length > 0) {
    blocks.push({ type: 'bullets', items: content.analysis })
  } else {
    blocks.push({ type: 'paragraph', text: '暂无足够信息形成分析判断，建议补充原始资料后重跑本模块。' })
  }

  if (content.metrics && content.metrics.length > 0) {
    blocks.push({
      type: 'table',
      title: '关键指标',
      columns: ['指标', '数值', '口径/来源'],
      rows: content.metrics.map(m => [m.label, m.value, m.hint || '—']),
    })
  }

  for (const chart of charts) blocks.push(chart)

  blocks.push({ type: 'heading', text: '结论' })
  blocks.push({
    type: 'callout',
    title: content.dataLimited ? '模块结论（资料有限）' : '模块结论',
    text: content.conclusion || '本模块尚无法形成确定结论。',
    tone: content.dataLimited ? 'red' : 'gold',
  })

  if (content.limitations && content.limitations.length > 0) {
    blocks.push({ type: 'heading', text: '资料局限' })
    blocks.push({ type: 'bullets', items: content.limitations })
  }

  for (const image of images.slice(0, 3)) {
    blocks.push({
      type: 'image',
      url: image.url,
      caption: image.caption,
      source: image.source || '资料中心',
    })
  }

  return blocks
}

/** 汇总装页：返回带页码与目录的完整文档 */
export function assembleDeepDocSpec(input: DeepDocInput): DeepDocSpec {
  const bodyPages: DeepPage[] = []

  // 01 执行摘要
  bodyPages.push(sectionPage('01', '执行摘要', '投资判断与核心理由'))
  bodyPages.push(
    ...packBlocks(
      { sectionNo: '01', sectionTitle: '执行摘要', kicker: '投资判断与核心理由' },
      [
        { type: 'heading', text: input.executive.headline || '执行摘要' },
        ...input.executive.paragraphs.map(text => ({ type: 'paragraph' as const, text })),
        { type: 'bullets', items: input.executive.bullets },
        { type: 'callout', title: '总体结论', text: input.executive.conclusion, tone: 'gold' },
      ]
    )
  )

  // 02 行业与时机
  bodyPages.push(sectionPage('02', '行业、时机与价值判断', '外部环境与窗口期'))
  bodyPages.push(
    ...packBlocks(
      { sectionNo: '02', sectionTitle: '行业、时机与价值判断', kicker: '外部环境与窗口期' },
      [
        { type: 'heading', text: input.outlook.industry.headline || '行业格局' },
        ...input.outlook.industry.paragraphs.map(text => ({ type: 'paragraph' as const, text })),
        { type: 'bullets', items: input.outlook.industry.bullets },
        { type: 'heading', text: input.outlook.timing.headline || '时机窗口' },
        ...input.outlook.timing.paragraphs.map(text => ({ type: 'paragraph' as const, text })),
        { type: 'bullets', items: input.outlook.timing.bullets },
      ]
    )
  )

  // 03–11 九大模块
  input.modules.forEach((module, index) => {
    const no = String(index + 3).padStart(2, '0')
    const moduleImages = input.images.filter(img => img.moduleKey === module.moduleKey)
    const moduleCharts: DeepBlock[] = []
    if (module.moduleKey === 'MARKET_CUSTOMERS' && input.charts.coverage) {
      moduleCharts.push(input.charts.coverage)
    }
    if (module.moduleKey === 'FINANCE_ECONOMICS' && input.charts.financeFacts) {
      moduleCharts.push(input.charts.financeFacts)
    }
    bodyPages.push(sectionPage(no, module.moduleName, module.coreQuestion))
    bodyPages.push(
      ...packBlocks(
        { sectionNo: no, sectionTitle: module.moduleName, kicker: module.coreQuestion },
        moduleBlocks(module, moduleImages, moduleCharts)
      )
    )
  })

  // 12 风险、估值与结论
  const riskBlocks: DeepBlock[] = [
    { type: 'heading', text: '主要风险与缓释' },
  ]
  if (input.outlook.risks.length > 0) {
    riskBlocks.push({
      type: 'table',
      title: '风险清单',
      columns: ['风险', '机制', '缓释/验证'],
      rows: input.outlook.risks.map(r => [r.title, r.detail, r.mitigation]),
    })
  } else {
    riskBlocks.push({ type: 'paragraph', text: '当前未识别出可量化的重大风险，仍需在投前尽调中逐项验证。' })
  }
  riskBlocks.push(
    { type: 'heading', text: input.outlook.valuation.headline || '估值与回报' },
    { type: 'bullets', items: input.outlook.valuation.bullets }
  )
  if (input.outlook.valuation.metrics && input.outlook.valuation.metrics.length > 0) {
    riskBlocks.push({
      type: 'table',
      title: '估值与回报指标',
      columns: ['指标', '数值', '口径'],
      rows: input.outlook.valuation.metrics.map(m => [m.label, m.value, m.hint || '—']),
    })
  }
  if (input.charts.grades) riskBlocks.push(input.charts.grades)
  if (input.charts.evidenceByModule) riskBlocks.push(input.charts.evidenceByModule)
  riskBlocks.push(
    { type: 'heading', text: input.outlook.conclusion.headline || '结论与建议' },
    { type: 'paragraph', text: '建议的投放条件：' },
    { type: 'bullets', items: input.outlook.conclusion.conditions },
    { type: 'paragraph', text: '交割前需完成的验证动作：' },
    { type: 'bullets', items: input.outlook.conclusion.nextSteps }
  )
  bodyPages.push(sectionPage('12', '风险、估值与结论', '风险定价与交易建议'))
  bodyPages.push(
    ...packBlocks({ sectionNo: '12', sectionTitle: '风险、估值与结论', kicker: '风险定价与交易建议' }, riskBlocks)
  )

  // 13 资料局限
  bodyPages.push(sectionPage('13', '资料局限与待验证', '本报告的边界'))
  const limitationItems = input.limitations.length > 0
    ? input.limitations
    : ['未发现显著资料缺口；结论仍以公开信息与已上传资料为限。']
  bodyPages.push(
    ...packBlocks({ sectionNo: '13', sectionTitle: '资料局限与待验证', kicker: '本报告的边界' }, [
      { type: 'heading', text: '资料与信息边界' },
      { type: 'bullets', items: limitationItems },
      {
        type: 'callout',
        title: '使用说明',
        text: '本报告由资料中心材料与公开检索自动汇总生成，不构成投资决策的唯一依据；涉及财务、法务与交易的结论须以正式尽调核验为准。',
        tone: 'teal',
      },
    ])
  )

  // 14 附录
  const appendixBlocks: DeepBlock[] = [
    { type: 'heading', text: '证据索引（公开事实）' },
  ]
  if (input.appendix.facts.length > 0) {
    appendixBlocks.push({
      type: 'table',
      title: '公开事实与来源',
      columns: ['编号', '模块', '事实', '等级', '来源'],
      rows: input.appendix.facts.map(f => [
        f.ref,
        f.moduleName,
        f.fact,
        f.grade,
        f.source || '—',
      ]),
    })
  } else {
    appendixBlocks.push({ type: 'paragraph', text: '暂无公开事实记录。' })
  }
  appendixBlocks.push({ type: 'heading', text: '来源索引' })
  if (input.appendix.sources.length > 0) {
    appendixBlocks.push({
      type: 'table',
      title: '公开来源',
      columns: ['编号', '标题', '域名', '等级'],
      rows: input.appendix.sources.map(s => [s.ref, s.title, s.domain, s.grade]),
    })
  } else {
    appendixBlocks.push({ type: 'paragraph', text: '暂无公开来源记录。' })
  }
  bodyPages.push(sectionPage('14', '附录', '证据与来源索引'))
  bodyPages.push(
    ...packBlocks({ sectionNo: '14', sectionTitle: '附录', kicker: '证据与来源索引' }, appendixBlocks)
  )

  // 封面 + 目录（目录先占位，回填页码）
  const cover: DeepPage = { pageNo: 1, kind: 'cover', blocks: [] }
  const toc: DeepPage = { pageNo: 2, kind: 'toc', blocks: [] }
  const pages = [cover, toc, ...bodyPages]
  pages.forEach((page, index) => {
    page.pageNo = index + 1
  })

  const tocItems: DeepTocItem[] = pages
    .filter(page => page.kind === 'section' && page.sectionNo && page.sectionTitle)
    .map(page => ({
      no: page.sectionNo as string,
      title: page.sectionTitle as string,
      page: page.pageNo,
    }))

  const company = input.project.companyFullName || input.project.name
  return {
    kind: 'DOCUMENT',
    type: 'DEEP',
    title: '尽职调查报告',
    subtitle: input.project.companyPosition || '深度尽调分析与投资建议',
    projectName: company,
    companyFullName: input.project.companyFullName || undefined,
    industry: input.project.industry || undefined,
    financingRound: input.project.financingRound || undefined,
    totalAmount: input.project.totalAmount || undefined,
    generatedAt: input.generatedAt,
    theme: 'navy-gold',
    pageCount: pages.length,
    toc: tocItems,
    stats: input.stats,
    pages,
  }
}

function isValidImageUrl(url: string): boolean {
  if (!url) return false
  if (url.startsWith('/')) return true
  return /^https?:\/\//i.test(url)
}

function clampText(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function coerceBlock(block: DeepBlock): DeepBlock | null {
  switch (block.type) {
    case 'heading': {
      const text = clampText(block.text, 120)
      return text ? { ...block, text } : null
    }
    case 'paragraph': {
      const text = clampText(block.text, 1200)
      return text ? { type: 'paragraph', text } : null
    }
    case 'bullets': {
      const items = block.items.map(item => clampText(item, 300)).filter(Boolean).slice(0, 12)
      return items.length > 0 ? { type: 'bullets', items } : null
    }
    case 'qa': {
      const items = block.items
        .map(item => ({
          question: clampText(item.question, 180),
          answer: clampText(item.answer, 900),
          refs: Array.isArray(item.refs) ? item.refs.filter(Boolean).slice(0, 6) : undefined,
        }))
        .filter(item => item.question && item.answer)
        .slice(0, 6)
      return items.length > 0 ? { type: 'qa', items } : null
    }
    case 'table': {
      const columns = block.columns.map(c => clampText(c, 40)).filter(Boolean).slice(0, 6)
      if (columns.length < 2) return null
      const rows = block.rows
        .slice(0, 8)
        .map(row => row.slice(0, columns.length).map(cell => clampText(cell, 140)))
        .filter(row => row.length > 0)
      if (rows.length === 0) return null
      return {
        type: 'table',
        title: block.title ? clampText(block.title, 80) : undefined,
        columns,
        rows: rows.map(row => {
          const filled = [...row]
          while (filled.length < columns.length) filled.push('—')
          return filled
        }),
        note: block.note ? clampText(block.note, 160) : undefined,
      }
    }
    case 'chart': {
      const series = block.chart.series
        .filter(item => Number.isFinite(item.value))
        .map(item => ({ label: clampText(item.label, 24), value: Math.max(0, item.value), color: item.color }))
        .slice(0, 12)
      if (series.length === 0) return null
      return {
        type: 'chart',
        title: clampText(block.title, 80),
        unit: block.unit ? clampText(block.unit, 20) : undefined,
        note: block.note ? clampText(block.note, 160) : undefined,
        chart: { kind: block.chart.kind, series },
      }
    }
    case 'image': {
      if (!isValidImageUrl(block.url)) return null
      const caption = clampText(block.caption, 120)
      if (!caption) return null
      return {
        type: 'image',
        url: block.url,
        caption,
        source: block.source ? clampText(block.source, 80) : undefined,
      }
    }
    case 'callout': {
      const text = clampText(block.text, 600)
      return text ? { ...block, text } : null
    }
    default:
      return null
  }
}

/** 清洗并重排页码/目录；空内容页会被移除 */
export function coerceDeepDocSpec(spec: DeepDocSpec): DeepDocSpec {
  const pages: DeepPage[] = []
  for (const page of spec.pages) {
    const blocks = page.kind === 'cover' || page.kind === 'toc' || page.kind === 'section'
      ? []
      : page.blocks.map(coerceBlock).filter((b): b is DeepBlock => Boolean(b))
    if (page.kind !== 'cover' && page.kind !== 'toc' && page.kind !== 'section' && blocks.length === 0) {
      continue
    }
    pages.push({ ...page, blocks })
  }

  const cover: DeepPage = pages.find(p => p.kind === 'cover') || { pageNo: 1, kind: 'cover', blocks: [] }
  const toc: DeepPage = pages.find(p => p.kind === 'toc') || { pageNo: 2, kind: 'toc', blocks: [] }
  const rest = pages.filter(p => p.kind !== 'cover' && p.kind !== 'toc')
  const ordered = [cover, toc, ...rest]
  ordered.forEach((page, index) => {
    page.pageNo = index + 1
  })

  return {
    ...spec,
    pageCount: ordered.length,
    toc: ordered
      .filter(page => page.kind === 'section' && page.sectionNo && page.sectionTitle)
      .map(page => ({
        no: page.sectionNo as string,
        title: page.sectionTitle as string,
        page: page.pageNo,
      })),
    pages: ordered,
  }
}

export function estimatePageCount(spec: DeepDocSpec): number {
  spec.pageCount = Array.isArray(spec.pages) ? spec.pages.length : 0
  return spec.pageCount
}
