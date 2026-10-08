/**
 * 声明校验器（ClaimVerifier）：互联网交叉核验（P2.1 尽调报告 / P2.2 项目解读 / P2.3 AI行研 共用核心）
 *
 * 流程（2 次 DeepSeek + 双源搜索）：
 * 1. 提取声明：从文本提取 3-5 条最关键的可核验声明（数字/排名/事件/合作关系），
 *    每条同步生成 1-2 组搜索关键词 + 主体（entity：公司名/行业名）+ 知识域（field）
 * 2. 双源搜索：searchWebDual（collect 模式 + 12h 缓存），查询全局去重，分批并发控速率
 * 3. 比对裁决：单次调用比对全部声明与证据，输出四级裁决
 *    ✅ SUPPORTED 一致 / ⚠️ EXAGGERATED 夸大 / ❌ CONTRADICTED 矛盾 / ❓ UNVERIFIED 未证实
 *
 * 防编造：证据以全局索引（evidenceIdx）回指，只保留真实搜索返回的 URL（结构上杜绝模型编造来源）
 * 成本护栏：≤5 条声明、每条 ≤2 组查询、全局 ≤8 次搜索、每条声明 ≤6 条证据摘要（各 ≤300 字）
 */

import prisma from '@/lib/prisma'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import { searchWebDual, type SearchResult, type SearchModule } from '@/lib/tavily-search'
import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

// ── 成本护栏 ──
const MAX_CLAIMS = 5
const MAX_QUERIES_PER_CLAIM = 2
const MAX_TOTAL_SEARCHES = 8
const EVIDENCE_PER_CLAIM = 6
const SNIPPET_LEN = 300
/** 文本参与声明提取的最大长度 */
const MAX_TEXT = 6000

// ── 类型 ──

export type ClaimVerdict = 'SUPPORTED' | 'EXAGGERATED' | 'CONTRADICTED' | 'UNVERIFIED'

export interface ClaimEvidence {
  title: string
  url: string
  snippet: string
}

export interface VerifiedClaim {
  claim: string
  verdict: ClaimVerdict
  note: string
  evidence: ClaimEvidence[]
  /** 声明主体（公司名/行业名，知识沉淀库 subject 用） */
  entity?: string
  /** 知识域：technology/market/team/business/finance/general */
  field?: string
}

export interface ClaimVerification {
  claims: VerifiedClaim[]
  /** 一句话汇总（如：共 4 条声明：✅ 一致 2 · ⚠️ 夸大 1 · ❓ 未证实 1） */
  summary: string
  verifiedAt: string
}

const VERDICTS: ClaimVerdict[] = ['SUPPORTED', 'EXAGGERATED', 'CONTRADICTED', 'UNVERIFIED']
const FIELDS = ['technology', 'market', 'team', 'business', 'finance', 'general']

/** 裁决中文标签（服务端汇总用；前端徽章样式在组件内定义） */
export const CLAIM_VERDICT_LABELS: Record<ClaimVerdict, string> = {
  SUPPORTED: '✅ 一致',
  EXAGGERATED: '⚠️ 夸大',
  CONTRADICTED: '❌ 矛盾',
  UNVERIFIED: '❓ 未证实',
}

// ── Prompt ──

const EXTRACT_SYSTEM_PROMPT = `你是一级市场尽调核查员。从给定文本中提取最关键、可通过公开互联网核验的事实性声明。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "claims": [
    {
      "claim": "文本中的具体声明（数字/排名/事件/合作关系/技术性能等可核验表述，60字内）",
      "queries": ["搜索关键词组1（3-6个词，精准可搜）", "关键词组2"],
      "entity": "声明主体（公司名或行业名，10字内，如：宇树科技/具身智能）",
      "field": "知识域：technology|market|team|business|finance|general（单选）"
    }
  ]
}
要求：
- 只提取可核验的事实性声明：营收/订单/市场份额/融资/良率/性能指标/客户合作/获奖排名等；观点、判断、展望不提取
- 优先提取对投资决策影响最大的声明，最多 ${MAX_CLAIMS} 条（不足时如实提取，文本缺乏具体数据时可返回 0 条）
- 每条声明给 1-${MAX_QUERIES_PER_CLAIM} 组搜索关键词：优先中文；涉及国外对标/技术路线/跨国公司时附英文组；关键词须来自声明中的具体实体与数据（公司名/产品名/技术路线/数字），不要只用行业名泛搜
- claim 摘自原文或忠实概括，不得改变数字与指向
- entity 是声明谈论的公司或行业（供知识库归档）；field 按声明内容归类`

const VERDICT_SYSTEM_PROMPT = `你是一级市场尽调核查员。将声明与互联网检索证据逐一交叉比对，给出裁决。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "verdicts": [
    { "claimIdx": 0, "verdict": "SUPPORTED", "note": "裁决说明（援引证据中的具体数据/表述，80字内）", "evidenceIdx": [0, 2] }
  ]
}
裁决标准（verdict 只能取以下四值）：
- SUPPORTED（一致）：证据明确支持声明（数量级与指向一致）
- EXAGGERATED（夸大）：方向一致但声明数据明显优于证据（如行业平均 85% vs 声称 95%），或证据只支持更弱版本
- CONTRADICTED（矛盾）：证据与声明直接冲突（数字/事件/关系对不上）
- UNVERIFIED（未证实）：无相关证据，或证据不足以判断
要求：
- note 必须援引证据中的具体数据说明理由（直接写数据与来源名，不要使用 [N] 编号引用）；UNVERIFIED 时说明公开检索为何无法覆盖
- evidenceIdx 只能从下方列出的证据编号中选择，每条声明选 0-3 条最相关证据；无相关证据选 []
- 逐条声明输出（claimIdx 覆盖全部声明），不得遗漏`

// ── DeepSeek 调用 ──

async function callDeepSeekJson<T>(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<T | null> {
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
    recordTokenUsage('dd-harness', data.usage as Parameters<typeof recordTokenUsage>[1])
    return parseAgentJson<T>(data.choices?.[0]?.message?.content || '')
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── 流程步骤 ──

/** 步骤1：提取可核验声明 + 搜索关键词 + 主体/知识域 */
async function extractClaims(text: string): Promise<Array<{ claim: string; queries: string[]; entity?: string; field?: string }>> {
  const parsed = await callDeepSeekJson<{ claims?: Array<{ claim?: string; queries?: string[]; entity?: string; field?: string }> }>(
    EXTRACT_SYSTEM_PROMPT,
    `待核验文本：\n\n${text}\n\n请提取可核验声明 JSON。`,
    1500
  )
  const raw = Array.isArray(parsed?.claims) ? parsed!.claims : []
  const claims: Array<{ claim: string; queries: string[]; entity?: string; field?: string }> = []
  for (const c of raw) {
    const claim = typeof c?.claim === 'string' ? c.claim.trim() : ''
    if (!claim) continue
    const queries = (Array.isArray(c?.queries) ? c!.queries : [])
      .map(q => (typeof q === 'string' ? q.trim() : ''))
      .filter(q => q.length > 1)
      .slice(0, MAX_QUERIES_PER_CLAIM)
    claims.push({
      claim: claim.slice(0, 120),
      queries,
      entity: typeof c?.entity === 'string' ? c.entity.trim().slice(0, 20) || undefined : undefined,
      field: FIELDS.includes(String(c?.field)) ? String(c!.field) : 'general',
    })
    if (claims.length >= MAX_CLAIMS) break
  }
  return claims
}

/** 步骤2：双源搜索（全局去重 + 上限 + 4 组分批并发） */
async function searchForClaims(
  claims: Array<{ claim: string; queries: string[] }>,
  module: SearchModule
): Promise<Map<string, SearchResult[]>> {
  const allQueries: string[] = []
  for (const c of claims) {
    for (const q of c.queries) {
      if (!allQueries.includes(q)) allQueries.push(q)
    }
  }
  const queries = allQueries.slice(0, MAX_TOTAL_SEARCHES)
  const resultsByQuery = new Map<string, SearchResult[]>()
  // 4 组分批并发（控速率，与报告生成同规格）
  for (let i = 0; i < queries.length; i += 4) {
    const batch = queries.slice(i, i + 4)
    await Promise.all(
      batch.map(async q => {
        const results = await searchWebDual(q, {
          maxResults: 5,
          mode: 'collect',
          module,
        }).catch(() => [] as SearchResult[])
        resultsByQuery.set(q, results)
      })
    )
  }
  return resultsByQuery
}

/** 步骤3：比对裁决（evidenceIdx 回指真实证据，防编造来源） */
async function verdictClaims(
  claims: Array<{ claim: string; queries: string[]; entity?: string; field?: string }>,
  resultsByQuery: Map<string, SearchResult[]>
): Promise<ClaimVerification> {
  // 全局证据池（带索引）：每声明去重取前 EVIDENCE_PER_CLAIM 条
  const allEvidence: Array<ClaimEvidence & { claimIdx: number }> = []
  const perClaimEvidence: number[][] = claims.map((c, claimIdx) => {
    const seen = new Set<string>()
    const idxs: number[] = []
    for (const q of c.queries) {
      for (const r of resultsByQuery.get(q) || []) {
        if (!r.url || seen.has(r.url)) continue
        seen.add(r.url)
        idxs.push(allEvidence.length)
        allEvidence.push({
          claimIdx,
          title: String(r.title || '').slice(0, 80),
          url: r.url,
          snippet: String(r.content || '').slice(0, SNIPPET_LEN),
        })
        if (idxs.length >= EVIDENCE_PER_CLAIM) return idxs
      }
    }
    return idxs
  })

  const hasAnyEvidence = allEvidence.length > 0

  // 证据摘要（按声明分组呈现，无证据的声明显式标注）
  const claimList = claims.map((c, i) => `[${i}] ${c.claim}`).join('\n')
  const evidenceList = claims
    .map((_c, i) => {
      const idxs = perClaimEvidence[i]
      if (idxs.length === 0) return `【声明 ${i} 的证据】[无检索结果]`
      return `【声明 ${i} 的证据】\n` + idxs.map(j => `[${j}] ${allEvidence[j].title}\n摘要：${allEvidence[j].snippet}`).join('\n')
    })
    .join('\n\n')

  const parsed = await callDeepSeekJson<{
    verdicts?: Array<{ claimIdx?: number; verdict?: string; note?: string; evidenceIdx?: number[] }>
  }>(
    VERDICT_SYSTEM_PROMPT,
    `【声明列表】\n${claimList}\n\n【证据列表（互联网检索）】\n${evidenceList}\n\n请输出交叉比对裁决 JSON。`,
    2500
  )

  // 裁决映射（缺失/非法的声明默认 UNVERIFIED）
  const verdictMap = new Map<number, { verdict: ClaimVerdict; note: string; evidenceIdx: number[] }>()
  for (const v of Array.isArray(parsed?.verdicts) ? parsed!.verdicts : []) {
    const idx = Number(v?.claimIdx)
    if (!Number.isInteger(idx) || idx < 0 || idx >= claims.length) continue
    verdictMap.set(idx, {
      verdict: VERDICTS.includes(v?.verdict as ClaimVerdict) ? (v!.verdict as ClaimVerdict) : 'UNVERIFIED',
      note: typeof v?.note === 'string' ? v.note.trim().slice(0, 200) : '',
      evidenceIdx: (Array.isArray(v?.evidenceIdx) ? v!.evidenceIdx! : [])
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 0 && n < allEvidence.length)
        .slice(0, 3),
    })
  }

  const finalClaims: VerifiedClaim[] = claims.map((c, i) => {
    const v = verdictMap.get(i)
    return {
      claim: c.claim,
      verdict: v?.verdict || 'UNVERIFIED',
      note: v?.note || (hasAnyEvidence ? 'AI 裁决不完整，默认未证实' : '联网检索无结果，未能核验'),
      evidence: (v?.evidenceIdx || [])
        .map(j => allEvidence[j])
        .filter(e => e.claimIdx === i)
        .map(e => ({ title: e.title, url: e.url, snippet: e.snippet })),
      entity: c.entity,
      field: c.field,
    }
  })

  // 汇总
  const counts = { SUPPORTED: 0, EXAGGERATED: 0, CONTRADICTED: 0, UNVERIFIED: 0 }
  for (const c of finalClaims) counts[c.verdict]++
  const parts: string[] = [`共 ${finalClaims.length} 条声明`]
  if (counts.SUPPORTED) parts.push(`✅ 一致 ${counts.SUPPORTED}`)
  if (counts.EXAGGERATED) parts.push(`⚠️ 夸大 ${counts.EXAGGERATED}`)
  if (counts.CONTRADICTED) parts.push(`❌ 矛盾 ${counts.CONTRADICTED}`)
  if (counts.UNVERIFIED) parts.push(`❓ 未证实 ${counts.UNVERIFIED}`)
  if (!hasAnyEvidence) parts.push('（联网检索暂无结果）')

  return {
    claims: finalClaims,
    summary: parts.join(' · '),
    verifiedAt: new Date().toISOString(),
  }
}

// ── 通用入口（尽调报告 / 项目解读 / AI行研 共用） ──

/**
 * 对任意文本执行声明校验（提取 → 双源搜索 → 裁决）
 * @param text 待核验文本（≤6000 字参与提取）
 * @param opts.module 搜索模块标记（token 记账归属，如 dd-claim-verify / project-interpretation / ai-research）
 */
export async function verifyTextClaims(
  text: string,
  opts?: { module?: SearchModule }
): Promise<ClaimVerification> {
  const normalized = String(text || '').replace(/【图\d+】|\[图\d+\]/g, '').slice(0, MAX_TEXT)
  // 1. 提取声明（无可核验声明 → 空结果）
  const claims = await extractClaims(normalized)
  if (claims.length === 0) {
    return {
      claims: [],
      summary: '未提取到可核验声明（文本可能缺乏具体数据/事件类表述）',
      verifiedAt: new Date().toISOString(),
    }
  }
  // 2+3. 双源搜索 + 比对裁决
  const resultsByQuery = await searchForClaims(claims, opts?.module || 'dd-claim-verify')
  return verdictClaims(claims, resultsByQuery)
}

// ── 尽调模块报告入口（P2.1） ──

/** 尽调报告文本：summary + 机会/风险点 */
function buildReportText(report: { summary?: string; opportunities?: string[]; risks?: string[] }): string {
  const parts: string[] = []
  if (report.summary) parts.push(String(report.summary))
  if (Array.isArray(report.opportunities) && report.opportunities.length > 0) {
    parts.push('机会点：\n' + report.opportunities.map((o, i) => `${i + 1}. ${o}`).join('\n'))
  }
  if (Array.isArray(report.risks) && report.risks.length > 0) {
    parts.push('风险点：\n' + report.risks.map((r, i) => `${i + 1}. ${r}`).join('\n'))
  }
  return parts.join('\n\n')
}

/**
 * 对单个模块的尽调报告执行外部校验（互联网交叉核验）
 * 前置：模块报告已生成（reportJson 存在）；结果覆盖写入 verificationJson
 */
export async function runClaimVerification(projectId: string, moduleKey: string): Promise<{
  ok: boolean
  error?: string
  verification?: ClaimVerification
}> {
  const record = await prisma.dDModuleResource.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey } },
    select: { reportJson: true },
  })
  if (!record?.reportJson) {
    return { ok: false, error: '该模块尚未生成尽调报告，请先生成报告再进行外部校验' }
  }
  let report: { summary?: string; opportunities?: string[]; risks?: string[] }
  try {
    report = JSON.parse(record.reportJson)
  } catch {
    return { ok: false, error: '模块报告数据异常，请重新生成报告' }
  }

  const verification = await verifyTextClaims(buildReportText(report), { module: 'dd-claim-verify' })

  await prisma.dDModuleResource.update({
    where: { projectId_moduleKey: { projectId, moduleKey } },
    data: { verificationJson: JSON.stringify(verification) },
  })
  return { ok: true, verification }
}
