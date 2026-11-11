/**
 * 深度报告内容生成（固定框架版）
 *
 * 报告固定为「推荐理由 + 八章」，每章严格按 framework.ts 规定的小节顺序输出，
 * 每个小节一页：用归纳阐述把资料讲清楚，配 1–3 条论据，判断按需给出。
 * 论据必须引用资料中心原文（全报告统一编号 资料1…资料N）或公开事实，
 * 引用摘录在服务端做逐字校验，任何失败都回退到资料拼装，保证报告可产出。
 */

import { callDeepSeekJson } from '@/lib/dd-research/llm'
import type { DeepContext, DeepDocument, DeepModuleContext } from './context'
import type { DeepChapterSpec, DeepSectionSpec } from './framework'
import { DEEP_REPORT_PRINCIPLES, DEEP_RECOMMENDATION_DIMENSIONS, DEEP_SECTIONS } from './framework'
import type {
  DeepArgument,
  DeepArgumentEvidence,
  DeepImage,
  DeepModuleContent,
  DeepRecommendation,
  DeepRecommendationItem,
} from './spec'

const SYSTEM_PROMPT = [
  '你是风险投资机构的尽调报告主笔，为投委会撰写 16:9 深度尽调报告。写作要求：',
  '1. 严格遵循固定框架：报告固定为「推荐理由 + 八章」，章节与每章小节顺序不得增删、改名或调序。',
  '2. 论点驱动：每个小节输出一个可判断的论点，像投委会单页一样把这件事讲清楚：',
  '   - 先用 1–3 段归纳阐述，讲清资料中的事实、机制与影响，按内容需要自然组织，不要套用「内容/分析」等固定小标题；',
  '   - 再列 1–3 条论据，给出支撑该论点的事实编号或资料原文摘录；',
  '   - 最后按需给出判断与投资含义；没有把握可以不写，但不允许空泛表态。',
  '3. 必须优先使用资料中心上传的资料：引用写 [资料1]、[资料2]；公开事实写 [F3]；公开来源写 [E2]。资料编号为全报告统一编号。',
  '4. 资料中心的原文摘录必须逐字复制，不得改写、拼接或编造；不要编造页码。',
  '5. 资料不足时以公司官网、公众号、公开报道等网上宣传信息为主，并明确写「资料不足，待补充验证」，不得用行业常识冒充公司事实。',
  '6. 能表格化的内容尽量用表格；数字只能来自给定事实或资料原文，没有就写「公开信息不足」，不得猜测。',
  '7. 明确区分「事实」「推测」「待验证」，对资料冲突要指出。',
  DEEP_REPORT_PRINCIPLES,
  '只输出 JSON，不要输出 Markdown 代码块。',
].join('\n')

function truncate(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const head = clean.slice(0, max - 1)
  const boundary = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('；'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？')
  )
  if (boundary >= Math.floor(max * 0.6)) return head.slice(0, boundary + 1)
  return `${head}…`
}

function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? truncate(value, max) : ''
}

function asStringArray(value: unknown, max: number, maxEach: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => truncate(item, maxEach))
    .filter(Boolean)
    .slice(0, max)
}

function docRef(doc: DeepDocument, index: number): string {
  return doc.ref || `资料${index + 1}`
}

function buildProjectBrief(context: DeepContext): string {
  const { project, research } = context.base
  const lines: string[] = [
    `项目：${project.name}`,
    project.companyFullName ? `公司全称：${project.companyFullName}` : '',
    project.industry ? `行业：${project.industry}` : '',
    project.companyPosition ? `定位：${project.companyPosition}` : '',
    project.mainProducts ? `产品：${truncate(project.mainProducts, 180)}` : '',
    project.financingRound ? `轮次：${project.financingRound}` : '',
    project.totalAmount ? `融资金额：${project.totalAmount}` : '',
    project.investmentValuation ? `估值：${project.investmentValuation} 亿元` : '',
    project.coreAdvantage ? `核心优势：${truncate(project.coreAdvantage, 200)}` : '',
    project.coreTeam ? `核心团队：${truncate(project.coreTeam, 200)}` : '',
    project.competitors ? `竞争对手：${truncate(project.competitors, 160)}` : '',
    project.description ? `项目描述：${truncate(project.description, 300)}` : '',
    '',
    `研究统计：公开来源 ${research.sourceCount} 条，公开事实 ${research.factCount} 条，平均覆盖度 ${Math.round(research.coverage * 100)}%。`,
  ]
  return lines.filter(Boolean).join('\n')
}

function buildModuleInput(module: DeepModuleContext, images: DeepImage[]): string {
  const lines: string[] = [
    `【${module.moduleName}】`,
    `信息覆盖度：${Math.round(module.coverage * 100)}%`,
  ]

  if (module.humanConclusion) {
    lines.push(`项目维护人人工结论：${truncate(module.humanConclusion, 600)}`)
  }
  if (module.report?.summary) {
    lines.push(`模块 AI 报告摘要：${truncate(module.report.summary, 400)}`)
  }
  if (module.report?.opportunities?.length) {
    lines.push(`模块机会：${module.report.opportunities.slice(0, 3).map(o => truncate(o, 100)).join('；')}`)
  }
  if (module.report?.risks?.length) {
    lines.push(`模块风险：${module.report.risks.slice(0, 3).map(r => truncate(r, 100)).join('；')}`)
  }
  if (module.verificationSummary) {
    lines.push(`交叉核验摘要：${truncate(module.verificationSummary, 300)}`)
  }

  lines.push('', '公开事实：')
  if (module.facts.length === 0) {
    lines.push('- 无（不得编造公司数字）')
  } else {
    for (const fact of module.facts.slice(0, 16)) {
      const value = fact.value ? `：${fact.value}${fact.unit || ''}` : ''
      const period = fact.period ? `（${fact.period}）` : ''
      lines.push(`- [${fact.ref}] ${truncate(fact.fact, 120)}${value}${period}｜等级 ${fact.grade}｜来源 ${fact.sourceRef || '未标注'}`)
    }
  }

  lines.push('', '公开来源：')
  if (module.sources.length === 0) {
    lines.push('- 无')
  } else {
    for (const source of module.sources.slice(0, 8)) {
      const ref = source.ref ? `[${source.ref}]` : ''
      lines.push(`- ${ref} ${truncate(source.title, 60)}｜${source.domain}｜${source.grade} 级`)
      if (source.excerpt) lines.push(`  摘录：${truncate(source.excerpt, 600)}`)
    }
  }

  lines.push('', '资料中心上传资料：')
  if (module.documents.length === 0) {
    lines.push('- 无')
  } else {
    module.documents.slice(0, 8).forEach((doc, index) => {
      const text = doc.text || '（该文件未提取到文本）'
      lines.push(`- [${docRef(doc, index)}] ${doc.fileName}（原文 ${doc.textLength} 字）`)
      lines.push(`  ${truncate(text, 5000)}`)
    })
  }

  if (images.length > 0) {
    lines.push('', '可用资料图片（来自资料中心截图或 BP/PPT 关键页）：')
    images.forEach(image => {
      lines.push(`- ${image.id || '图'}：${truncate(image.caption, 100)}｜来源：${image.source || '资料中心'}`)
    })
    lines.push('可在论点中填写 "image": "图N" 关联最相关的一张图片；不确定就留空。')
  }

  if (module.textBlocks.length > 0) {
    lines.push('', '补充文本框：')
    module.textBlocks.forEach((block, index) => {
      lines.push(`- [资料T${index + 1}] ${truncate(block, 600)}`)
    })
  }

  if (module.analysisFacts.length > 0) {
    lines.push('', '模块分析已识别事实：')
    module.analysisFacts.forEach(fact => lines.push(`- ${truncate(fact, 200)}`))
  }

  const openGaps = module.gaps.filter(gap => gap.status === 'OPEN')
  if (openGaps.length > 0) {
    lines.push('', `未补齐资料：${openGaps.slice(0, 8).map(gap => gap.label).join('、')}`)
  } else {
    lines.push('', '未补齐资料：无')
  }

  return lines.join('\n')
}

const CHAPTER_SCHEMA = (sectionCount: number) => `{
  "headline": "本章一句话结论（≤40字）",
  "summary": "本章 1–2 句总结，用于章节标题页（≤120字）",
  "coreAnswer": "对本章核心问题的直接回答（≤120字，含依据）",
  "arguments": [
    {
      "title": "必须原样使用给定的小节标题",
      "narrative": [
        "第一段：把资料归纳成连贯论述，讲清事实与判断（≤160字）",
        "第二段：原因、机制、反证条件或影响（可选，≤160字）"
      ],
      "evidence": [
        {"text": "论据说明（≤90字）", "ref": "资料1 或 F3", "quote": "资料中心原文逐字摘录（≤100字）"}
      ],
      "takeaway": "判断与投资含义（可选，≤120字）",
      "image": "图1 或空字符串"
    }
  ],
  "conclusion": "本章结论（≤150字）",
  "metrics": [{"label":"指标","value":"数值","hint":"口径或来源"}],
  "limitations": ["资料不足、冲突或需人工核验之处"]
}`

const RECOMMENDATION_SCHEMA = `{
  "headline": "一句话推荐结论（≤60字）",
  "items": [
    {"dimension": "行业", "headline": "该维度推荐理由（≤60字）", "points": ["依据1（≤60字）", "依据2（≤60字）"]},
    {"dimension": "团队背景", "headline": "…", "points": ["…"]},
    {"dimension": "产品和业务进展", "headline": "…", "points": ["…"]},
    {"dimension": "竞争态势", "headline": "…", "points": ["…"]},
    {"dimension": "融资", "headline": "…", "points": ["…"]}
  ],
  "conclusion": "推荐结论与条件（≤160字）"
}`

export async function generateChapterContent(
  context: DeepContext,
  chapter: DeepChapterSpec,
  module: DeepModuleContext,
  images: DeepImage[] = []
): Promise<DeepModuleContent> {
  const sectionLines = chapter.sections.map((section, index) => {
    const extra = section.emphasis === 'score'
      ? '（必须给出 10 分制明确分数）'
      : section.emphasis === 'advice'
        ? '（必须给出投 / 有条件投 / 不投的明确建议）'
        : ''
    return `${index + 1}. 【${section.title}】${section.instruction}${extra}`
  })

  const prompt = [
    buildProjectBrief(context),
    '',
    `本报告固定框架：第 ${chapter.no} 章「${chapter.title}」（${chapter.kicker}）。`,
    chapter.summaryInstruction,
    '',
    '本章必须逐节输出的固定小节（顺序、数量不得变化；第 i 个论点对应第 i 个小节，title 必须原样使用小节标题）：',
    ...sectionLines,
    '',
    buildModuleInput(module, images),
    '',
    '请针对本章输出 JSON，要求：',
    `- arguments 必须恰好 ${chapter.sections.length} 个，逐节对应，顺序不得调整；`,
    '- 每个论点用 narrative 归纳阐述：1–3 段、每段 ≤160 字，把资料讲清楚，不要写「内容：」「分析：」之类标签；',
    '- evidence 1–3 条：优先引用 [资料N] 原文，quote 必须从上面资料中逐字复制；其次引用 [F#] 公开事实；',
    '- 资料中心有可用资料时，至少一半论点的论据必须包含 [资料N] 原文摘录；不得只用公开来源；',
    '- takeaway 按需给出判断与投资含义；评分页和建议页必须写，其余可为空；',
    '- 每个论点最多关联 1 张图片（image 填图号），图片必须与论点内容相关，不确定就留空；',
    '- 资料不足的小节必须明确写「资料不足，待补充验证」，并说明可用的公开宣传信息；',
    '- metrics 0–4 个，只填资料中出现的数值，没有就给空数组；',
    '- limitations 0–4 条，指出资料缺口或冲突。',
    '',
    CHAPTER_SCHEMA(chapter.sections.length),
  ].join('\n')

  const raw = await callDeepSeekJson<unknown>({
    system: SYSTEM_PROMPT,
    user: prompt,
    module: 'dd-deck',
    maxTokens: Math.min(8000, 2400 + chapter.sections.length * 800),
    timeoutMs: 300_000,
    temperature: 0.3,
  }).catch(() => null)

  return coerceChapterContent(raw, chapter, module) || fallbackChapterContent(chapter, module)
}

function normalizeQuote(text: string): string {
  return (text || '').replace(/\s+/g, '').replace(/[“”"'‘’]/g, '')
}

function canonicalRef(value: string): string | null {
  const match = value.match(/(资料\s*\d+|F\s*\d+|E\s*\d+)/i)
  if (!match) return null
  const token = match[1].replace(/\s+/g, '')
  if (/^资料/i.test(token)) return token.replace(/^资料/i, '资料')
  return token.toUpperCase()
}

function allowedRefs(module: DeepModuleContext): Set<string> {
  const refs = new Set<string>()
  for (const fact of module.facts) if (fact.ref) refs.add(fact.ref)
  for (const source of module.sources) if (source.ref) refs.add(source.ref)
  module.documents.forEach((doc, index) => refs.add(docRef(doc, index)))
  return refs
}

/** 校验原文摘录：只在资料中心文本或公开来源正文中做逐字匹配 */
function findQuoteSource(
  module: DeepModuleContext,
  quote: string
): { ref: string; isDocument: boolean } | null {
  const needle = normalizeQuote(quote)
  if (needle.length < 6) return null
  for (let index = 0; index < module.documents.length; index += 1) {
    if (normalizeQuote(module.documents[index].text).includes(needle)) {
      return { ref: docRef(module.documents[index], index), isDocument: true }
    }
  }
  for (const source of module.sources) {
    if (source.ref && normalizeQuote(source.excerpt).includes(needle)) {
      return { ref: source.ref, isDocument: false }
    }
  }
  return null
}

function coerceEvidence(
  raw: unknown,
  module: DeepModuleContext,
  allowed: Set<string>
): DeepArgumentEvidence[] {
  if (!Array.isArray(raw)) return []
  const evidence: DeepArgumentEvidence[] = []
  for (const item of raw) {
    if (evidence.length >= 3) break
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    let text = asString(record.text, 120)
    let quote = asString(record.quote, 150)
    let ref = canonicalRef(asString(record.ref, 60))

    if (quote) {
      const found = findQuoteSource(module, quote)
      if (!found) {
        quote = ''
      } else if (found.isDocument) {
        ref = found.ref
      } else if (!ref) {
        ref = found.ref
      }
    }
    if (ref && !allowed.has(ref)) ref = null
    if (!text && quote) text = `资料原文摘录：${quote.slice(0, 60)}`
    if (!text) continue
    evidence.push({
      text,
      ...(ref ? { ref } : {}),
      ...(quote ? { quote } : {}),
    })
  }
  return evidence
}

/** 从资料原文截取一段完整语句，保证 quote 是原文的精确子串 */
function docQuote(text: string, max = 110): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const cut = clean.slice(0, max)
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'))
  return stop >= 40 ? cut.slice(0, stop + 1) : cut
}

function fallbackTeamScore(module: DeepModuleContext): number {
  const docs = module.documents.filter(doc => doc.text).length
  const facts = module.facts.length
  const raw = 5 + module.coverage * 3 + Math.min(1, docs * 0.2) + Math.min(1, facts * 0.05)
  return Math.round(Math.min(9, Math.max(4, raw)) * 10) / 10
}

/** 单节兜底：直接引用资料原文与公开事实，保证固定框架每节都有页面 */
export function fallbackSectionArgument(section: DeepSectionSpec, module: DeepModuleContext): DeepArgument {
  const docs = module.documents.filter(doc => doc.text)
  const facts = module.facts
  const evidence: DeepArgumentEvidence[] = []

  if (facts[0]) {
    evidence.push({
      text: `公开信息：${truncate(facts[0].fact, 100)}${facts[0].value ? `（${facts[0].value}${facts[0].unit || ''}）` : ''}`,
      ref: facts[0].ref,
    })
  }
  const doc = docs[0]
  if (doc) {
    const quote = docQuote(doc.text, 100)
    const docIndex = module.documents.indexOf(doc)
    if (quote) evidence.push({ text: `${doc.fileName} 原文摘录`, ref: docRef(doc, docIndex), quote })
  }
  if (evidence.length === 0) {
    evidence.push({ text: '现有资料未形成可引用证据，待补充验证。' })
  }

  const factLine = facts.slice(0, 3).map(fact => truncate(fact.fact, 80)).join('；')
  const docLine = docs.slice(0, 2).map(item => `《${truncate(item.fileName, 30)}》`).join('、')
  const gaps = module.gaps.filter(gap => gap.status === 'OPEN').slice(0, 3).map(gap => gap.label)
  const coverage = Math.round(module.coverage * 100)
  const hasData = Boolean(factLine || docLine)

  const content = hasData
    ? `${section.title}：${factLine || '公开信息有限'}${
        docLine ? `；资料中心已提供 ${docLine}，可用于本小节核验` : ''
      }。`
    : `资料不足：资料中心与公开检索均未提供「${section.title}」的直接材料，待补充验证。`

  const analysis = hasData
    ? `本页按固定框架要求聚焦「${section.instruction}」。当前信息覆盖度 ${coverage}%，${
        gaps.length > 0
          ? `仍缺少 ${gaps.join('、')} 等材料，判断需在补齐后复核。`
          : '公开资料可形成初步判断，但仍需原始凭证核验。'
      }`
    : `该小节缺少一手材料，无法形成定量判断；按框架要求以公开宣传信息为主，并明确标注资料不足，避免以行业常识替代公司事实。`

  const view = section.emphasis === 'score'
    ? `团队综合评分 ${fallbackTeamScore(module).toFixed(1)}/10：依据现有履历与资料完整度给出，资料补齐后可上调或下调。`
    : section.emphasis === 'advice'
      ? '投资建议：有条件推进；列明资料补齐、客户访谈与财务核验条件后再提交投委会。'
      : section.emphasis === 'risk'
        ? '上述风险应列入投前条件，交割前逐项验证并保留估值调整条款。'
        : hasData
          ? '该小节可支撑初步判断，但仍需在投前尽调中补充一手材料复核。'
          : '该小节资料不足，暂不作为投资判断依据，建议列入资料补充清单。'

  return {
    title: section.title,
    narrative: [truncate(content, 220), truncate(analysis, 220)].filter(Boolean),
    evidence,
    takeaway: truncate(view, 220),
  }
}

function coerceChapterContent(
  raw: unknown,
  chapter: DeepChapterSpec,
  module: DeepModuleContext
): DeepModuleContent | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const allowed = allowedRefs(module)
  const rawArgs = Array.isArray(data.arguments) ? data.arguments : []

  const args: DeepArgument[] = chapter.sections.map((section, index) => {
    const fallback = fallbackSectionArgument(section, module)
    const item = rawArgs[index]
    if (!item || typeof item !== 'object') return fallback
    const record = item as Record<string, unknown>
    const narrativeRaw = Array.isArray(record.narrative) ? record.narrative : []
    // 兼容模型偶发返回旧字段 content/analysis
    const narrative = [
      ...narrativeRaw
        .filter((paragraph): paragraph is string => typeof paragraph === 'string')
        .map(paragraph => truncate(paragraph, 200))
        .filter(Boolean),
      ...(narrativeRaw.length === 0 ? [asString(record.content, 220), asString(record.analysis, 220)] : []),
    ].slice(0, 3).filter(Boolean)
    const takeaway = asString(record.takeaway, 260) || asString(record.view, 220)
    const evidence = coerceEvidence(record.evidence, module, allowed)
    if (narrative.length === 0 || evidence.length === 0) return fallback
    // 固定框架的强制项：评分页必须有 10 分制分数，建议页必须有明确投资结论
    if (section.emphasis === 'score' && !/\d+(\.\d+)?\s*\/\s*10/.test(takeaway)) return fallback
    if (section.emphasis === 'advice' && !/(不投|有条件投|建议投|可以投|暂不投)/.test(takeaway)) return fallback
    const image = asString(record.image, 20)
    const imageId = /^图\d+$/.test(image) ? image : undefined
    return {
      title: section.title,
      narrative,
      evidence,
      ...(takeaway ? { takeaway } : {}),
      ...(imageId ? { imageId } : {}),
    }
  })

  const headline = asString(data.headline, 120) || `${chapter.title}：基于现有资料的判断`
  const summary = asString(data.summary, 240) || headline
  const conclusion = asString(data.conclusion, 400) || summary

  const metrics: NonNullable<DeepModuleContent['metrics']> = []
  if (Array.isArray(data.metrics)) {
    for (const item of data.metrics) {
      if (metrics.length >= 4) break
      if (!item || typeof item !== 'object') continue
      const metric = item as Record<string, unknown>
      const label = asString(metric.label, 40)
      const value = asString(metric.value, 40)
      if (!label || !value) continue
      const hint = asString(metric.hint, 60)
      metrics.push(hint ? { label, value, hint } : { label, value })
    }
  }

  return {
    moduleKey: chapter.key,
    headline,
    summary,
    coreAnswer: asString(data.coreAnswer, 240) || summary,
    arguments: args,
    conclusion,
    metrics,
    limitations: asStringArray(data.limitations, 4, 200),
    dataLimited: module.documents.every(doc => !doc.text) && module.facts.length === 0 && module.sources.length === 0,
  }
}

export function fallbackChapterContent(
  chapter: DeepChapterSpec,
  module: DeepModuleContext
): DeepModuleContent {
  const args = chapter.sections.map(section => fallbackSectionArgument(section, module))
  const facts = module.facts.slice(0, 4)
  const limited = module.documents.every(doc => !doc.text) && module.facts.length === 0
  return {
    moduleKey: chapter.key,
    headline: `${chapter.title}：信息覆盖 ${Math.round(module.coverage * 100)}%`,
    summary: `${chapter.title}按固定框架 ${chapter.sections.length} 个小节展开，${limited ? '资料不足，待补充验证。' : '结论基于现有资料与公开信息。'}`,
    coreAnswer: module.humanConclusion
      ? truncate(module.humanConclusion, 240)
      : `${chapter.title}：${limited ? '资料不足，暂无法形成确定判断。' : `基于 ${module.facts.length} 条公开事实与 ${module.documents.length} 份资料形成初步判断。`}`,
    arguments: args,
    conclusion: limited
      ? '资料不足，待补充验证后再形成结论。'
      : `${chapter.title}可形成初步判断，仍需投前尽调复核。`,
    metrics: facts
      .filter(fact => fact.value)
      .slice(0, 4)
      .map(fact => ({
        label: truncate(fact.fact, 24),
        value: `${fact.value}${fact.unit || ''}`,
        hint: fact.period || fact.sourceRef || '公开信息',
      })),
    limitations: module.gaps.filter(gap => gap.status === 'OPEN').slice(0, 4).map(gap => gap.label),
    dataLimited: limited,
  }
}

/** 固定 5 维推荐理由：行业 / 团队背景 / 产品和业务进展 / 竞争态势 / 融资 */
export async function generateRecommendation(
  context: DeepContext,
  chapters: Array<{ chapter: DeepChapterSpec; content: DeepModuleContent }>
): Promise<DeepRecommendation> {
  const chapterLines = chapters.map(item => {
    const points = (item.content.arguments || []).slice(0, 3).map(argument => argument.title).join('；')
    return `- 第 ${item.chapter.no} 章 ${item.chapter.title}：${truncate(item.content.coreAnswer || item.content.conclusion, 180)}${
      points ? `（小节：${points}）` : ''
    }`
  })

  const prompt = [
    buildProjectBrief(context),
    '',
    '八章结论：',
    ...chapterLines,
    '',
    `资料缺口：${context.limitations.slice(0, 8).join('；')}`,
    '',
    '请输出报告第 1 页「推荐理由」JSON，必须覆盖以下 5 个维度且顺序固定：',
    DEEP_RECOMMENDATION_DIMENSIONS.map((dimension, index) => `${index + 1}. ${dimension}`).join('\n'),
    '每个维度 headline 一句话结论，points 2–3 条依据；结论必须可判断，不得写空泛评价。',
    '',
    RECOMMENDATION_SCHEMA,
  ].join('\n')

  const raw = await callDeepSeekJson<unknown>({
    system: SYSTEM_PROMPT,
    user: prompt,
    module: 'dd-deck',
    maxTokens: 2600,
    timeoutMs: 180_000,
    temperature: 0.3,
  }).catch(() => null)

  if (raw && typeof raw === 'object') {
    const data = raw as Record<string, unknown>
    const headline = asString(data.headline, 140)
    const conclusion = asString(data.conclusion, 400)
    const rawItems = Array.isArray(data.items) ? data.items : []
    const items: DeepRecommendationItem[] = []
    for (let index = 0; index < DEEP_RECOMMENDATION_DIMENSIONS.length; index += 1) {
      const dimension = DEEP_RECOMMENDATION_DIMENSIONS[index]
      const item = rawItems[index]
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : null
      const itemHeadline = record ? asString(record.headline, 140) : ''
      const points = record ? asStringArray(record.points, 3, 140) : []
      if (!itemHeadline || points.length === 0) break
      items.push({ dimension, headline: itemHeadline, points })
    }
    if (headline && conclusion && items.length === DEEP_RECOMMENDATION_DIMENSIONS.length) {
      return { headline, items, conclusion }
    }
  }

  return fallbackRecommendation(context, chapters)
}

export function fallbackRecommendation(
  context: DeepContext,
  chapters: Array<{ chapter: DeepChapterSpec; content: DeepModuleContent }>
): DeepRecommendation {
  const pick = (...keys: string[]) => chapters.filter(item => keys.includes(item.chapter.key))

  const build = (dimension: string, keys: string[], fallbackText: string): DeepRecommendationItem => {
    const selected = pick(...keys)
    const points = selected
      .flatMap(item => [
        truncate(item.content.coreAnswer || item.content.conclusion, 80),
        ...(item.content.arguments || []).slice(0, 2).map(argument => truncate(argument.takeaway || argument.narrative[0] || argument.title, 80)),
      ])
      .filter(Boolean)
      .slice(0, 3)
    return {
      dimension,
      headline: points[0] || fallbackText,
      points: points.length > 0 ? points : [fallbackText],
    }
  }

  const items: DeepRecommendationItem[] = [
    build('行业', ['INDUSTRY'], `${context.base.project.industry || '行业'}判断需补充市场数据。`),
    build('团队背景', ['TEAM'], '团队背景资料有限，待补充履历与学术成果。'),
    build('产品和业务进展', ['PRODUCT', 'BUSINESS'], '产品与业务进展资料有限，待补充订单与客户信息。'),
    build('竞争态势', ['COMPETITION'], '竞争格局需补充竞品与融资对比。'),
    build('融资', ['FINANCING'], '融资方案与估值待补充材料。'),
  ]

  return {
    headline: `${context.base.project.name}：按固定八章框架形成初步推荐判断`,
    items,
    conclusion: items.some(item => item.headline.includes('资料'))
      ? '部分维度资料不足，建议有条件推进：补齐关键资料后再提交投委会。'
      : '现有资料可支撑有条件推进，交割前完成财务、法务与客户验证。',
  }
}

/** 章节小节总数（供测试与统计） */
export const DEEP_WRITER_SECTION_COUNT = DEEP_SECTIONS.length
