/**
 * 投后管理：AI 分析主流程
 *
 * 流程：上传文档 →（本模块）指标提取入库 → 程序计算同比/环比 → AI 结构化分析 → 落库
 * 幻觉控制原则：
 * - 数字不允许 LLM 计算：同比/环比/现金覆盖月数全部由 calc.ts 程序算好后作为输入
 * - 所有结论必须基于输入的结构化数据与文档内容，禁止编造
 */

import prisma from '@/lib/prisma'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import { METRIC_BY_KEY, metricDictionaryText } from './metrics'
import { computeMetricsWithChange, calcRunwayMonths, isValidPeriod, parsePeriod, type MetricWithChange } from './calc'
import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

// ── AI 结构化输出类型 ──

export interface PostInvestAnomaly {
  level: 'high' | 'medium' | 'positive'
  title: string
  detail: string
  evidence: string
}

export interface PostInvestBusinessProgress {
  area: string
  rating: number
  detail: string
}

export interface PostInvestRiskAlert {
  type: string
  level: 'high' | 'medium' | 'low'
  description: string
  evidence: string
}

export interface PostInvestAnalysisResult {
  executive_summary: string
  financial_analysis: Array<{ metricName: string; value: string; yoy: string; qoq: string; status: 'normal' | 'watch' | 'risk' }>
  anomalies: PostInvestAnomaly[]
  cashflow_analysis: { cash_balance: string; runway_months: number | null; assessment: string }
  business_progress: PostInvestBusinessProgress[]
  risk_alerts: PostInvestRiskAlert[]
}

// ── 指标提取 ──

const EXTRACT_SYSTEM_PROMPT = `你是投资机构的投后数据抽取引擎。从企业经营报告/财务报表全文中提取结构化财务与业务指标。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "metrics": [
    { "metricKey": "指标字典中的 key", "value": 数值, "unit": "单位", "sourceText": "原文中支撑该数值的句子（原文摘录，含数字）" }
  ]
}
指标字典（只允许提取以下 key，未出现的指标不要输出）：
${'${METRIC_DICTIONARY}'}
要求：
- value 为纯数值（不带单位与千分位符）；亏损/流出为负数；毛利率/净利率为百分数值（38% → 38）
- 单位换算：文档金额单位为"亿元"时换算为万元（1亿=10000万）；"元"换算为万元
- 报告中同一指标出现多个值（本期/累计/上年同期）时，提取本期值
- sourceText 必须是原文摘录，用于溯源
- 只提取文档中明确出现的数值，禁止推算`

/** DeepSeek 通用调用 */
async function callDeepSeek(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
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
        temperature: 0.2,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${response.status} ${errText.substring(0, 150)}`)
    }
    const data = (await response.json()) as { usage?: unknown; choices?: Array<{ message?: { content?: string } }> }
    recordTokenUsage('dd-harness', data.usage as Parameters<typeof recordTokenUsage>[1])
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 该期文档全文摘要（每文档截断，图片占位） */
function buildDocsDigest(docs: Array<{ fileName: string; docType: string; text: string }>): string {
  const parts = docs.map(d => {
    const text = (d.text || '').replace(/<img[^>]*>/g, '[截图]').replace(/<[^>]+>/g, ' ').trim()
    return `【${d.fileName}】\n${text ? text.slice(0, 20000) : '（未能提取文本）'}`
  })
  return parts.join('\n\n') || '（无文档）'
}

/** 从指定期文档中提取指标并 upsert 入库，返回提取的指标数 */
async function extractMetricsForPeriod(projectId: string, period: string): Promise<number> {
  const docs = await prisma.postInvestDoc.findMany({ where: { projectId, period } })
  if (docs.length === 0) return 0
  const content = buildDocsDigest(docs)
  const raw = await callDeepSeek(
    EXTRACT_SYSTEM_PROMPT.replace('${METRIC_DICTIONARY}', metricDictionaryText()),
    `报告期：${period}\n\n以下是本期上传的全部投后资料全文，请提取指标 JSON：\n\n${content}`,
    2500
  )
  const parsed = parseAgentJson<{ metrics?: Array<{ metricKey?: string; value?: number | string; unit?: string; sourceText?: string }> }>(raw)
  const items = Array.isArray(parsed?.metrics) ? parsed!.metrics : []

  let saved = 0
  const firstDocId = docs[0]?.id || null
  for (const item of items) {
    const def = item?.metricKey ? METRIC_BY_KEY.get(String(item.metricKey)) : undefined
    const value = Number(item?.value)
    if (!def || !Number.isFinite(value)) continue
    await prisma.postInvestMetric.upsert({
      where: { projectId_period_metricKey: { projectId, period, metricKey: def.key } },
      create: {
        projectId,
        period,
        periodType: parsePeriod(period)!.type,
        metricKey: def.key,
        metricName: def.name,
        category: def.category,
        value,
        unit: String(item.unit || def.unit),
        sourceDocId: firstDocId,
        sourceText: String(item.sourceText || '').slice(0, 500) || null,
      },
      update: { value, sourceText: String(item.sourceText || '').slice(0, 500) || null, sourceDocId: firstDocId },
    })
    saved++
  }
  return saved
}

// ── AI 经营分析 ──

const ANALYSIS_SYSTEM_PROMPT = `你是投资机构的投后管理分析 Agent。基于企业提交的经营资料与结构化指标数据，分析企业本报告期的经营情况。
你会收到：本期指标（含程序计算的同比/环比）、历史各期指标、本期文档全文、以及历史各期文档全文。
你的任务不是评价项目投资价值，而是客观分析经营、财务、现金流、业务进展和潜在风险，并结合历史期数据做趋势判断。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "executive_summary": "本报告期经营情况核心结论（150字内，区分改善/正常/关注）",
  "financial_analysis": [
    { "metricName": "指标名", "value": "本期值（带单位）", "yoy": "同比描述（如 +52%，无数据用 -）", "qoq": "环比描述（如 -3%，无数据用 -）", "status": "normal 或 watch 或 risk" }
  ],
  "anomalies": [
    { "level": "high 或 medium 或 positive", "title": "异常点标题", "detail": "具体说明（引用数据）", "evidence": "数据来源描述（指标名+原文）" }
  ],
  "cashflow_analysis": { "cash_balance": "现金余额描述", "runway_months": 现金覆盖月数（无数据用 null）, "assessment": "资金流健康评估（结合收入增长与现金流匹配情况）" },
  "business_progress": [
    { "area": "订单 或 客户 或 产品 或 研发 或 融资 或 人员", "rating": 1到5的整数, "detail": "具体进展描述" }
  ],
  "risk_alerts": [
    { "type": "财务 或 现金流 或 业务 或 融资 或 管理", "level": "high 或 medium 或 low", "description": "风险描述", "evidence": "证据（引用数据/原文）" }
  ]
}
硬性规则（违反即废稿）：
1. 所有数字必须来自输入的结构化指标数据或文档摘录，禁止编造、禁止自行计算
2. 每条异常/风险必须引用具体数据作为证据
3. 事实与判断分离：先陈述数据，再给判断
4. 输入数据未覆盖的领域（如无订单信息），business_progress 中不输出该项
5. 收入增长但经营现金流为负/下降时，必须提示"收入增长与现金流背离，关注回款质量"
6. 结合历史各期数据做趋势判断：如经营现金流连续两期为负、收入持续增长、订单波动、亏损持续收窄/扩大等，趋势结论必须注明涉及的具体期数与数据`

/** 格式化指标（带同比环比）为 AI 输入 */
function formatMetricsInput(metrics: MetricWithChange[]): string {
  return metrics
    .map(m => {
      const yoy = m.yoy ? (m.yoy.pct !== null ? `${m.yoy.pct >= 0 ? '+' : ''}${(m.yoy.pct * 100).toFixed(1)}%` : '上期为0') : '无同比数据'
      const qoq = m.qoq ? (m.qoq.pct !== null ? `${m.qoq.pct >= 0 ? '+' : ''}${(m.qoq.pct * 100).toFixed(1)}%` : '上期为0') : '无环比数据'
      return `- ${m.metricName}：${m.value} ${m.unit}（同比 ${yoy}，环比 ${qoq}）｜原文：${m.sourceText || '—'}`
    })
    .join('\n')
}

/** 投后分析主流程：补齐各期指标 → 计算同比环比 → 合并历史期文档做 AI 分析 → 落库
 *  分析任一期（当季或以往季）时，会把项目全部历史期文档纳入分析上下文（趋势与连续性判断） */
export async function runPostInvestAnalysis(projectId: string, period: string): Promise<{
  ok: boolean
  error?: string
  metricCount?: number
  analysis?: PostInvestAnalysisResult
}> {
  if (!isValidPeriod(period)) {
    return { ok: false, error: '无效的报告期（格式：2026Q1 / 2026H1 / 2026FY）' }
  }
  const docCount = await prisma.postInvestDoc.count({ where: { projectId, period } })
  if (docCount === 0) {
    return { ok: false, error: `「${period}」尚未上传任何投后资料（经营报告 / 财务报表，任一项即可）` }
  }

  // 1. 补齐历史期指标：以往季上传的报告（如补传 2026Q1）在分析时任一期都会被提取入库，形成完整时序
  const allDocPeriods = await prisma.postInvestDoc.groupBy({ by: ['period'], where: { projectId } })
  for (const { period: p } of allDocPeriods) {
    if (p === period) continue
    const existing = await prisma.postInvestMetric.count({ where: { projectId, period: p } })
    if (existing === 0) {
      await extractMetricsForPeriod(projectId, p).catch(() => 0)
    }
  }

  // 2. 本期指标强制提取（重新分析覆盖刷新）
  const saved = await extractMetricsForPeriod(projectId, period)
  if (saved === 0 && (await prisma.postInvestMetric.count({ where: { projectId, period } })) === 0) {
    return { ok: false, error: `未能从「${period}」的资料中提取出有效指标，请检查文档内容（扫描件暂不支持）` }
  }

  // 3. 读全部历史指标 → 程序计算同比/环比
  const allMetrics = await prisma.postInvestMetric.findMany({ where: { projectId } })
  const historyByPeriod = new Map<string, Map<string, number>>()
  for (const m of allMetrics) {
    if (!historyByPeriod.has(m.period)) historyByPeriod.set(m.period, new Map())
    historyByPeriod.get(m.period)!.set(m.metricKey, m.value)
  }
  const currentRows = allMetrics
    .filter(m => m.period === period)
    .map(m => ({ metricKey: m.metricKey, metricName: m.metricName, category: m.category, unit: m.unit, value: m.value, sourceText: m.sourceText }))
  const metricsWithChange = computeMetricsWithChange(period, currentRows, historyByPeriod)

  // 历史各期指标汇总（供趋势判断）
  const otherPeriods = Array.from(historyByPeriod.keys()).filter(p => p !== period).sort()
  const historyMetricsText = otherPeriods.length > 0
    ? otherPeriods.map(p => {
        const rows = allMetrics.filter(m => m.period === p)
        return `【${p}】${rows.map(m => `${m.metricName}=${m.value}${m.unit}`).join('、') || '（无指标）'}`
      }).join('\n')
    : ''

  // 4. 现金覆盖月数（程序计算）
  const getByKey = (key: string) => metricsWithChange.find(m => m.metricKey === key)
  const runway = calcRunwayMonths(getByKey('cash_balance')?.value, getByKey('operating_cash_flow')?.value, period)

  // 5. 文档全文：本期 + 历史各期合并（趋势与连续性分析的上下文）
  const allDocs = await prisma.postInvestDoc.findMany({
    where: { projectId },
    orderBy: [{ period: 'asc' }, { createdAt: 'asc' }],
  })
  const currentDocs = allDocs.filter(d => d.period === period)
  const historyDocs = allDocs.filter(d => d.period !== period)
  const docsDigest = buildDocsDigest(currentDocs).slice(0, 12000)
  const historyDocsDigest = historyDocs.length > 0
    ? `\n\n【历史各期资料（合并分析：趋势与连续性判断）】\n${historyDocs
        .map(d => `【${d.period}·${d.fileName}】\n${(d.text || '（未能提取文本）').replace(/<img[^>]*>/g, '[截图]').slice(0, 6000)}`)
        .join('\n\n')}`.slice(0, 30000)
    : ''

  // 6. AI 分析（合并本期 + 历史期数据）
  const raw = await callDeepSeek(
    ANALYSIS_SYSTEM_PROMPT,
    `报告期：${period}\n\n【本期结构化指标（同比环比已由程序计算，直接引用，禁止自行计算）】\n${formatMetricsInput(metricsWithChange)}${historyMetricsText ? `\n\n【历史各期指标时序】\n${historyMetricsText}` : ''}\n\n【现金覆盖月数（程序计算）】${runway !== null ? `${runway} 个月` : '无法计算（现金余额或经营现金流缺失/为正）'}\n\n【本期上传文档全文】\n${docsDigest}${historyDocsDigest}`,
    3500
  )
  const parsed = parseAgentJson<PostInvestAnalysisResult>(raw)
  if (!parsed || !parsed.executive_summary) {
    return { ok: false, error: 'AI 分析结果不完整，请重试' }
  }
  const analysis: PostInvestAnalysisResult = {
    executive_summary: String(parsed.executive_summary),
    financial_analysis: Array.isArray(parsed.financial_analysis) ? parsed.financial_analysis.slice(0, 16) : [],
    anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies.slice(0, 10) : [],
    cashflow_analysis: {
      cash_balance: String(parsed.cashflow_analysis?.cash_balance || '—'),
      runway_months: typeof parsed.cashflow_analysis?.runway_months === 'number' ? parsed.cashflow_analysis.runway_months : runway,
      assessment: String(parsed.cashflow_analysis?.assessment || '—'),
    },
    business_progress: Array.isArray(parsed.business_progress) ? parsed.business_progress.slice(0, 8) : [],
    risk_alerts: Array.isArray(parsed.risk_alerts) ? parsed.risk_alerts.slice(0, 10) : [],
  }

  // 7. 落库（upsert 覆盖旧分析）
  await prisma.postInvestAnalysis.upsert({
    where: { projectId_period: { projectId, period } },
    create: { projectId, period, summaryJson: JSON.stringify(analysis) },
    update: { summaryJson: JSON.stringify(analysis), createdAt: new Date() },
  })

  return { ok: true, metricCount: saved, analysis }
}
