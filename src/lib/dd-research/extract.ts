/**
 * 单模块事实抽取
 *
 * 约束：无来源、无原文摘录的「事实」直接丢弃；
 * 同一指标出现 >20% 差异时标记冲突，报告只陈述冲突而不取平均。
 */

import { callDeepSeekJson } from './llm'
import { DD_REQUIREMENTS } from './constants'
import type { ResearchSourceDraft } from './search'

export interface ExtractedFact {
  moduleKey: string
  fact: string
  value?: string
  unit?: string
  period?: string
  quote: string
  sourceIdx: number
  confidence: number
  importance: 'CORE' | 'NORMAL'
  grade: 'A' | 'B' | 'C' | 'D'
  status: 'PENDING' | 'CONFLICT'
}

export interface FactConflict {
  metric: string
  values: string[]
  sourceIdxs: number[]
  reason: string
}

export interface ExtractionResult {
  facts: ExtractedFact[]
  conflicts: FactConflict[]
  error?: string
}

interface RawFact {
  fact?: unknown
  value?: unknown
  unit?: unknown
  period?: unknown
  quote?: unknown
  sourceIdx?: unknown
  confidence?: unknown
  importance?: unknown
  scope?: unknown
}

export interface ResearchSubject {
  name: string
  fullName?: string | null
}

interface RawPayload {
  facts?: RawFact[]
  conflicts?: Array<{
    metric?: unknown
    values?: unknown
    sourceIdxs?: unknown
    reason?: unknown
  }>
}

const SYSTEM_PROMPT = [
  '你是风险投资机构的尽调研究员。你的任务是从公开来源中抽取「可核验事实」，而不是写分析或推测。',
  '硬性规则：',
  '1. 每条事实必须能在来源原文中找到依据，quote 必须是来源中的原句或紧邻原句的连续片段，不得改写。',
  '2. 不得使用你自身的知识补充来源中没有的信息；找不到就返回空数组。',
  '3. 数字、金额、比例、日期必须保留原始口径；value 只填数值（如 3.5），unit 填单位（如 亿元、%、家），period 填期间（如 2024、2024Q3）。',
  '4. 与模块核心问题直接相关、能改变投资判断的事实标记 importance=CORE；背景信息标记 NORMAL。',
  '5. confidence 表示该事实在来源中的明确程度：官方原文 0.9，媒体明确报道 0.7，模糊表述 0.4。',
  '6. 同一指标不同来源差异超过 20% 时，不要选择其中一个，写入 conflicts。',
  '只输出 JSON，不要输出 Markdown 或解释。',
].join('\n')

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

function text(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+/g, ' ').trim().slice(0, max)
}

function numeric(v: string | undefined): number | null {
  if (!v) return null
  const cleaned = v.replace(/,/g, '').replace(/%$/, '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function buildSourcesBlock(sources: ResearchSourceDraft[]): string {
  const maxEach = 7000
  const maxTotal = 60_000
  let used = 0
  const blocks: string[] = []
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]
    const content = s.content.slice(0, Math.min(maxEach, maxTotal - used))
    if (!content) break
    blocks.push(`[${i}] 标题：${s.title}\nURL：${s.url}\n来源等级：${s.grade}\n正文：${content}`)
    used += content.length
    if (used >= maxTotal) break
  }
  return blocks.join('\n\n---\n\n')
}

/** 去空白与大小写，用于校验摘录是否真的来自来源正文 */
function normalizeForMatch(s: string): string {
  return s.replace(/[\s\u3000“”"'‘’]/g, '').toLowerCase()
}

/** 目标主体别名；来源未提及时只能作为行业背景，避免把其他公司数据写成项目事实 */
function subjectAliases(subject?: ResearchSubject): string[] {
  if (!subject) return []
  return [subject.fullName, subject.name]
    .map(v => (v || '').trim())
    .filter(v => v.length >= 2)
    .filter((v, i, arr) => arr.indexOf(v) === i)
}

function sourceMentionsSubject(content: string, aliases: string[]): boolean {
  if (aliases.length === 0) return true
  const normalized = normalizeForMatch(content)
  return aliases.some(alias => normalized.includes(normalizeForMatch(alias)))
}

/** 模型摘录找不到时，从原文定位一句含关键数字/关键词的句子，避免证据失真 */
function locateEvidence(sourceContent: string, quote: string, fact: string): { quote: string; verified: boolean } {
  const content = sourceContent.replace(/\r/g, '')
  if (normalizeForMatch(content).includes(normalizeForMatch(quote))) {
    return { quote, verified: true }
  }
  const sentences = content
    .split(/(?<=[。！？；\n])/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 12)
  const numbers = `${fact} ${quote}`.match(/\d+(?:\.\d+)?%?/g) || []
  const keyword = fact.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 12)
  const hit = sentences.find(s => numbers.some(n => s.includes(n)))
    || sentences.find(s => keyword.length >= 4 && s.includes(keyword.slice(0, 4)))
    || sentences.find(s => s.length >= 30)
  if (hit) return { quote: hit.slice(0, 400), verified: false }
  return { quote, verified: false }
}

function parseFacts(
  payload: RawPayload | null,
  moduleKey: string,
  sources: ResearchSourceDraft[],
  subject?: ResearchSubject
): { facts: ExtractedFact[]; conflicts: FactConflict[] } {
  const facts: ExtractedFact[] = []
  const conflicts: FactConflict[] = []
  const seen = new Set<string>()
  const aliases = subjectAliases(subject)

  for (const raw of payload?.facts || []) {
    const fact = text(raw.fact, 220)
    const quote = text(raw.quote, 400)
    const sourceIdx = Number(raw.sourceIdx)
    if (!fact || quote.length < 6) continue
    if (!Number.isInteger(sourceIdx) || sourceIdx < 0 || sourceIdx >= sources.length) continue

    const source = sources[sourceIdx]
    const value = text(raw.value, 60) || undefined
    const unit = text(raw.unit, 20) || undefined
    const period = text(raw.period, 30) || undefined
    const key = `${fact}|${value || ''}|${period || ''}`
    if (seen.has(key)) continue
    seen.add(key)

    const evidence = locateEvidence(source.content, quote, fact)
    const confidence = clamp(Number(raw.confidence), 0.05, 0.99)
    let importance: 'CORE' | 'NORMAL' = raw.importance === 'CORE' ? 'CORE' : 'NORMAL'
    let finalFact = fact

    if (subject) {
      const scope = raw.scope === 'INDUSTRY' ? 'INDUSTRY' : 'COMPANY'
      const companySpecific = scope === 'COMPANY' && sourceMentionsSubject(source.content, aliases)
      if (!companySpecific) {
        // 来源未提及目标主体（或是行业泛述）：降级为行业背景，不得写成公司事实
        finalFact = fact.startsWith('行业背景') ? fact : `行业背景：${fact}`
        importance = 'NORMAL'
      }
    }

    facts.push({
      moduleKey,
      fact: finalFact,
      value,
      unit,
      period,
      quote: evidence.quote,
      sourceIdx,
      confidence: evidence.verified ? confidence : Math.min(confidence, 0.5),
      importance,
      grade: source.grade,
      status: 'PENDING',
    })
  }

  for (const c of payload?.conflicts || []) {
    const metric = text(c.metric, 80)
    const reason = text(c.reason, 160)
    if (!metric) continue
    const values = Array.isArray(c.values)
      ? c.values.map(v => text(v, 60)).filter(Boolean).slice(0, 4)
      : []
    const sourceIdxs = Array.isArray(c.sourceIdxs)
      ? c.sourceIdxs.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < sources.length)
      : []
    if (values.length < 2) continue
    conflicts.push({ metric, values, sourceIdxs, reason: reason || '不同来源口径存在差异' })
  }

  // 启发式数值冲突：同一指标措辞 + 同期间/单位，最大最小差异 >20%
  const groups = new Map<string, ExtractedFact[]>()
  for (const fact of facts) {
    const n = numeric(fact.value)
    if (n === null) continue
    const metricKey = fact.fact.replace(/[\s（）()]/g, '').slice(0, 16)
    const key = `${metricKey}|${fact.period || ''}|${fact.unit || ''}`
    const arr = groups.get(key) || []
    arr.push(fact)
    groups.set(key, arr)
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const nums = group.map(f => numeric(f.value) as number)
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    if (min <= 0 || max / min <= 1.2) continue
    const metric = group[0].fact.slice(0, 60)
    if (conflicts.some(c => c.metric === metric)) continue
    conflicts.push({
      metric,
      values: group.map(f => `${f.value}${f.unit || ''}${f.period ? `（${f.period}）` : ''}`),
      sourceIdxs: [...new Set(group.map(f => f.sourceIdx))],
      reason: `同一指标差异超过 20%（${key.split('|')[1] || '期间未标注'}）`,
    })
    for (const f of group) f.status = 'CONFLICT'
  }

  // 模型显式冲突：把描述命中的事实标记为 CONFLICT
  for (const c of conflicts) {
    const key = c.metric.slice(0, 8)
    for (const f of facts) {
      if (f.fact.includes(key)) f.status = 'CONFLICT'
    }
  }

  return { facts: facts.slice(0, 24), conflicts: conflicts.slice(0, 8) }
}

export async function extractModuleFacts(
  moduleKey: string,
  moduleName: string,
  coreQuestion: string,
  sources: ResearchSourceDraft[],
  subject?: ResearchSubject
): Promise<ExtractionResult> {
  if (sources.length === 0) {
    return { facts: [], conflicts: [], error: '无可用来源' }
  }

  const requirements = DD_REQUIREMENTS.filter(r => r.moduleKey === moduleKey)
  const requirementBlock = requirements.length > 0
    ? requirements.map(r => `- ${r.label}（关键词：${r.keywords.join('、')}）`).join('\n')
    : '- 无'

  const subjectBlock = subject
    ? [
        `目标公司：${subject.name}${subject.fullName && subject.fullName !== subject.name ? `（全称：${subject.fullName}）` : ''}`,
        '主体校验（最高优先级）：只有来源明确指向目标公司的内容才能写成公司事实（scope=COMPANY）；',
        '其他公司、同名主体或行业泛述只能写成行业背景（scope=INDUSTRY），fact 以「行业背景：」开头；',
        '不得把其他公司的收入、订单、客户、专利、融资等数据写成目标公司事实；无法确认主体的内容不要输出。',
        '',
      ].join('\n')
    : ''

  const userPrompt = [
    `模块：${moduleName}（${moduleKey}）`,
    `投委会核心问题：${coreQuestion}`,
    subjectBlock,
    `来源数量：${sources.length}`,
    '',
    '本模块必须尽量覆盖的证据项：',
    requirementBlock,
    '',
    '来源列表：',
    buildSourcesBlock(sources),
    '',
    '请抽取 8–18 条与本模块核心问题最相关的事实（来源足够多时尽量接近 18 条），优先覆盖上述证据项；并输出 JSON：',
    '{"facts":[{"fact":"事实描述","value":"数值或空","unit":"单位或空","period":"期间或空","quote":"来源原文摘录","sourceIdx":0,"confidence":0.8,"importance":"CORE","scope":"COMPANY"}],"conflicts":[{"metric":"指标","values":["值1","值2"],"sourceIdxs":[0,1],"reason":"差异原因"}]}',
  ].filter(Boolean).join('\n')

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = await callDeepSeekJson<RawPayload>({
        system: SYSTEM_PROMPT,
        user: userPrompt,
        module: 'dd-research',
        maxTokens: 6000,
        timeoutMs: 120_000,
        temperature: 0.2,
      })
      if (!payload || !Array.isArray(payload.facts)) {
        lastError = '模型输出无法解析'
        continue
      }
      const parsed = parseFacts(payload, moduleKey, sources, subject)
      return parsed
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return { facts: [], conflicts: [], error: lastError || '事实抽取失败' }
}
