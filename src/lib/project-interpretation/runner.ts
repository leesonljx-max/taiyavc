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
import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'
import { buildUserSkillPromptBlock, listActiveDynamicSkills } from '@/lib/skill-registry'
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
  "marketEstimate": "根据业务进展和客户 logo 情况预估市场地位（订单/POC/客户质量推断商业化验证程度，150字内）",
  "skillModules": [
    { "skillName": "用户技能名（原样保留）", "title": "该技能视角的分析标题（如：全球行业发展动态与赛道映射）", "content": "该技能分析框架下的独立分析（分点+加粗，250字内）" }
  ]
}
排版要求（所有分析文本字段统一执行）：内容分点展示——按 1. 2. 3. 编号（或 - 分条）每点独立一行，不要输出一整段文字；每点的重点内容（关键数据/核心结论/重大风险）用 **加粗** 标注。
skillModules 字段说明：仅当挂载的用户技能分析视角超出上述七维框架（独立领域）时，为该技能输出一项（skillName 原样保留技能名）；与某一维相似的技能应融入对应维度的分析内容；未挂载技能时输出空数组 []。
要求：结论克制、可核验，文档未提及的信息明确写"文档未披露"而非编造。`

const CASE_QUERY_SYSTEM_PROMPT = `你是一级市场投资研究员。基于项目画像生成 4 组联网搜索关键词，用于检索与该项目重合度高的融资案例（国内外）。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "queries": [
    { "text": "中文关键词组（核心技术/产品方向 + 融资）", "lang": "zh" },
    { "text": "中文关键词组（细分赛道 + 创业公司 + 投资轮次）", "lang": "zh" },
    { "text": "English keywords (core technology/product + startup funding)", "lang": "en" },
    { "text": "English keywords (niche segment + venture round)", "lang": "en" }
  ]
}
要求：
- 关键词必须来自该项目的具体定位、产品形态、核心技术、细分赛道（不要只用大行业名泛搜）
- 中英文各 2 组；英文组用于检索国外对标公司的融资案例
- 每组 3-6 个词，精准可搜`

const FINANCING_CASES_SYSTEM_PROMPT = `你是一级市场投资研究员。基于项目画像与联网搜索结果，整理与该项目重合度较高的融资案例（国内外均可，目标 10 条）。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "cases": [
    {
      "company": "公司名",
      "round": "轮次（如 A轮/战略融资/Series A）",
      "amount": "金额（如 2亿元/$50M）",
      "date": "时间（如 2025-08）",
      "investors": "主要投资方",
      "brief": "一句话业务说明（30字内）",
      "relevance": "与该项目的重合点（产品方向/技术路线/目标市场的具体重合说明，40字内，如：同为硅光计算路线，均瞄准云厂商AI算力场景）"
    }
  ]
}
要求：
- 只使用搜索结果中的真实信息，不得编造；不足 10 条时如实输出已有条数，每条附上来源链接放在 brief 末尾（格式：来源:URL）
- 优先选取与项目定位、产品、技术重合度高的案例，国内外案例都要覆盖（英文来源的公司保留英文公司名）
- relevance 必须写具体的重合维度；与项目几乎不重合的案例宁可不选`

/**
 * 执行"解读项目"：七维解读 + 联网检索行业融资案例
 * 返回完整 InterpretationResult 并由调用方落库
 * userId（P3.6）：传入时注入本人 CONFIRMED 技能，分析框架冲突时以用户技能为准；未传/无技能走固定框架
 */
export async function runInterpretation(input: {
  projectName: string
  documentText: string
  userId?: string
}): Promise<InterpretationResult> {
  const docText = input.documentText.slice(0, MAX_DOC_TEXT)

  // 0. 用户技能块（本人 CONFIRMED 技能；无技能时为空串，完全走固定框架）
  const skillBlock = await buildUserSkillPromptBlock(input.userId).catch(() => '')
  // 应用技能名（可见性：随结果落库，前端展示「本次解读已应用技能」）
  const appliedSkills = skillBlock
    ? (await listActiveDynamicSkills(input.userId).catch(() => [])).map(s => s.name)
    : []

  // 1. 七维解读（纯文档分析；用户技能框架优先于固定框架）
  const { parsed: base } = await callDeepSeekJson<Partial<InterpretationResult>>(
    INTERPRET_SYSTEM_PROMPT + skillBlock,
    `项目文档内容：\n\n${docText}\n\n请按固定框架输出 JSON 解读。`,
    3500
  )
  if (!base || !base.marketPosition || !base.industry) {
    throw new Error('AI 解读结果不完整，请重试')
  }

  // 2. 智能检索融资案例：模型基于项目定位/产品/技术生成中英文精准查询 → 双源并发搜索
  //   （与行业动态同源的搜索引擎架构；英文组覆盖国外对标公司）
  const industry = base.industry
  const searchResults: SearchResult[] = []
  try {
    // 2a. 模型生成精准搜索关键词（项目画像驱动，而非仅行业名）
    const { parsed: q } = await callDeepSeekJson<{ queries?: Array<{ text?: string; lang?: string }> }>(
      CASE_QUERY_SYSTEM_PROMPT,
      `项目画像：\n行业：${industry}\n市场地位：${base.marketPosition || '未披露'}\n技术领先性：${base.techLeadership || '未披露'}\n竞争分析：${base.competitionAnalysis || '未披露'}\n\n请输出搜索关键词 JSON。`,
      500
    )
    const modelQueries = (Array.isArray(q?.queries) ? q!.queries! : [])
      .map(x => (typeof x?.text === 'string' ? x.text.trim() : ''))
      .filter(t => t.length > 1)
      .slice(0, 4)
    // 关键词生成失败时兜底：行业名泛搜
    const finalQueries = modelQueries.length > 0
      ? modelQueries
      : [`${industry} 融资 轮次 投资`, `${industry} 创业公司 融资事件`]

    // 2b. 并发双源搜索（collect 模式控成本；单组失败不影响其他组）
    const results = await Promise.all(
      finalQueries.map(text =>
        searchWebDual(text, { maxResults: 5, mode: 'collect', module: 'project-interpretation' })
          .catch(() => [] as SearchResult[])
      )
    )
    searchResults.push(...results.flat())
  } catch {
    // 搜索失败不阻塞：融资案例置空
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
      `项目画像：\n行业：${industry}\n技术领先性：${base.techLeadership || '未披露'}\n竞争分析：${base.competitionAnalysis || '未披露'}\n\n搜索结果：\n\n${searchDigest}\n\n请整理与该项目重合度高的融资案例 JSON（国内外，含 relevance 重合说明）。`,
      3500
    )
    if (Array.isArray(cases?.cases)) {
      financingCases = cases!.cases!
        .filter(c => c && typeof c.company === 'string' && c.company.trim())
        .slice(0, 10)
    }
  }

  // 技能独立模块清洗（无技能/已融入时为空数组；最多 5 项，字段截断防溢出）
  const skillModules = (Array.isArray(base.skillModules) ? base.skillModules : [])
    .filter(
      m =>
        m &&
        typeof m.skillName === 'string' &&
        m.skillName.trim() &&
        typeof m.content === 'string' &&
        m.content.trim()
    )
    .slice(0, 5)
    .map(m => ({
      skillName: m.skillName!.trim().slice(0, 50),
      title: (typeof m.title === 'string' ? m.title : '').trim().slice(0, 60),
      content: m.content!.trim().slice(0, 2000),
    }))

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
    appliedSkills,
    skillModules,
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
      "idealAnswer": "站在行业和技术角度，这个问题理想情况下项目方应该给出的回答（80字内）",
      "isSectorInsight": false,
      "claimFlag": false
    }
  ]
}
分类只能取：TECH（技术：架构/路线/壁垒/性能/量产/专利/数据）、MARKET（市场：空间/客户/需求）、TEAM（团队）、BUSINESS（业务：订单/商业化/复购）、FINANCE（财务）。
要求：
- 技术问题（category=TECH）至少 10 个，聚焦可验证的技术细节（如具体性能指标、工艺良率、第三方验证）
- 每个问题的 idealAnswer 必须具体、可判断（好的理想答案应包含量化指标或可核验事实）
- 排版：idealAnswer 内容分点展示（每点独立一行，必要时分点），重点内容（量化指标/可核验事实）用 **加粗** 标注
- 问题不得空泛（避免"你们的优势是什么"这类问题）
- isSectorInsight 仅在题目来源赛道沉淀时为 true，其余一律 false
- claimFlag 仅在题目针对"外部校验发现夸大/矛盾的声明"生成追问时为 true，其余一律 false`

/** 校验 AI 生成的问题清单是否符合固定规则 */
export function validateQuestions(
  questions: Array<{ category?: string; question?: string; idealAnswer?: string; isSectorInsight?: boolean; claimFlag?: boolean }>
): { valid: boolean; error?: string; cleaned: Array<{ category: string; question: string; idealAnswer: string; isSectorInsight: boolean; claimFlag: boolean }> } {
  const cleaned = questions
    .filter(q => q && typeof q.question === 'string' && q.question.trim() && typeof q.idealAnswer === 'string' && q.idealAnswer.trim())
    .map(q => ({
      category: isPIQuestionCategory(String(q.category)) ? String(q.category) : 'TECH',
      question: q.question!.trim(),
      idealAnswer: q.idealAnswer!.trim(),
      isSectorInsight: q.isSectorInsight === true,
      claimFlag: q.claimFlag === true,
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
 * sectorInsights：同赛道历史沉淀的高质量问题（含历史结论）。提供时 AI 会结合新项目情况
 * 生成对应的二次校验问题（isSectorInsight=true），作为该赛道的重要关注问题
 * claimFindings：外部校验（ClaimVerifier）发现夸大/矛盾的 BP 声明。提供时 AI 会生成
 * 针对性尖锐追问（claimFlag=true，排清单最前部），访谈时优先质询
 */
export async function runQuestionGeneration(input: {
  projectName: string
  documentText: string
  interpretation?: InterpretationResult | null
  sectorInsights?: Array<{ question: string; idealAnswer: string; conclusion: string }>
  claimFindings?: Array<{ claim: string; verdict: string; note: string }>
  /** P3.6：传入时注入本人 CONFIRMED 技能（问题视角受技能框架影响），并返回应用技能名 */
  userId?: string
}): Promise<{
  questions: Array<{ category: string; question: string; idealAnswer: string; isSectorInsight: boolean; claimFlag: boolean }>
  appliedSkills: string[]
}> {
  const docText = input.documentText.slice(0, MAX_DOC_TEXT)

  // 用户技能块（本人 CONFIRMED 技能；无技能时为空串）+ 应用技能名（可见性）
  const skillBlock = await buildUserSkillPromptBlock(input.userId).catch(() => '')
  const appliedSkills = skillBlock
    ? (await listActiveDynamicSkills(input.userId).catch(() => [])).map(s => s.name)
    : []

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

  // 赛道沉淀：同赛道历史高质量问题 + 历史结论（重要关注问题，结合新项目生成二次校验变体）
  let insightDigest = ''
  if (input.sectorInsights && input.sectorInsights.length > 0) {
    const list = input.sectorInsights
      .slice(0, 12)
      .map((s, i) => `[${i + 1}] 历史高质量问题：${s.question}\n理想答案：${s.idealAnswer}\n历史项目校验结论：${s.conclusion}`)
      .join('\n\n')
    insightDigest =
      `\n\n【同赛道历史沉淀的高质量问题（来自历史项目访谈验证，是该赛道的重要关注问题）】\n${list}\n` +
      `要求：结合新项目的具体情况，把上述历史问题改写为适合本项目的二次校验问题（保留核心验证点，结合新项目的产品/技术/阶段调整表述），` +
      `这些改写后的问题标记 isSectorInsight=true，优先排在清单前部（最多纳入 ${Math.min(input.sectorInsights.length, 12)} 个）；` +
      `其余问题正常生成（isSectorInsight=false）。历史结论仅作关注点参考，不得照抄进理想答案。\n`
  }

  // 外部校验发现的问题声明（夸大/矛盾）：生成针对性尖锐追问，排清单最前部
  let claimDigest = ''
  if (input.claimFindings && input.claimFindings.length > 0) {
    const list = input.claimFindings
      .slice(0, 5)
      .map((c, i) => `[${i + 1}] 声明：${c.claim}\n核验结果：${c.verdict === 'EXAGGERATED' ? '⚠️ 夸大' : '❌ 矛盾'}（${c.note}）`)
      .join('\n\n')
    claimDigest =
      `\n\n【外部校验（联网交叉核验）发现问题的 BP 声明——访谈时必须优先质询】\n${list}\n` +
      `要求：针对每条声明生成 1-2 个尖锐的追问问题（引用具体数据当面质询，如"BP 中称良率 95%，但行业公开数据为 85%，请解释差异来源"），` +
      `这些追问标记 claimFlag=true，排在清单最前部（先于赛道沉淀问题）；idealAnswer 写项目方应给出的合理解释标准。\n`
  }

  const { parsed } = await callDeepSeekJson<{ questions?: Array<{ category?: string; question?: string; idealAnswer?: string; isSectorInsight?: boolean; claimFlag?: boolean }> }>(
    QUESTIONS_SYSTEM_PROMPT + skillBlock,
    `项目：${input.projectName}\n${digest}${claimDigest}${insightDigest}\n项目文档内容：\n\n${docText}\n\n请输出访谈问题清单 JSON。`,
    6000
  )

  const raw = Array.isArray(parsed?.questions) ? parsed!.questions : []
  const { valid, error, cleaned } = validateQuestions(raw)
  if (!valid) {
    throw new Error(error || '问题清单生成不符合固定框架规则')
  }
  return { questions: cleaned, appliedSkills }
}

// ═══════════ 固定模板：闭环创建项目库草稿 ═══════════

const PROJECT_DRAFT_SYSTEM_PROMPT = `你是一级市场投资经理。基于项目解读的全量材料（BP 文档原文、七维解读、访谈纪要、访谈校验综合结论），按项目库创建模板尽可能完整地提取项目关键信息。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "name": "项目简称（与 BP 中项目名一致，2-20字）",
  "companyFullName": "公司全称（BP 中有则提取，无则空字符串）",
  "industry": "所处行业（AI应用/AI硬件/AI基础设施/具身智能/商业航天/量子计算/脑机接口/可控核聚变/半导体设备/半导体芯片/光学/新材料/其他）",
  "companyPosition": "公司定位一句话（30字内）",
  "mainProducts": "主要产品：从 BP 原文中定位产品/服务相关页面与段落，截取原文关键表述与量化指标（200字内）",
  "coreAdvantage": "核心优势：从 BP 原文中定位技术壁垒/差异化/里程碑相关段落，截取原文关键表述（200字内）",
  "coreTeam": "核心团队：BP 中提到的核心团队成员必须全部列出；并总结访谈纪要中关于团队的补充信息（认识方式、创业契机等）（500字内）",
  "description": "项目描述：综合 BP、访谈纪要与解读结论的项目综述（200字内）",
  "financingRound": "本轮融资轮次（如 天使轮/A轮/Pre-A轮；未披露则空字符串）",
  "totalAmount": "本轮融资金额（如 8000万/2亿；未披露则'待补充'）",
  "investmentValuation": 投资估值（亿元，数字；未披露则 null）
}
排版要求（mainProducts / coreAdvantage / coreTeam / description 四个字段统一执行）：
- 不要输出一整段文字：按序号分点列示（1. 2. 3. ...），每点独立成行，一点讲一件事
- 每点的重点内容（关键数据、里程碑、核心结论）用 **加粗** 标注
- coreTeam 按成员分点（每人一点：姓名/职务/背景履历要点），访谈补充信息另起一点
内容要求：
- mainProducts / coreAdvantage / coreTeam 三个字段必须优先截取 BP 原文中对应页/段落的关键句（保留原文表述与量化数据），再辅以文字串联，不得凭空编造
- coreTeam 必须穷尽 BP 中出现的所有核心成员（不得只写创始人），并融合访谈纪要中的团队认识方式、创业契机等信息
- 其他字段（行业/定位/轮次/金额/估值等）也应尽量从 BP 与访谈纪要中提取完整，文档确实未提及才写"未披露"/null
- 结论克制、可核验`

/** 项目库草稿（AI 按项目库模板从 BP/解读/访谈纪要/结论提取） */
export interface ProjectDraft {
  name: string
  companyFullName: string
  industry: string
  companyPosition: string
  mainProducts: string
  coreAdvantage: string
  coreTeam: string
  description: string
  financingRound: string
  totalAmount: string
  investmentValuation: number | null
}

/**
 * 闭环创建：从解读全量材料提取项目库模板字段
 * （主要产品/核心优势/核心团队 截取 BP 原文对应资料 + 文字描述；访谈纪要补充团队认识/创业契机等）
 */
export async function runProjectDraftExtraction(input: {
  projectName: string
  documentText: string
  interviewText?: string | null
  interpretation: InterpretationResult | null
  conclusionSummary: string
}): Promise<ProjectDraft> {
  const docText = input.documentText.slice(0, MAX_DOC_TEXT)
  const digestParts: string[] = []
  if (input.interpretation) {
    digestParts.push(
      `七维解读：\n行业：${input.interpretation.industry}\n市场地位：${input.interpretation.marketPosition}\n技术领先性：${input.interpretation.techLeadership}\n团队咖位：${input.interpretation.teamStanding}\n竞争分析：${input.interpretation.competitionAnalysis}`
    )
  }
  if (input.interviewText && input.interviewText.trim()) {
    digestParts.push(`访谈纪要（含团队认识方式、创业契机、业务细节等补充信息）：\n${input.interviewText.slice(0, 8000)}`)
  }
  if (input.conclusionSummary) {
    digestParts.push(`访谈校验综合结论：${input.conclusionSummary}`)
  }
  const digest = digestParts.length > 0 ? digestParts.join('\n\n') + '\n\n' : ''

  const { parsed } = await callDeepSeekJson<Partial<ProjectDraft>>(
    PROJECT_DRAFT_SYSTEM_PROMPT,
    `项目：${input.projectName}\n${digest}BP 文档原文：\n\n${docText}\n\n请按项目库模板输出提取 JSON。`,
    3000
  )
  if (!parsed || !parsed.name || !parsed.mainProducts) {
    throw new Error('AI 提取项目信息不完整，请重试')
  }
  return {
    name: String(parsed.name).trim().slice(0, 50),
    companyFullName: parsed.companyFullName ? String(parsed.companyFullName).slice(0, 100) : '',
    industry: parsed.industry ? String(parsed.industry).slice(0, 50) : '',
    companyPosition: parsed.companyPosition ? String(parsed.companyPosition).slice(0, 100) : '',
    mainProducts: String(parsed.mainProducts).slice(0, 2000),
    coreAdvantage: parsed.coreAdvantage ? String(parsed.coreAdvantage).slice(0, 2000) : '未披露',
    coreTeam: parsed.coreTeam ? String(parsed.coreTeam).slice(0, 4000) : '未披露',
    description: parsed.description ? String(parsed.description).slice(0, 1000) : '',
    financingRound: parsed.financingRound ? String(parsed.financingRound).slice(0, 30) : '',
    totalAmount: parsed.totalAmount ? String(parsed.totalAmount).slice(0, 30) : '待补充',
    investmentValuation:
      typeof parsed.investmentValuation === 'number' && Number.isFinite(parsed.investmentValuation)
        ? parsed.investmentValuation
        : null,
  }
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
- 排版：gapAnalysis 与 conclusion 内容分点展示（差距点逐条列出，每点一行），重点内容（矛盾之处/缺失关键数据）用 **加粗** 标注
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
要求：dimensions 按差距从大到小排序；结论必须由校验结果支撑，不得引入未提及的信息。
排版要求（所有文本字段统一执行）：内容分点展示（每点独立一行，不要一整段文字），重点内容（核心结论/关键数据/重大风险）用 **加粗** 标注。`

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
