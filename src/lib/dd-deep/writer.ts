/**
 * 深度报告内容生成
 *
 * 每个模块一次 LLM 调用，输出 3–5 个论点；每个论点按「内容/分析/论据/观点」展开。
 * 论据必须引用资料中心原文或公开事实，引用摘录在服务端做逐字校验。
 * 另两次调用生成执行摘要与行业/时机/风险/估值/结论。
 * 任何失败都回退到资料与事实拼装，保证报告始终可产出。
 */

import { callDeepSeekJson } from '@/lib/dd-research/llm'
import type { DeepContext, DeepModuleContext } from './context'
import type {
  DeepArgument,
  DeepArgumentEvidence,
  DeepImage,
  DeepModuleContent,
  DeepNarrative,
  DeepRisk,
} from './spec'

export interface DeepExecutive {
  headline: string
  paragraphs: string[]
  bullets: string[]
  conclusion: string
  dataLimited?: boolean
}

export interface DeepOutlook {
  industry: DeepNarrative
  timing: DeepNarrative
  risks: DeepRisk[]
  valuation: {
    headline: string
    bullets: string[]
    metrics: Array<{ label: string; value: string; hint?: string }>
  }
  conclusion: {
    headline: string
    conditions: string[]
    nextSteps: string[]
  }
  dataLimited?: boolean
}

const SYSTEM_PROMPT = [
  '你是风险投资机构的尽调报告主笔，为投委会撰写 16:9 深度尽调报告。写作要求：',
  '1. 论点驱动：每个模块输出 3–5 个可判断的论点，每个论点必须按「内容 → 分析 → 论据 → 观点」四段展开。',
  '   - 内容：基于资料的事实与现状，不写评价；',
  '   - 分析：解释原因、机制、反证条件与影响；',
  '   - 论据：给出支撑该论点的事实编号或资料原文摘录；',
  '   - 观点：对投资决策的含义，明确成立条件或反对理由。',
  '2. 必须优先使用资料中心上传的资料：引用写 [资料1]、[资料2]；公开事实写 [F3]；公开来源写 [E2]。',
  '3. 资料中心的原文摘录必须逐字复制，不得改写、拼接或编造；引用编号写 [资料1]、[资料2]，不要编造页码。',
  '4. 每个论点至少 1 条论据来自资料中心原文或公开事实；没有资料支撑就明确写「资料不足，待验证」，不得用行业常识冒充事实。',
  '5. 公司收入、订单、客户、估值等数字只能来自给定事实或资料原文；没有就写「公开信息不足」，不得猜测。',
  '6. 允许使用行业常识补充背景，但必须写成分析判断，不得伪装成公司事实。',
  '7. 明确区分「事实」「推测」「待验证」，对资料冲突要指出。',
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
    `【${module.moduleKey} ${module.moduleName}】`,
    `模块核心问题：${module.coreQuestion}`,
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
    for (const fact of module.facts.slice(0, 12)) {
      const value = fact.value ? `：${fact.value}${fact.unit || ''}` : ''
      const period = fact.period ? `（${fact.period}）` : ''
      lines.push(`- [${fact.ref}] ${truncate(fact.fact, 120)}${value}${period}｜等级 ${fact.grade}｜来源 ${fact.sourceRef || '未标注'}`)
    }
  }

  lines.push('', '公开来源：')
  if (module.sources.length === 0) {
    lines.push('- 无')
  } else {
    for (const source of module.sources) {
      const ref = source.ref ? `[${source.ref}]` : ''
      lines.push(`- ${ref} ${truncate(source.title, 60)}｜${source.domain}｜${source.grade} 级`)
      if (source.excerpt) lines.push(`  摘录：${truncate(source.excerpt, 600)}`)
    }
  }

  lines.push('', '资料中心上传资料：')
  if (module.documents.length === 0) {
    lines.push('- 无')
  } else {
    module.documents.forEach((doc, index) => {
      const text = doc.text || '（该文件未提取到文本）'
      lines.push(`- [资料${index + 1}] ${doc.fileName}（原文 ${doc.textLength} 字）`)
      lines.push(`  ${truncate(text, 6000)}`)
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
    lines.push('', `未补齐资料：${openGaps.slice(0, 6).map(gap => gap.label).join('、')}`)
  } else {
    lines.push('', '未补齐资料：无')
  }

  return lines.join('\n')
}

const MODULE_SCHEMA = `{
  "headline": "本模块一句话结论（≤40字）",
  "coreAnswer": "对模块核心问题的直接回答（≤120字，含依据）",
  "arguments": [
    {
      "title": "论点（≤30字，判断句）",
      "content": "内容：事实与现状（≤220字，只写资料支持的事实）",
      "analysis": "分析：原因、机制、反证条件与影响（≤260字）",
      "evidence": [
        {"text": "论据说明（≤90字）", "ref": "资料1 或 F3", "quote": "资料中心原文逐字摘录（≤100字）"}
      ],
      "view": "观点：投资含义、成立条件或反对理由（≤160字）",
      "image": "图1 或空字符串"
    }
  ],
  "conclusion": "本模块结论（≤150字）",
  "metrics": [{"label":"指标","value":"数值","hint":"口径或来源"}],
  "limitations": ["资料不足、冲突或需人工核验之处"]
}`

export async function generateModuleContent(
  context: DeepContext,
  module: DeepModuleContext,
  images: DeepImage[] = []
): Promise<DeepModuleContent> {
  const prompt = [
    buildProjectBrief(context),
    '',
    buildModuleInput(module, images),
    '',
    '请针对本模块输出 JSON，要求：',
    '- arguments 3–5 个；每个论点必须是可判断的结论句，不得写成「需关注/需补充」式提醒；',
    '- 每个论点必须完整给出 content / analysis / evidence / view 四段，缺一不可；',
    '- evidence 1–2 条：优先引用 [资料N] 原文，quote 必须从上面资料中逐字复制；其次引用 [F#] 公开事实；',
    '- 资料中心有可用资料时，至少 2 个论点的论据必须包含 [资料N] 原文摘录；不得只用公开来源；',
    '- 每个论点最多关联 1 张图片（image 填图号），图片必须与论点内容相关，不确定就留空；',
    '- conclusion 1 条，明确「成立/不成立/待验证」及条件；',
    '- metrics 0–4 个，只填资料中出现的数值，没有就给空数组；',
    '- limitations 0–4 条，指出资料缺口或冲突。',
    '',
    MODULE_SCHEMA,
  ].join('\n')

  const raw = await callDeepSeekJson<unknown>({
    system: SYSTEM_PROMPT,
    user: prompt,
    module: 'dd-deck',
    maxTokens: 7000,
    timeoutMs: 300_000,
    temperature: 0.3,
  }).catch(() => null)

  const parsed = coerceModuleContent(raw, module)
  return parsed || fallbackModuleContent(module)
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
  module.documents.forEach((_, index) => refs.add(`资料${index + 1}`))
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
      return { ref: `资料${index + 1}`, isDocument: true }
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
    if (evidence.length >= 2) break
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    let text = asString(record.text, 110)
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

function coerceModuleContent(raw: unknown, module: DeepModuleContext): DeepModuleContent | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>

  const allowed = allowedRefs(module)
  const args: DeepArgument[] = []
  if (Array.isArray(data.arguments)) {
    for (const item of data.arguments) {
      if (args.length >= 5) break
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const title = asString(record.title, 60)
      const content = asString(record.content, 300)
      const analysis = asString(record.analysis, 360)
      const view = asString(record.view, 240)
      const evidence = coerceEvidence(record.evidence, module, allowed)
      if (!title || !content || !analysis || !view || evidence.length === 0) continue
      const image = asString(record.image, 20)
      const imageId = /^图\d+$/.test(image) ? image : undefined
      args.push({ title, content, analysis, evidence, view, ...(imageId ? { imageId } : {}) })
    }
  }

  const conclusion = asString(data.conclusion, 400)
  if (args.length < 2 || !conclusion) return null

  // 论点不足 3 个时，用资料原文论点补齐，保证模块结构完整
  for (const fallback of fallbackArguments(module)) {
    if (args.length >= 3) break
    if (!args.some(item => item.title === fallback.title)) args.push(fallback)
  }

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
    moduleKey: module.moduleKey,
    headline: asString(data.headline, 120) || `${module.moduleName}：基于现有资料的判断`,
    coreAnswer: asString(data.coreAnswer, 240) || asString(data.headline, 120),
    arguments: args,
    conclusion,
    metrics,
    limitations: asStringArray(data.limitations, 4, 200),
    dataLimited: module.facts.length === 0 && module.sources.length === 0 && module.documents.every(doc => !doc.text),
  }
}

/** 从资料原文截取一段完整语句，保证 quote 是原文的精确子串 */
function docQuote(text: string, max = 110): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const cut = clean.slice(0, max)
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'))
  return stop >= 40 ? cut.slice(0, stop + 1) : cut
}

/** 兜底论点：直接引用资料原文与公开事实，保证报告仍以资料为依据 */
export function fallbackArguments(module: DeepModuleContext): DeepArgument[] {
  const args: DeepArgument[] = []
  const facts = module.facts.slice(0, 4)
  const docs = module.documents
    .map((doc, index) => ({ doc, ref: `资料${index + 1}` }))
    .filter(item => item.doc.text)
  const openGaps = module.gaps.filter(gap => gap.status === 'OPEN')
  const coverage = Math.round(module.coverage * 100)

  if (module.humanConclusion || module.report?.summary) {
    const evidence: DeepArgumentEvidence[] = []
    if (facts[0]) {
      evidence.push({
        text: `公开信息：${truncate(facts[0].fact, 120)}${facts[0].value ? `（${facts[0].value}${facts[0].unit || ''}）` : ''}`,
        ref: facts[0].ref,
      })
    }
    if (docs[0]) {
      const quote = docQuote(docs[0].doc.text, 100)
      if (quote) {
        evidence.push({ text: `${docs[0].doc.fileName} 原文摘录`, ref: docs[0].ref, quote })
      }
    }
    if (evidence.length === 0) {
      evidence.push({ text: '现有资料未形成可引用证据，以下判断待进一步验证。' })
    }
    args.push({
      title: `${module.moduleName}：人工结论与综合判断`,
      content: truncate(module.humanConclusion || module.report?.summary || '', 360),
      analysis: `该判断来自项目维护人与既有报告，信息覆盖度 ${coverage}%。${
        openGaps.length > 0
          ? `仍有 ${openGaps.length} 项资料缺口（${openGaps.slice(0, 3).map(gap => gap.label).join('、')}），结论需在补齐材料后复核。`
          : '现有资料未发现显著缺口，但仍需核验原始凭证。'
      }`,
      evidence,
      view: openGaps.length > 0
        ? '在缺口补齐前，本模块结论只能作为初步判断，不宜直接作为交易定价依据。'
        : '该判断可作为投前判断的基础，交易前仍需完成底稿复核。',
    })
  }

  for (const item of docs.slice(0, 3)) {
    const quote = docQuote(item.doc.text, 120)
    args.push({
      title: `${truncate(item.doc.fileName, 24)}揭示的关键信息`,
      content: truncate(item.doc.text, 280),
      analysis: `该段内容直接来自资料中心上传的《${truncate(item.doc.fileName, 40)}》，原文约 ${item.doc.textLength} 字。它构成本模块的一手事实基础；${
        item.doc.textLength > 280 ? '其余内容需结合原文完整阅读。' : '资料篇幅较短，信息完整度有限。'
      }`,
      evidence: [{ text: `《${truncate(item.doc.fileName, 40)}》原文摘录`, ref: item.ref, quote }].filter(evidence => evidence.quote),
      view: '该信息可作为本模块的事实依据，但仍需与合同、台账或访谈记录交叉核验。',
    })
    if (args.length >= 3) break
  }

  if (args.length < 3 && facts.length > 0) {
    const evidence: DeepArgumentEvidence[] = facts.slice(0, 3).map(fact => ({
      text: truncate(fact.fact, 120),
      ref: fact.ref,
    }))
    args.push({
      title: '公开信息中的关键事实',
      content: facts
        .slice(0, 3)
        .map(fact => `${truncate(fact.fact, 90)}${fact.value ? `（${fact.value}${fact.unit || ''}）` : ''}`)
        .join('；'),
      analysis: `上述事实来自公开检索，平均证据等级以 B/C 级为主，信息覆盖度 ${coverage}%。公开信息可用于形成初步判断，但不能替代一手资料核验。`,
      evidence,
      view: '公开事实支持初步判断；在关键数字未经审计或合同验证前，应保留估值调整条件。',
    })
  }

  if (args.length < 3) {
    args.push({
      title: `${module.moduleName}的关键假设仍待验证`,
      content: openGaps.length > 0
        ? `尚未补齐的资料包括：${openGaps.slice(0, 5).map(gap => gap.label).join('、')}。`
        : '资料中心与公开检索均未提供足够信息，本模块尚无法形成确定结论。',
      analysis: `信息覆盖度仅 ${coverage}%，现有材料不足以支持对核心假设的定量判断，任何结论都存在较高不确定性。`,
      evidence: [{ text: openGaps[0]?.label || '缺少可引用的原始资料。' }],
      view: '建议将本模块列入投前条件，补齐资料后再形成最终判断。',
    })
  }

  return args.slice(0, 5)
}

export function fallbackModuleContent(module: DeepModuleContext): DeepModuleContent {
  const facts = module.facts.slice(0, 5)
  const args = fallbackArguments(module)
  const conclusion = module.humanConclusion
    ? truncate(module.humanConclusion, 300)
    : module.report?.summary
      ? truncate(module.report.summary, 300)
      : module.facts.length > 0
        ? `基于 ${module.facts.length} 条公开事实，本模块可形成初步判断，但结论仍待一手资料验证。`
        : `本模块公开信息与上传资料均不足，暂无法形成结论。`

  return {
    moduleKey: module.moduleKey,
    headline: `${module.moduleName}：信息覆盖 ${Math.round(module.coverage * 100)}%`,
    coreAnswer: module.humanConclusion ? truncate(module.humanConclusion, 240) : conclusion,
    arguments: args,
    conclusion,
    metrics: facts
      .filter(fact => fact.value)
      .slice(0, 4)
      .map(fact => ({
        label: truncate(fact.fact, 24),
        value: `${fact.value}${fact.unit || ''}`,
        hint: fact.period || fact.sourceRef || '公开信息',
      })),
    limitations: module.gaps.filter(gap => gap.status === 'OPEN').slice(0, 4).map(gap => gap.label),
    dataLimited: module.facts.length === 0 && module.documents.every(doc => !doc.text),
  }
}

export async function generateExecutiveSummary(
  context: DeepContext,
  modules: DeepModuleContent[]
): Promise<DeepExecutive> {
  const moduleLines = modules.map((content, index) => {
    const module = context.modules[index]
    const points = (content.arguments || []).slice(0, 3).map(item => item.title).join('；')
    return `- ${module?.moduleName || content.moduleKey}：${truncate(content.conclusion, 200)}${points ? `（核心论点：${points}）` : ''}`
  })

  const prompt = [
    buildProjectBrief(context),
    '',
    '九大模块结论：',
    ...moduleLines,
    '',
    `资料缺口：${context.limitations.slice(0, 8).join('；')}`,
    '',
    '请输出执行摘要 JSON：',
    `{
  "headline": "一句话投资判断（≤40字）",
  "paragraphs": ["2–3段，每段≤220字，说明判断依据、关键变量与边界"],
  "bullets": ["4–6条核心理由，每条≤120字，尽量带 [F#]/[E#]/[资料N]"],
  "conclusion": "总体结论与建议（≤160字）"
}`,
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
    const headline = asString(data.headline, 120)
    const paragraphs = asStringArray(data.paragraphs, 3, 600)
    const bullets = asStringArray(data.bullets, 6, 300)
    const conclusion = asString(data.conclusion, 400)
    if (headline && bullets.length >= 2 && conclusion) {
      return { headline, paragraphs, bullets, conclusion, dataLimited: false }
    }
  }
  return fallbackExecutiveSummary(context, modules)
}

export function fallbackExecutiveSummary(
  context: DeepContext,
  modules: DeepModuleContent[]
): DeepExecutive {
  const stats = context.base.research
  const limited = modules.filter(module => module.dataLimited).length
  return {
    headline: `${context.base.project.name}：基于 ${stats.sourceCount} 条来源与 ${stats.factCount} 条事实的初步判断`,
    paragraphs: [
      `本报告按九大模块汇总资料中心上传材料与全网公开信息，共形成 ${stats.factCount} 条公开事实、${stats.sourceCount} 条来源，平均信息覆盖度 ${Math.round(stats.coverage * 100)}%。`,
      `从模块结论看，${modules.slice(0, 3).map(m => m.headline).join('；')}。整体判断仍需结合交易资料与客户访谈验证。`,
    ],
    bullets: modules.slice(0, 5).map(module => truncate(module.conclusion, 160)),
    conclusion: limited > 0
      ? `当前有 ${limited} 个模块资料不足，建议先补齐关键资料再提交投委会。`
      : '现有资料可支撑初步投资判断，建议进入正式尽调与条款谈判阶段。',
    dataLimited: true,
  }
}

export async function generateOutlookAndRisks(
  context: DeepContext,
  modules: DeepModuleContent[]
): Promise<DeepOutlook> {
  const prompt = [
    buildProjectBrief(context),
    '',
    '九大模块结论：',
    ...modules.map((content, index) => `- ${context.modules[index]?.moduleName || content.moduleKey}：${truncate(content.conclusion, 200)}`),
    '',
    '请输出行业、时机、风险、估值与结论 JSON：',
    `{
  "industry": {"headline":"行业阶段与格局（≤40字）","paragraphs":["1–2段，每段≤220字"],"bullets":["4–6条：规模/增速、政策、产业链位置、竞争集中度、关键变量"]},
  "timing": {"headline":"时机窗口（≤40字）","paragraphs":["1段≤200字"],"bullets":["3–5条：为什么是现在/为什么可能太早或太晚"]},
  "risks": [{"title":"风险标题（≤20字）","detail":"机制（≤160字）","mitigation":"缓释或验证动作（≤120字）","refs":["F1"]}],
  "valuation": {"headline":"估值判断（≤40字）","bullets":["3–5条估值/回报判断，每条≤140字"],"metrics":[{"label":"指标","value":"数值","hint":"口径"}]},
  "conclusion": {"headline":"最终建议（≤40字）","conditions":["4条投放条件，每条≤100字"],"nextSteps":["4条交割前验证动作，每条≤100字"]}
}`,
    'risks 4–6 条；valuation.metrics 0–4 个，只填有依据的数值。',
  ].join('\n')

  const raw = await callDeepSeekJson<unknown>({
    system: SYSTEM_PROMPT,
    user: prompt,
    module: 'dd-deck',
    maxTokens: 3800,
    timeoutMs: 200_000,
    temperature: 0.3,
  }).catch(() => null)

  if (raw && typeof raw === 'object') {
    const data = raw as Record<string, unknown>
    const industry = coerceNarrative(data.industry)
    const timing = coerceNarrative(data.timing)
    const risks: DeepRisk[] = []
    if (Array.isArray(data.risks)) {
      for (const item of data.risks) {
        if (risks.length >= 6) break
        if (!item || typeof item !== 'object') continue
        const risk = item as Record<string, unknown>
        const title = asString(risk.title, 60)
        const detail = asString(risk.detail, 400)
        if (!title || !detail) continue
        const mitigation = asString(risk.mitigation, 300) || '列入投前条件，交割前补充验证。'
        const refs = asStringArray(risk.refs, 6, 40)
        risks.push(refs.length > 0 ? { title, detail, mitigation, refs } : { title, detail, mitigation })
      }
    }
    const valuationRaw = data.valuation && typeof data.valuation === 'object'
      ? data.valuation as Record<string, unknown>
      : null
    let valuation: DeepOutlook['valuation'] | null = null
    if (valuationRaw) {
      const metrics: Array<{ label: string; value: string; hint?: string }> = []
      if (Array.isArray(valuationRaw.metrics)) {
        for (const item of valuationRaw.metrics) {
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
      valuation = {
        headline: asString(valuationRaw.headline, 120),
        bullets: asStringArray(valuationRaw.bullets, 5, 300),
        metrics,
      }
    }
    const conclusionRaw = data.conclusion && typeof data.conclusion === 'object'
      ? data.conclusion as Record<string, unknown>
      : null
    const conclusion = conclusionRaw
      ? {
          headline: asString(conclusionRaw.headline, 120),
          conditions: asStringArray(conclusionRaw.conditions, 4, 240),
          nextSteps: asStringArray(conclusionRaw.nextSteps, 4, 240),
        }
      : null

    if (industry && timing && risks.length >= 2 && valuation && conclusion) {
      return {
        industry,
        timing,
        risks,
        valuation,
        conclusion,
        dataLimited: false,
      }
    }
  }

  return fallbackOutlook(context, modules)
}

function coerceNarrative(raw: unknown): DeepNarrative | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const headline = asString(data.headline, 120)
  const paragraphs = asStringArray(data.paragraphs, 2, 600)
  const bullets = asStringArray(data.bullets, 6, 300)
  if (!headline || bullets.length < 2) return null
  return { headline, paragraphs, bullets }
}

export function fallbackOutlook(context: DeepContext, modules: DeepModuleContent[]): DeepOutlook {
  const project = context.base.project
  const risks: DeepRisk[] = context.limitations.slice(0, 5).map((item, index) => ({
    title: `资料与验证风险 ${index + 1}`,
    detail: truncate(item, 200),
    mitigation: '列入投前条件，交割前补充并复核。',
  }))

  return {
    industry: {
      headline: `${project.industry || '所在行业'}：公开信息有限，先看需求与竞争格局`,
      paragraphs: [
        `本报告未获得完整行业数据，行业判断以公开来源与项目资料中的描述为基础，需在正式尽调中补充市场规模、增速与政策文件。`,
      ],
      bullets: [
        project.industry ? `所处行业：${project.industry}，需验证行业规模与增速口径。` : '行业归属与细分市场需进一步确认。',
        '政策与监管：需核实准入、资质与合规要求。',
        '产业链位置：需确认上游依赖与下游客户结构。',
        '竞争格局：需补充主要竞品份额与替代方案。',
      ],
    },
    timing: {
      headline: '时机判断依赖订单与融资节奏',
      paragraphs: ['当前资料不足以判断窗口期，建议以客户验证与订单交付节奏作为时机判断依据。'],
      bullets: [
        '若核心客户进入批量采购阶段，窗口期成立。',
        '若竞品已形成规模交付，窗口期可能收窄。',
        '融资节奏与现金消耗决定公司能否等到窗口期。',
      ],
    },
    risks,
    valuation: {
      headline: project.investmentValuation
        ? `当前估值 ${project.investmentValuation} 亿元，需结合收入与订单验证`
        : '估值需结合收入、订单与可比融资验证',
      bullets: [
        '估值判断需以可验证收入、毛利率与订单储备为基础。',
        '需补充可比公司融资估值与退出案例。',
        '条款应设置业绩承诺、回购与反稀释保护。',
      ],
      metrics: project.investmentValuation
        ? [{ label: '投资估值', value: `${project.investmentValuation} 亿元`, hint: '项目录入' }]
        : [],
    },
    conclusion: {
      headline: modules.some(module => module.dataLimited) ? '建议先补资料再决策' : '可进入正式尽调与条款谈判',
      conditions: [
        '完成核心客户访谈与订单台账核验。',
        '完成财务审计或管理报表复核。',
        '完成法务、知识产权与数据合规核查。',
        '就估值与关键条款达成一致。',
      ],
      nextSteps: [
        '补充近三年财务报表与收入拆分。',
        '提供前十大客户合同与回款记录。',
        '提供专利、资质与诉讼清单。',
        '安排创始人及核心团队深度访谈。',
      ],
    },
    dataLimited: true,
  }
}
