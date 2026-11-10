/**
 * 深度报告内容生成
 *
 * 每个模块一次 LLM 调用，输出核心问题、资料与发现、分析、结论；
 * 另两次调用生成执行摘要与行业/时机/风险/估值/结论。
 * 任何失败都回退到资料与事实拼装，保证报告始终可产出。
 */

import { callDeepSeekJson } from '@/lib/dd-research/llm'
import type { DeepContext, DeepModuleContext } from './context'
import type { DeepModuleContent, DeepNarrative, DeepRisk } from './spec'

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
  '你是风险投资机构的尽调报告主笔，为投委会撰写 A4 深度尽调报告。写作要求：',
  '1. 先结论后论证：每个问题先给判断，再给依据、反证条件与验证路径。',
  '2. 必须使用给定资料：公开事实写 [F3]，公开来源写 [E2]，上传资料写 [资料1]；不得编造引用。',
  '3. 公司收入、订单、客户、估值等数字只能来自给定事实或资料原文；没有就写「公开信息不足」，不得猜测。',
  '4. 允许使用行业常识补充背景，但必须写成分析判断，不得伪装成公司事实。',
  '5. 每段只讲一件事，避免形容词堆砌与空话；面向投资决策，具体到业务、客户、技术、竞争与交易。',
  '6. 明确区分「事实」「推测」「待验证」，对资料冲突要指出。',
  '只输出 JSON，不要输出 Markdown 代码块。',
].join('\n')

function truncate(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
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

function buildModuleInput(module: DeepModuleContext): string {
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
      lines.push(`  ${truncate(text, 4000)}`)
    })
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
  "questions": [
    {"question": "投委会最关心的问题（≤40字）", "answer": "判断+依据+引用（≤300字）", "refs": ["F1","资料1"]}
  ],
  "facts": ["资料与发现，每条≤150字，带 [F#]/[E#]/[资料N]"],
  "analysis": ["分析判断，每条≤150字，覆盖驱动/反证/竞争影响/待验证"],
  "conclusion": "本模块结论（≤150字）",
  "metrics": [{"label":"指标","value":"数值","hint":"口径或来源"}],
  "limitations": ["资料不足、冲突或需人工核验之处"]
}`

export async function generateModuleContent(
  context: DeepContext,
  module: DeepModuleContext
): Promise<DeepModuleContent> {
  const prompt = [
    buildProjectBrief(context),
    '',
    buildModuleInput(module),
    '',
    '请针对本模块输出 JSON，要求：',
    '- questions 3–5 个，必须是投委会真正关心、且能由上述资料回答的问题；禁止「还需补充什么资料」式伪问题；',
    '- facts 4–6 条，优先使用 [资料N] 与 [F#]，其次 [E#]；',
    '- analysis 4–6 条，包含驱动因素、反证条件、竞争影响、待验证项；',
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
    maxTokens: 3200,
    timeoutMs: 240_000,
    temperature: 0.3,
  }).catch(() => null)

  const parsed = coerceModuleContent(raw, module)
  return parsed || fallbackModuleContent(module)
}

function coerceModuleContent(raw: unknown, module: DeepModuleContext): DeepModuleContent | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>

  const questions: DeepModuleContent['questions'] = []
  if (Array.isArray(data.questions)) {
    for (const item of data.questions) {
      if (questions.length >= 5) break
      if (!item || typeof item !== 'object') continue
      const q = item as Record<string, unknown>
      const question = asString(q.question, 120)
      const answer = asString(q.answer, 900)
      if (!question || !answer) continue
      const refs = asStringArray(q.refs, 6, 40)
      questions.push(refs.length > 0 ? { question, answer, refs } : { question, answer })
    }
  }

  const facts = asStringArray(data.facts, 6, 300)
  const analysis = asStringArray(data.analysis, 6, 300)
  const conclusion = asString(data.conclusion, 400)

  if (questions.length < 2 || facts.length === 0 || !conclusion) return null

  while (questions.length < 3) {
    questions.push({
      question: `如何验证${module.moduleName}的核心假设？`,
      answer: '现有资料不足以形成确定判断，需结合原始合同、台账与访谈记录逐项核验。',
    })
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
    questions,
    facts,
    analysis: analysis.length > 0 ? analysis : ['资料不足，暂无法形成有效分析。'],
    conclusion,
    metrics,
    limitations: asStringArray(data.limitations, 4, 200),
    dataLimited: false,
  }
}

export function fallbackModuleContent(module: DeepModuleContext): DeepModuleContent {
  const facts = module.facts.slice(0, 5)
  const factLines = facts.map(fact => {
    const value = fact.value ? `：${fact.value}${fact.unit || ''}` : ''
    return `[${fact.ref}] ${truncate(fact.fact, 100)}${value}`
  })

  const docLines = module.documents
    .filter(doc => doc.text)
    .slice(0, 3)
    .map((doc, index) => `[资料${index + 1}] ${doc.fileName}：${truncate(doc.text, 200)}`)

  const questions: DeepModuleContent['questions'] = []
  if (module.humanConclusion) {
    questions.push({
      question: `${module.coreQuestion}（人工结论）`,
      answer: truncate(module.humanConclusion, 600),
    })
  }
  if (facts[0]) {
    questions.push({
      question: `公开信息如何回答「${module.coreQuestion}」？`,
      answer: `公开信息显示：${truncate(facts[0].fact, 200)}${facts[0].value ? `（${facts[0].value}${facts[0].unit || ''}）` : ''} [${facts[0].ref}]。该结论仍需结合交易资料核验。`,
      refs: [facts[0].ref],
    })
  }
  if (module.documents[0]?.text) {
    questions.push({
      question: `${module.moduleName}的一手资料提供了哪些关键信息？`,
      answer: `[资料1] ${module.documents[0].fileName} 显示：${truncate(module.documents[0].text, 400)}`,
      refs: ['资料1'],
    })
  }
  questions.push({
    question: `本模块哪些假设仍待验证？`,
    answer: module.gaps.filter(gap => gap.status === 'OPEN').length > 0
      ? `待验证：${module.gaps.filter(gap => gap.status === 'OPEN').slice(0, 4).map(gap => gap.label).join('、')}。`
      : '公开信息与上传资料未发现明显缺口，但仍需在正式尽调中复核原始凭证。',
  })

  const analysis: string[] = []
  if (module.report?.opportunities?.[0]) analysis.push(`机会：${truncate(module.report.opportunities[0], 200)}`)
  if (module.report?.risks?.[0]) analysis.push(`风险：${truncate(module.report.risks[0], 200)}`)
  const openGap = module.gaps.find(gap => gap.status === 'OPEN')
  if (openGap) analysis.push(`待验证：${truncate(openGap.label, 200)}`)
  analysis.push(`投资含义：本模块信息覆盖度 ${Math.round(module.coverage * 100)}%，需结合交易资料复核后再纳入决策。`)
  analysis.push('验证路径：补充原始合同、台账、访谈记录与第三方证明，逐条核对关键假设。')

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
    questions: questions.slice(0, 5),
    facts: [...factLines, ...docLines].length > 0 ? [...factLines, ...docLines].slice(0, 6) : ['公开信息不足，未形成可引用事实。'],
    analysis: analysis.slice(0, 6),
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
    return `- ${module?.moduleName || content.moduleKey}：${truncate(content.conclusion, 200)}`
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
  "bullets": ["4–6条核心理由，每条≤120字，尽量带 [F#]/[E#]"],
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
    maxTokens: 3200,
    timeoutMs: 180_000,
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
