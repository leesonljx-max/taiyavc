/**
 * 项目解读执行引擎（固定分析框架模板，每个上传项目按此框架执行）
 *
 * 模板 v1 固化内容：
 * - 七维解读：市场地位 / 技术领先性 / 团队行业咖位 / 竞争分析 /
 *   创业窗口 / 业务进展与客户 logo 预估市场地位 / 10 条行业融资案例（联网检索）
 * - 问题清单：15-20 个必问问题（技术 ≥10），每题附行业与技术视角理想答案
 * - 访谈校验：逐题对比项目方回答与理想答案（差距分析）
 * - 综合结论：汇总校验结果生成分维度结论
 */

import { searchWebDual, type SearchResult } from '@/lib/tavily-search'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import {
  PI_RULES,
  isPIMatchLevel,
  isPIQuestionCategory,
  type InterpretationResult,
  type VerifyResult,
  type OverallConclusion,
  type FinancingCase,
} from './constants'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'

/** 文档文本参与分析的最大长度（token 控制） */
const MAX_DOC_TEXT = 24000

/** DeepSeek JSON 调用（90s 超时，json 修复解析） */
async function callDeepSeekJson<T>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4000
): Promise<{ parsed: T | null; usage?: unknown }> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${response.status} ${errText.substring(0, 150)}`)
    }
    const data = (await response.json()) as {
      usage?: unknown
      choices?: Array<{ message?: { content?: string } }>
    }
    recordTokenUsage('research', data.usage as Parameters<typeof recordTokenUsage>[1])
    const parsed = parseAgentJson<T>(data.choices?.[0]?.message?.content || '')
    return { parsed, usage: data.usage }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ═══════════ 固定模板：七维解读 ═══════════

const INTERPRET_SYSTEM_PROMPT = `你是一级市场资深投资人。基于项目文档（BP/资料），按固定框架输出结构化 JSON 解读。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "projectName": "文档中的项目名",
  "industry": "所处行业（如 AI应用/半导体芯片/商业航天）",
  "marketPosition": "市场地位分析（当前卡位、细分赛道位置，150字内）",
  "techLeadership": "技术领先性分析（技术路线、与头部对比、可验证性，150字内）",
  "teamStanding": "团队所在行业的咖位（创始人及核心成员的行业地位与背书，150字内）",
  "competitionAnalysis": "竞争分析（主要竞品、差异化、壁垒，150字内）",
  "startupWindow": "所处行业的创业窗口判断（窗口期长短、时间敏感性、风险，150字内）",
  "marketEstimate": "根据业务进展和客户 logo 情况预估市场地位（订单/POC/客户质量推断商业化验证程度，150字内）"
}
要求：结论克制、可核验，文档未提及的信息明确写"文档未披露"而非编造。`

const FINANCING_CASES_SYSTEM_PROMPT = `你是一级市场投资研究员。基于联网搜索结果，整理该行业近年的 10 条融资案例。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "cases": [
    {
      "company": "公司名",
      "round": "轮次（如 A轮/战略融资）",
      "amount": "金额（如 2亿元）",
      "date": "时间（如 2025-08）",
      "investors": "主要投资方",
      "brief": "一句话业务说明（30字内）"
    }
  ]
}
要求：只使用搜索结果中的真实信息，不得编造；不足 10 条时如实输出已有条数，每条附上来源链接放在 brief 末尾（格式：来源:URL）。`

/**
 * 执行"解读项目"：七维解读 + 联网检索行业融资案例
 * 返回完整 InterpretationResult 并由调用方落库
 */
export async function runInterpretation(input: {
  projectName: string
  documentText: string
}): Promise<InterpretationResult> {
  const docText = input.documentText.slice(0, MAX_DOC_TEXT)

  // 1. 七维解读（纯文档分析）
  const { parsed: base } = await callDeepSeekJson<Partial<InterpretationResult>>(
    INTERPRET_SYSTEM_PROMPT,
    `项目文档内容：\n\n${docText}\n\n请按固定框架输出 JSON 解读。`,
    3500
  )
  if (!base || !base.marketPosition || !base.industry) {
    throw new Error('AI 解读结果不完整，请重试')
  }

  // 2. 联网检索该行业融资案例（双源搜索）
  const industry = base.industry
  const searchResults: SearchResult[] = []
  try {
    const [r1, r2] = await Promise.all([
      searchWebDual(`${industry} 融资 轮次 2024 2025 投资`, { maxResults: 10 }),
      searchWebDual(`${industry} 创业公司 融资事件 投资`, { maxResults: 10 }),
    ])
    searchResults.push(...r1, ...r2)
  } catch {
    // 搜索失败不阻塞：融资案例置空并在 brief 说明
  }

  let financingCases: FinancingCase[] = []
  if (searchResults.length > 0) {
    // 去重（按 URL）
    const seen = new Set<string>()
    const unique = searchResults.filter(r => !seen.has(r.url) && seen.add(r.url))
    const searchDigest = unique
      .slice(0, 16)
      .map((r, i) => `[${i}] ${r.title}\n${r.content.slice(0, 300)}`)
      .join('\n\n')

    const { parsed: cases } = await callDeepSeekJson<{ cases?: FinancingCase[] }>(
      FINANCING_CASES_SYSTEM_PROMPT,
      `行业：${industry}\n\n搜索结果：\n\n${searchDigest}\n\n请整理该行业 10 条融资案例 JSON。`,
      3500
    )
    if (Array.isArray(cases?.cases)) {
      financingCases = cases!.cases!
        .filter(c => c && typeof c.company === 'string' && c.company.trim())
        .slice(0, 10)
    }
  }

  return {
    projectName: base.projectName?.trim() || input.projectName,
    industry,
    marketPosition: base.marketPosition || '',
    techLeadership: base.techLeadership || '',
    teamStanding: base.teamStanding || '',
    competitionAnalysis: base.competitionAnalysis || '',
    startupWindow: base.startupWindow || '',
    marketEstimate: base.marketEstimate || '',
    financingCases,
  }
}

// ═══════════ 固定模板：问题清单 ═══════════

const QUESTIONS_SYSTEM_PROMPT = `你是一级市场资深投资人，站在投资调研角度设计项目访谈必问问题清单。
基于项目文档（如有解读结果会一并提供），输出 15-20 个必须提问的问题，其中技术类问题至少 10 个。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "questions": [
    {
      "category": "TECH",
      "question": "问题（站在投资人角度必须问、能验证真伪的问题）",
      "idealAnswer": "站在行业和技术角度，这个问题理想情况下项目方应该给出的回答（80字内）"
    }
  ]
}
分类只能取：TECH（技术：架构/路线/壁垒/性能/量产/专利/数据）、MARKET（市场：空间/客户/需求）、TEAM（团队）、BUSINESS（业务：订单/商业化/复购）、FINANCE（财务）。
要求：
- 技术问题（category=TECH）至少 10 个，聚焦可验证的技术细节（如具体性能指标、工艺良率、第三方验证）
- 每个问题的 idealAnswer 必须具体、可判断（好的理想答案应包含量化指标或可核验事实）
- 问题不得空泛（避免"你们的优势是什么"这类问题）`

/** 校验 AI 生成的问题清单是否符合固定规则 */
export function validateQuestions(
  questions: Array<{ category?: string; question?: string; idealAnswer?: string }>
): { valid: boolean; error?: string; cleaned: Array<{ category: string; question: string; idealAnswer: string }> } {
  const cleaned = questions
    .filter(q => q && typeof q.question === 'string' && q.question.trim() && typeof q.idealAnswer === 'string' && q.idealAnswer.trim())
    .map(q => ({
      category: isPIQuestionCategory(String(q.category)) ? String(q.category) : 'TECH',
      question: q.question!.trim(),
      idealAnswer: q.idealAnswer!.trim(),
    }))

  if (cleaned.length < PI_RULES.minQuestions) {
    return { valid: false, error: `问题数量不足：需 ${PI_RULES.minQuestions}-${PI_RULES.maxQuestions} 个，仅生成 ${cleaned.length} 个`, cleaned }
  }
  if (cleaned.length > PI_RULES.maxQuestions) {
    return { valid: true, cleaned: cleaned.slice(0, PI_RULES.maxQuestions) } // 超出截断到上限
  }
  const techCount = cleaned.filter(q => q.category === 'TECH').length
  if (techCount < PI_RULES.minTechQuestions) {
    return { valid: false, error: `技术问题不足：需至少 ${PI_RULES.minTechQuestions} 个，仅 ${techCount} 个`, cleaned }
  }
  return { valid: true, cleaned }
}

/**
 * 执行"生成问题清单"：15-20 问（技术 ≥10）+ 每题理想答案
 * 与"解读项目"无逻辑承接：interpretation 可选（有则作为补充上下文，无则直接基于文档）
 */
export async function runQuestionGeneration(input: {
  projectName: string
  documentText: string
  interpretation?: InterpretationResult | null
}): Promise<Array<{ category: string; question: string; idealAnswer: string }>> {
  const docText = input.documentText.slice(0, MAX_DOC_TEXT)
  const digestParts: string[] = []
  if (input.interpretation) {
    digestParts.push(
      `行业：${input.interpretation.industry}`,
      `市场地位：${input.interpretation.marketPosition}`,
      `技术领先性：${input.interpretation.techLeadership}`,
      `团队咖位：${input.interpretation.teamStanding}`,
      `竞争分析：${input.interpretation.competitionAnalysis}`
    )
  }
  const digest = digestParts.length > 0 ? digestParts.join('\n') + '\n\n' : ''

  const { parsed } = await callDeepSeekJson<{ questions?: Array<{ category?: string; question?: string; idealAnswer?: string }> }>(
    QUESTIONS_SYSTEM_PROMPT,
    `项目：${input.projectName}\n${digest}项目文档内容：\n\n${docText}\n\n请输出访谈问题清单 JSON。`,
    6000
  )

  const raw = Array.isArray(parsed?.questions) ? parsed!.questions : []
  const { valid, error, cleaned } = validateQuestions(raw)
  if (!valid) {
    throw new Error(error || '问题清单生成不符合固定框架规则')
  }
  return cleaned
}

// ═══════════ 固定模板：批量访谈校验（一次上传，全量校验） ═══════════

const BATCH_VERIFY_SYSTEM_PROMPT = `你是一级市场投资人。给定：完整的问题清单（每题附行业与技术视角的理想答案）和一份项目访谈纪要。
请对每个问题做闭环校验：在访谈纪要中找到项目方对该问题的回答，与理想答案对比。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "results": [
    {
      "index": 1,
      "matchLevel": "HIGH 或 PARTIAL 或 GAP 或 UNCOVERED",
      "answerSummary": "项目方回答要点（60字内；UNCOVERED 时为空）",
      "gapAnalysis": "回答与理想答案的差距分析（具体指出缺失/回避/矛盾之处，120字内；UNCOVERED 时写'访谈纪要未涉及该问题'）",
      "conclusion": "该问题的校验结论（如：对方对技术壁垒的表述与理想答案差距较大，其技术壁垒存疑，80字内）"
    }
  ]
}
matchLevel 判定标准：
- HIGH：回答覆盖理想答案核心要点，有量化/可核验支撑
- PARTIAL：回答部分覆盖，关键细节缺失或含糊
- GAP：回答回避、空洞或与理想答案明显矛盾
- UNCOVERED：访谈纪要中完全没有涉及该问题
要求：
- results 数组必须覆盖全部问题，index 与输入问题编号一一对应
- 基于事实对比，不做臆测；纪要中明确回避（如"不方便透露"）判 GAP 而非 UNCOVERED`

/**
 * 批量访谈校验：一次上传访谈纪要 → 单次 AI 调用校验全部问题
 * 返回与输入问题等长、按序对应的校验结果数组
 */
export async function runBatchVerification(input: {
  questions: Array<{ order: number; question: string; idealAnswer: string }>
  interviewText: string
}): Promise<VerifyResult[]> {
  const questionList = input.questions
    .map(q => `[${q.order}] 问题：${q.question}\n理想答案：${q.idealAnswer}`)
    .join('\n\n')

  const { parsed } = await callDeepSeekJson<{ results?: Array<{
    index?: number
    matchLevel?: string
    answerSummary?: string
    gapAnalysis?: string
    conclusion?: string
  }> }>(
    BATCH_VERIFY_SYSTEM_PROMPT,
    `访谈问题清单（共 ${input.questions.length} 题）：\n\n${questionList}\n\n项目访谈纪要：\n${input.interviewText.slice(0, 12000)}\n\n请输出全部问题的校验结果 JSON。`,
    8000
  )

  if (!Array.isArray(parsed?.results) || parsed!.results!.length === 0) {
    throw new Error('批量校验结果为空，请重试')
  }

  // 按 index 对齐；缺失/非法的题按 UNCOVERED 兜底
  const byIndex = new Map<number, VerifyResult>()
  for (const r of parsed!.results!) {
    const idx = typeof r.index === 'number' ? r.index : NaN
    if (!isPIMatchLevel(String(r.matchLevel)) || !r.conclusion || isNaN(idx)) continue
    byIndex.set(idx, {
      matchLevel: r.matchLevel as VerifyResult['matchLevel'],
      answerSummary: r.answerSummary || '',
      gapAnalysis: r.gapAnalysis || '',
      conclusion: r.conclusion,
    })
  }

  return input.questions.map(q => {
    const hit = byIndex.get(q.order)
    if (hit) return hit
    return {
      matchLevel: 'UNCOVERED' as const,
      answerSummary: '',
      gapAnalysis: '访谈纪要未涉及该问题',
      conclusion: '访谈未覆盖此问题，建议下次访谈补充提问',
    }
  })
}

// ═══════════ 固定模板：综合结论 ═══════════

const CONCLUSION_SYSTEM_PROMPT = `你是一级市场资深投资人。基于多轮访谈校验结果，输出项目综合分析结论。
严格输出 JSON（不要 markdown 代码块）：
{
  "summary": "总体判断（回答质量整体评价，120字内）",
  "dimensions": [
    {
      "aspect": "维度（如 技术壁垒/市场地位/团队实力/商业化/财务）",
      "gapLevel": "HIGH 或 PARTIAL 或 GAP",
      "conclusion": "该维度结论（如：技术壁垒方面回答与理想答案差距较大，结论是其技术壁垒不高，100字内）"
    }
  ],
  "advice": "给投资的下一步建议（80字内）"
}
要求：dimensions 按差距从大到小排序；结论必须由校验结果支撑，不得引入未提及的信息。`

/**
 * 生成综合结论：汇总已校验问题的差距分析
 */
export async function runConclusion(input: {
  projectName: string
  verified: Array<{ question: string; category: string; idealAnswer: string; verifyResult: VerifyResult }>
}): Promise<OverallConclusion> {
  const digest = input.verified
    .map(
      (v, i) =>
        `[${i + 1}] 分类:${v.category} 问题:${v.question}\n理想答案:${v.idealAnswer}\n校验结果:${v.verifyResult.matchLevel} | ${v.verifyResult.gapAnalysis} | 结论:${v.verifyResult.conclusion}`
    )
    .join('\n\n')

  const { parsed } = await callDeepSeekJson<OverallConclusion>(
    CONCLUSION_SYSTEM_PROMPT,
    `项目：${input.projectName}\n\n各问题访谈校验结果：\n\n${digest}\n\n请输出综合结论 JSON。`,
    2500
  )
  if (!parsed || !parsed.summary || !Array.isArray(parsed.dimensions)) {
    throw new Error('综合结论生成不完整，请重试')
  }
  return {
    summary: parsed.summary,
    dimensions: parsed.dimensions.filter(d => d && d.aspect && d.conclusion),
    advice: parsed.advice || '',
  }
}
