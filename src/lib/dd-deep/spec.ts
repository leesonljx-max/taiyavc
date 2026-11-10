/**
 * 深度尽调报告文档规格（16:9 横向页面，1280×720）
 *
 * AI 只提供内容块；页面由服务端按高度预算装页，页数随内容自然增长。
 * 模块内的每个论点独立成页，按「内容 / 分析 / 论据 / 观点」四段式展开。
 * 文档结构：封面 → 目录 → 执行摘要 → 行业与时机 → 九大模块 → 风险估值结论 → 资料利用与局限 → 附录。
 */

export interface DeepArgumentEvidence {
  /** 论据陈述：这条论据说明什么 */
  text: string
  /** 证据编号：F1 / E2 / 资料1 */
  ref?: string
  /** 资料中心原文逐字摘录 */
  quote?: string
}

export interface DeepArgument {
  /** 论点：可判断的结论句 */
  title: string
  /** 内容：事实与现状 */
  content: string
  /** 分析：原因、机制、反证与影响 */
  analysis: string
  /** 论据：支撑该论点的证据 */
  evidence: DeepArgumentEvidence[]
  /** 观点：投资含义与判断 */
  view: string
  /** 关联的资料中心图片编号（图1、图2...） */
  imageId?: string
}

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
        | { kind: 'bar' | 'donut'; series: Array<{ label: string; value: number; color?: string }> }
        | {
            kind: 'stackedBar'
            categories: string[]
            series: Array<{ label: string; values: number[]; color?: string }>
          }
    }
  | { type: 'image'; url: string; caption: string; source?: string }
  | { type: 'callout'; title?: string; text: string; tone?: 'gold' | 'red' | 'teal' }
  | {
      type: 'argument'
      index: number
      total: number
      argument: DeepArgument
      image?: { url: string; caption: string; source?: string }
    }

export type DeepPageKind = 'cover' | 'toc' | 'section' | 'content' | 'appendix'

export interface DeepPage {
  pageNo: number
  kind: DeepPageKind
  sectionNo?: string
  sectionTitle?: string
  kicker?: string
  /** 章节页统计数据（资料/证据/图表等） */
  sectionStats?: Array<{ label: string; value: string }>
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
  /** 对模块核心问题的直接回答 */
  coreAnswer?: string
  /** 论点式正文：每个论点含内容/分析/论据/观点 */
  arguments?: DeepArgument[]
  /** 兼容旧版报告 */
  questions?: Array<{ question: string; answer: string; refs?: string[] }>
  facts?: string[]
  analysis?: string[]
  conclusion: string
  metrics?: Array<{ label: string; value: string; hint?: string }>
  limitations?: string[]
  dataLimited?: boolean
}

export interface DeepImage {
  /** 模块内图片编号：图1、图2... */
  id?: string
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
  /** 章节页统计 */
  stats?: Array<{ label: string; value: string }>
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
    /** 资料中心文本贡献（千字） */
    docContribution?: DeepBlock | null
    /** 各模块证据等级构成 */
    moduleEvidence?: DeepBlock | null
    /** 各模块专属图表 */
    moduleCharts?: Record<string, DeepBlock | null>
    /** 资料利用统计表 */
    docUsage?: DeepBlock | null
  }
  images: DeepImage[]
  limitations: string[]
  appendix: {
    facts: DeepAppendixFact[]
    sources: DeepAppendixSource[]
    /** 资料中心资料索引 */
    documents?: Array<{ ref: string; fileName: string; moduleName: string; textLength: number }>
  }
  stats: {
    sourceCount: number
    factCount: number
    docCount: number
    imageCount: number
  }
}

/** 16:9 页面正文可用高度约 560px（1280×720，扣除页眉页脚与内边距） */
const PAGE_BUDGET = 560
const PARAGRAPH_CHUNK = 620
const TABLE_BUDGET = 430

function textHeight(text: string, charsPerLine = 62, lineHeight = 29): number {
  return Math.ceil(Math.max(text.length, 1) / charsPerLine) * lineHeight
}

function tableRowHeight(row: string[], columns: number): number {
  const charsPerLine = Math.max(8, Math.floor(86 / Math.max(columns, 1)))
  const longest = row.reduce((max, cell) => Math.max(max, cell.length), 0)
  return Math.max(32, Math.ceil(longest / charsPerLine) * 20 + 14)
}

function blockHeight(block: DeepBlock): number {
  switch (block.type) {
    case 'heading':
      return block.level === 2 ? 40 : 48
    case 'paragraph':
      return textHeight(block.text) + 10
    case 'bullets':
      return block.items.reduce((sum, item) => sum + textHeight(item, 58, 27) + 10, 4)
    case 'qa':
      return block.items.reduce(
        (sum, item) => sum + 30 + textHeight(item.question, 56, 25) + textHeight(item.answer, 58, 27) + 14,
        4
      )
    case 'table': {
      const rows = block.rows.reduce((sum, row) => sum + tableRowHeight(row, block.columns.length), 0)
      return rows + 56
    }
    case 'chart':
      if (block.chart.kind === 'stackedBar') return block.chart.categories.length * 30 + 76
      if (block.chart.kind === 'donut') return 260
      return Math.min(430, block.chart.series.length * 30 + 74)
    case 'image':
      return 330
    case 'callout':
      return 40 + textHeight(block.text, 58, 27)
    case 'argument':
      return 620
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
    // 论点独立成页：保证「内容/分析/论据/观点」完整呈现在同一页
    if (block.type === 'argument') {
      flush()
      pages.push({
        pageNo: 0,
        kind: 'content',
        sectionNo: meta.sectionNo,
        sectionTitle: meta.sectionTitle,
        kicker: meta.kicker,
        blocks: [block],
      })
      continue
    }

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

function sectionPage(
  no: string,
  title: string,
  kicker?: string,
  stats?: Array<{ label: string; value: string }>
): DeepPage {
  return {
    pageNo: 0,
    kind: 'section',
    sectionNo: no,
    sectionTitle: title,
    kicker,
    sectionStats: stats && stats.length > 0 ? stats : undefined,
    blocks: [],
  }
}

/**
 * 模块内容：概览页（核心回答/指标/图表/结论）+ 每个论点独立一页。
 * 图片优先绑定到论点，未被引用的图片放在概览页。
 */
function moduleBlocks(module: DeepModuleInput, images: DeepImage[], charts: DeepBlock[]): DeepBlock[] {
  const content = module.content
  const args = content.arguments && content.arguments.length > 0 ? content.arguments : []

  // 先解析论点图片，避免概览页与论点页重复用图
  const usedImageIds = new Set<string>()
  const argumentBlocks: DeepBlock[] = args.map((argument, index) => {
    let image = argument.imageId ? images.find(img => img.id === argument.imageId) : undefined
    if (!image) image = images.find(img => img.id && !usedImageIds.has(img.id))
    if (image?.id) usedImageIds.add(image.id)
    return {
      type: 'argument' as const,
      index: index + 1,
      total: args.length,
      argument,
      image: image ? { url: image.url, caption: image.caption, source: image.source || '资料中心' } : undefined,
    }
  })

  const overviewBlocks: DeepBlock[] = []

  overviewBlocks.push({
    type: 'callout',
    title: '模块核心回答',
    text: content.coreAnswer || content.headline || '本模块尚无法形成确定回答。',
    tone: 'teal',
  })

  if (args.length >= 2) {
    overviewBlocks.push({ type: 'heading', text: '本模块论点' })
    overviewBlocks.push({
      type: 'bullets',
      items: args.map((argument, index) => `论点 ${index + 1}：${argument.title}`),
    })
  }

  // 兼容旧版报告：提问式内容
  if (args.length === 0 && content.questions && content.questions.length > 0) {
    overviewBlocks.push({
      type: 'qa',
      items: content.questions.map(q => ({ question: q.question, answer: q.answer, refs: q.refs })),
    })
  }

  if (args.length === 0 && content.facts && content.facts.length > 0) {
    overviewBlocks.push({ type: 'heading', text: '资料与发现' })
    overviewBlocks.push({ type: 'bullets', items: content.facts })
  }

  if (args.length === 0 && content.analysis && content.analysis.length > 0) {
    overviewBlocks.push({ type: 'heading', text: '分析' })
    overviewBlocks.push({ type: 'bullets', items: content.analysis })
  }

  if (content.metrics && content.metrics.length > 0) {
    overviewBlocks.push({
      type: 'table',
      title: '关键指标',
      columns: ['指标', '数值', '口径/来源'],
      rows: content.metrics.map(m => [m.label, m.value, m.hint || '—']),
    })
  }

  for (const chart of charts) overviewBlocks.push(chart)

  overviewBlocks.push({
    type: 'callout',
    title: content.dataLimited ? '模块结论（资料有限）' : '模块结论',
    text: content.conclusion || '本模块尚无法形成确定结论。',
    tone: content.dataLimited ? 'red' : 'gold',
  })

  const leftoverImages = images.filter(img => !img.id || !usedImageIds.has(img.id)).slice(0, 2)
  for (const image of leftoverImages) {
    overviewBlocks.push({
      type: 'image',
      url: image.url,
      caption: image.caption,
      source: image.source || '资料中心',
    })
  }

  if (content.limitations && content.limitations.length > 0) {
    overviewBlocks.push({ type: 'heading', text: '资料局限' })
    overviewBlocks.push({ type: 'bullets', items: content.limitations })
  }

  return [...overviewBlocks, ...argumentBlocks]
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
        ...(input.charts.coverage ? [input.charts.coverage] : []),
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
    const moduleImages = input.images
      .filter(img => img.moduleKey === module.moduleKey)
      .map((img, imageIndex) => ({ ...img, id: img.id || `图${imageIndex + 1}` }))
    const moduleCharts: DeepBlock[] = []
    const dedicated = input.charts.moduleCharts?.[module.moduleKey]
    if (dedicated) {
      moduleCharts.push(dedicated)
    } else if (module.moduleKey === 'MARKET_CUSTOMERS' && input.charts.coverage) {
      moduleCharts.push(input.charts.coverage)
    } else if (module.moduleKey === 'FINANCE_ECONOMICS' && input.charts.financeFacts) {
      moduleCharts.push(input.charts.financeFacts)
    }
    bodyPages.push(sectionPage(no, module.moduleName, module.coreQuestion, module.stats))
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
  if (input.charts.moduleEvidence) riskBlocks.push(input.charts.moduleEvidence)
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

  // 13 资料利用与局限
  const limitationItems = input.limitations.length > 0
    ? input.limitations
    : ['未发现显著资料缺口；结论仍以公开信息与已上传资料为限。']
  const utilizationBlocks: DeepBlock[] = [
    { type: 'heading', text: '资料利用统计' },
  ]
  if (input.charts.docUsage) utilizationBlocks.push(input.charts.docUsage)
  if (input.charts.docContribution) utilizationBlocks.push(input.charts.docContribution)
  utilizationBlocks.push(
    { type: 'heading', text: '资料与信息边界' },
    { type: 'bullets', items: limitationItems },
    {
      type: 'callout',
      title: '引用与核验说明',
      text: '每个论点的「论据」优先引用资料中心原文（标注资料编号与页码），公开检索事实以 F/E 编号标注；原文摘录经过程序校验，未能逐字匹配的引用不会展示。涉及财务、法务与交易的结论仍须以正式尽调核验为准。',
      tone: 'teal',
    }
  )
  bodyPages.push(sectionPage('13', '资料利用与局限', '资料使用、证据边界与待验证事项'))
  bodyPages.push(
    ...packBlocks(
      { sectionNo: '13', sectionTitle: '资料利用与局限', kicker: '资料使用、证据边界与待验证事项' },
      utilizationBlocks
    )
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

  appendixBlocks.push({ type: 'heading', text: '资料中心资料索引' })
  if (input.appendix.documents && input.appendix.documents.length > 0) {
    appendixBlocks.push({
      type: 'table',
      title: '上传资料',
      columns: ['编号', '文件', '模块', '文本量'],
      rows: input.appendix.documents.map(doc => [
        doc.ref,
        doc.fileName,
        doc.moduleName,
        `${Math.round((doc.textLength / 1000) * 10) / 10}k 字`,
      ]),
      note: '正文论据中的 [资料N] 对应本索引；原文摘录均经过程序逐字校验。',
    })
  } else {
    appendixBlocks.push({ type: 'paragraph', text: '资料中心暂无上传资料。' })
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
        .slice(0, 60)
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
      if (block.chart.kind === 'stackedBar') {
        const categories = block.chart.categories.map(c => clampText(c, 20)).filter(Boolean).slice(0, 10)
        if (categories.length === 0) return null
        const series = block.chart.series
          .map(item => ({
            label: clampText(item.label, 24),
            values: categories.map((_, index) => {
              const value = item.values[index]
              return Number.isFinite(value) ? Math.max(0, value) : 0
            }),
            color: item.color,
          }))
          .filter(item => item.label && item.values.some(value => value > 0))
          .slice(0, 6)
        if (series.length === 0) return null
        return {
          type: 'chart',
          title: clampText(block.title, 80),
          unit: block.unit ? clampText(block.unit, 20) : undefined,
          note: block.note ? clampText(block.note, 160) : undefined,
          chart: { kind: 'stackedBar', categories, series },
        }
      }
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
    case 'argument': {
      const argument = block.argument
      const title = clampText(argument.title, 90)
      const content = clampText(argument.content, 340)
      const analysis = clampText(argument.analysis, 420)
      const view = clampText(argument.view, 260)
      const evidence = (argument.evidence || [])
        .map(item => ({
          text: clampText(item.text, 130),
          ref: item.ref ? clampText(item.ref, 60) : undefined,
          quote: item.quote ? clampText(item.quote, 170) : undefined,
        }))
        .filter(item => item.text)
        .slice(0, 2)
      if (!title || !content || !analysis || !view || evidence.length === 0) return null
      let image: { url: string; caption: string; source?: string } | undefined
      if (block.image && isValidImageUrl(block.image.url) && block.image.caption) {
        image = {
          url: block.image.url,
          caption: clampText(block.image.caption, 140),
          source: block.image.source ? clampText(block.image.source, 80) : undefined,
        }
      }
      return {
        type: 'argument',
        index: Math.max(1, Math.min(99, Math.round(block.index || 1))),
        total: Math.max(1, Math.min(99, Math.round(block.total || 1))),
        argument: {
          title,
          content,
          analysis,
          view,
          evidence,
          imageId: argument.imageId ? clampText(argument.imageId, 20) : undefined,
        },
        image,
      }
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
