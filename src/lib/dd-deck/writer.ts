/**
 * 幻灯片内容生成与模板组装
 *
 * AI 只负责「每页的结论与要点」，页面数量、layout、证据编号由程序控制；
 * 这样既保证叙述逻辑，又避免模型自由排版导致溢出或缺页。
 */

import { callDeepSeekJson } from '@/lib/dd-research/llm'
import type { DeckContext, DeckFact, DeckModuleContext } from './context'
import type { DeckSpec, DeckType, SlideSpec } from './spec'

export interface ModuleNarrative {
  moduleKey: string
  headline: string
  bullets: string[]
  /** 第二页：这意味着什么（投资含义、驱动、反证） */
  analysisHeadline?: string
  analysis?: string[]
  opportunity?: string
  risk?: string
  unknown?: string
  evidenceRefs?: string[]
}

export interface DeckNarratives {
  executiveSummary: {
    headline: string
    bullets: string[]
    conclusion: string
  }
  /** 行业发展与政策环境（综合市场、竞争、商业化模块） */
  industry: {
    headline: string
    bullets: string[]
  }
  /** 时机窗口：为什么是现在 */
  timing: {
    headline: string
    bullets: string[]
  }
  modules: ModuleNarrative[]
  opportunities: Array<{ title: string; detail: string; evidenceRefs?: string[] }>
  risks: Array<{ title: string; detail: string; mitigation: string; evidenceRefs?: string[] }>
  valuation: {
    headline: string
    bullets: string[]
    stats: Array<{ label: string; value: string; hint?: string }>
  }
  conclusion: {
    headline: string
    conditions: string[]
    nextSteps: string[]
  }
}

const SYSTEM_PROMPT = [
  '你是风险投资机构的尽调报告主笔，服务投委会。写作要求：',
  '1. 结论先行：每页标题就是该页结论，不是栏目名。',
  '2. 层层递进：先回答「是什么」，再回答「为什么可能成」「为什么可能不成」，最后给估值、条款与结论。',
  '3. 公司具体数据只能用给定事实，引用时在句末写 [F3]；不得编造公司收入、订单、客户与估值数字。',
  '4. 允许使用公开行业常识补充行业背景与竞争逻辑，但必须写成分析判断（如「行业通常…」），不得伪装成公司事实。',
  '5. 每个模块写两组内容：先写「事实与发现」，再写「这意味着什么」；后者要包含驱动因素、反证条件与待验证项。',
  '6. 风险与机会必须成对出现，风险要写缓释与验证动作。',
  '7. 不写空话、不堆形容词；内容要具体到业务、客户、技术、竞争与交易。',
  '只输出 JSON，不要输出 Markdown。',
].join('\n')

function truncate(text: string, max: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function asStringArray(value: unknown, max: number, maxEach: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(v => truncate(v, maxEach))
    .filter(Boolean)
    .slice(0, max)
}

function factLine(fact: DeckFact): string {
  const value = fact.value ? `：${fact.value}${fact.unit || ''}` : ''
  const period = fact.period ? `（${fact.period}）` : ''
  return `[${fact.ref}] ${truncate(fact.fact, 60)}${value}${period}`
}

function buildPromptContext(context: DeckContext, type: DeckType): string {
  const lines: string[] = []
  lines.push(`报告类型：${type === 'BRIEF' ? '资料简报（给项目维护人看）' : '尽调报告（给投委会看）'}`)
  lines.push(`项目：${context.project.name}`)
  if (context.project.companyFullName) lines.push(`公司全称：${context.project.companyFullName}`)
  if (context.project.industry) lines.push(`行业：${context.project.industry}`)
  if (context.project.companyPosition) lines.push(`定位：${context.project.companyPosition}`)
  if (context.project.mainProducts) lines.push(`产品：${truncate(context.project.mainProducts, 120)}`)
  if (context.project.financingRound) lines.push(`轮次：${context.project.financingRound}`)
  if (context.project.totalAmount) lines.push(`融资金额：${context.project.totalAmount}`)
  if (context.project.investmentValuation) lines.push(`投前/投资估值：${context.project.investmentValuation} 亿元`)
  if (context.project.coreAdvantage) lines.push(`核心优势：${truncate(context.project.coreAdvantage, 160)}`)
  if (context.project.coreTeam) lines.push(`核心团队：${truncate(context.project.coreTeam, 160)}`)
  if (context.project.competitors) lines.push(`竞争对手：${truncate(context.project.competitors, 120)}`)

  lines.push('', `研究统计：来源 ${context.research.sourceCount} 条，事实 ${context.research.factCount} 条，平均覆盖 ${Math.round(context.research.coverage * 100)}%。`)
  lines.push(`缺口：阻塞 ${context.gaps.summary.blocking} 项，建议 ${context.gaps.summary.recommended} 项。`)

  for (const module of context.modules) {
    lines.push('', `【${module.moduleKey} ${module.moduleName}】核心问题：${module.coreQuestion}`)
    if (module.report?.summary) lines.push(`模块报告结论：${truncate(module.report.summary, 180)}`)
    if (module.report?.opportunities?.length) {
      lines.push(`模块机会：${module.report.opportunities.slice(0, 2).map(o => truncate(o, 60)).join('；')}`)
    }
    if (module.report?.risks?.length) {
      lines.push(`模块风险：${module.report.risks.slice(0, 2).map(r => truncate(r, 60)).join('；')}`)
    }
    if (module.facts.length === 0) {
      lines.push('公开事实：无（写「公开信息不足」，但仍需基于行业常识给出分析判断与验证路径）')
    } else {
      lines.push('公开事实：')
      for (const f of module.facts.slice(0, 10)) lines.push(`- ${factLine(f)}`)
    }
    const moduleSources = module.sources.slice(0, 5).map(s => `${s.ref}｜${truncate(s.title, 24)}｜${s.domain}（${s.grade}）`)
    if (moduleSources.length > 0) lines.push(`主要来源：${moduleSources.join('；')}`)
    const openGaps = module.gaps.filter(g => g.status === 'OPEN').map(g => g.label)
    if (openGaps.length > 0) lines.push(`该模块缺口：${openGaps.slice(0, 5).join('、')}`)
  }

  lines.push('', '请输出 JSON：')
  lines.push(`{
  "executiveSummary": {"headline":"一句话投资判断（≤30字）","bullets":["4条核心理由，每条≤85字，尽量带F编号"],"conclusion":"一句话结论（≤50字）"},
  "industry": {"headline":"行业阶段与格局判断（≤30字）","bullets":["5条：行业规模/增速、政策、产业链位置、竞争集中度、关键变量，每条≤85字"]},
  "timing": {"headline":"时机窗口判断（≤30字）","bullets":["4条：为什么是现在/为什么可能太早或太晚，每条≤85字，尽量带F编号"]},
  "opportunities": [{"title":"机会标题（≤16字）","detail":"为什么是机会（≤80字，带F编号）","evidenceRefs":["F1"]}],
  "risks": [{"title":"风险标题（≤16字）","detail":"风险机制（≤80字）","mitigation":"缓释或验证动作（≤65字）","evidenceRefs":["F1"]}],
  "valuation": {"headline":"估值判断（≤30字）","bullets":["4条估值/回报判断，每条≤85字"],"stats":[{"label":"指标","value":"数值","hint":"口径"}]},
  "conclusion": {"headline":"最终建议（≤30字）","conditions":["4条投放条件，每条≤65字"],"nextSteps":["4条投后验证，每条≤65字"]}
}`)
  lines.push('opportunities 和 risks 各 4–5 条；valuation.stats 3–4 个。')
  return lines.join('\n')
}

function buildModulePrompt(context: DeckContext, type: DeckType): string {
  const lines = [buildPromptContext(context, type), '', '现在只输出 9 个模块的深度内容，不要输出其他字段：']
  lines.push(`{
  "modules": [{
    "moduleKey": "PROJECT_ENTITY",
    "headline": "事实页结论（≤30字）",
    "bullets": ["5条事实与发现，每条≤85字，尽量带F编号"],
    "analysisHeadline": "分析页结论（≤30字）",
    "analysis": ["4条投资含义：驱动因素/反证条件/竞争影响/待验证项，每条≤85字"],
    "opportunity": "该模块最重要的机会（≤70字）",
    "risk": "该模块最重要的风险（≤70字）",
    "unknown": "公开信息无法回答、必须补充资料的问题（≤70字）",
    "evidenceRefs": ["F1","F2"]
  }]
}`)
  lines.push('modules 必须覆盖全部 9 个 moduleKey，顺序与上文一致；每页 4–5 条，不要只写 2 条。')
  return lines.join('\n')
}

function fallbackNarratives(context: DeckContext): DeckNarratives {
  const modules: ModuleNarrative[] = context.modules.map(m => {
    const facts = m.facts.slice(0, 5)
    const bullets: string[] = []
    if (m.report?.summary) bullets.push(truncate(m.report.summary, 85))
    for (const f of facts) bullets.push(factLine(f))
    if (bullets.length < 2) {
      bullets.push(`${m.moduleName}公开信息不足，当前覆盖 ${Math.round(m.coverage * 100)}%`)
      bullets.push(`已检索 ${m.sources.length} 条来源，需补充资料后形成确定结论`)
    }

    const analysis: string[] = []
    if (m.report?.opportunities?.[0]) analysis.push(`机会：${truncate(m.report.opportunities[0], 80)}`)
    if (m.report?.risks?.[0]) analysis.push(`风险：${truncate(m.report.risks[0], 80)}`)
    const openGap = m.gaps.find(g => g.status === 'OPEN')
    if (openGap) analysis.push(`待验证：${truncate(openGap.label, 80)}`)
    if (m.facts.length === 0) analysis.push('本模块公开信息不足，结论待资料补齐后更新')
    analysis.push(`投资含义：本模块覆盖 ${Math.round(m.coverage * 100)}%，需结合交易资料复核后纳入决策`)
    if (analysis.length < 4) analysis.push('验证路径：补充原始合同/台账/访谈记录，逐条核对关键假设')

    return {
      moduleKey: m.moduleKey,
      headline: m.report?.summary
        ? truncate(m.report.summary, 30)
        : `${m.moduleName}：公开信息覆盖 ${Math.round(m.coverage * 100)}%`,
      bullets: bullets.slice(0, 5),
      analysisHeadline: m.report?.risks?.[0]
        ? `关键在验证：${truncate(m.report.risks[0], 24)}`
        : `${m.moduleName}的投资含义与待验证项`,
      analysis: analysis.slice(0, 4),
      opportunity: m.report?.opportunities?.[0],
      risk: m.report?.risks?.[0] || m.gaps.find(g => g.status === 'OPEN')?.label,
      unknown: m.gaps.find(g => g.status === 'OPEN')?.label,
      evidenceRefs: m.facts.slice(0, 6).map(f => f.ref),
    }
  })

  const marketModule = context.modules.find(m => m.moduleKey === 'MARKET_CUSTOMERS')
  const competitionModule = context.modules.find(m => m.moduleKey === 'COMPETITION_MOATS')
  const commercializationModule = context.modules.find(m => m.moduleKey === 'COMMERCIALIZATION')

  const topFacts = context.facts.slice(0, 3)
  const blocking = context.gaps.items.filter(g => g.status === 'OPEN' && g.severity === 'BLOCKING')
  const recommended = context.gaps.items.filter(g => g.status === 'OPEN' && g.severity === 'RECOMMENDED')

  const opportunities = context.modules
    .flatMap(m => (m.report?.opportunities || []).map(text => ({ module: m, text })))
    .slice(0, 4)
    .map(x => ({
      title: truncate(x.module.moduleName, 14),
      detail: truncate(x.text, 80),
      evidenceRefs: x.module.facts.slice(0, 3).map(f => f.ref),
    }))

  const risks = [
    ...context.modules.flatMap(m => (m.report?.risks || []).map(text => ({ module: m, text }))),
    ...blocking.map(g => ({ module: { moduleName: g.label, facts: [] as DeckFact[] }, text: g.reason || '关键交易资料缺失' })),
  ].slice(0, 4).map(x => ({
    title: truncate(x.module.moduleName, 14),
    detail: truncate(x.text, 80),
    mitigation: '列入投前条件，交割前补充并复核',
    evidenceRefs: x.module.facts.slice(0, 3).map(f => f.ref),
  }))

  const valuationModule = context.modules.find(m => m.moduleKey === 'VALUATION_DEAL')
  const valuationFacts = valuationModule?.facts.slice(0, 4) || []

  const opportunityPool = [
    ...opportunities,
    { title: '资料补充后重估', detail: '当前公开信息仍有缺口，补充订单/财务资料后可重估增长与估值', evidenceRefs: [] as string[] },
    { title: '客户验证窗口', detail: '若核心客户复购与交付得到验证，增长确定性将显著提升', evidenceRefs: [] as string[] },
  ].slice(0, 5)

  const riskPool = [
    ...risks,
    { title: '信息不足风险', detail: '公开信息与上传资料不足，无法形成完整判断', mitigation: '先完成资料补充与客户访谈', evidenceRefs: [] as string[] },
    { title: '商业化不及预期', detail: '订单转化与回款节奏可能低于预测', mitigation: '按月跟踪订单与回款，设置里程碑', evidenceRefs: [] as string[] },
    { title: '估值与条款风险', detail: '可比交易不足导致定价缺乏锚点', mitigation: '补充可比融资并谈判下行保护条款', evidenceRefs: [] as string[] },
  ].slice(0, 5)

  const industryBullets: string[] = []
  if (marketModule?.report?.summary) industryBullets.push(truncate(marketModule.report.summary, 85))
  for (const f of marketModule?.facts.slice(0, 4) || []) industryBullets.push(factLine(f))
  if (competitionModule?.report?.summary) industryBullets.push(`竞争格局：${truncate(competitionModule.report.summary, 78)}`)
  if (industryBullets.length < 4) {
    industryBullets.push(`行业：${context.project.industry || '未填写'}，需结合公开市场数据判断规模与增速`)
    industryBullets.push('竞争集中度、政策周期与产业链位置是判断行业阶段的关键变量')
  }

  const timingBullets: string[] = []
  for (const f of commercializationModule?.facts.slice(0, 3) || []) timingBullets.push(factLine(f))
  if (commercializationModule?.report?.summary) timingBullets.push(truncate(commercializationModule.report.summary, 85))
  if (timingBullets.length < 4) {
    timingBullets.push('需求侧：客户预算与采购周期决定放量时点')
    timingBullets.push('供给侧：产品成熟度、交付能力与成本曲线决定能否承接需求')
    timingBullets.push('资本侧：当前融资窗口与可比估值决定交易性价比')
  }

  return {
    executiveSummary: {
      headline: context.research.factCount > 0
        ? `${context.project.name}：公开信息可支撑初判，交易资料仍需补齐`
        : `${context.project.name}：公开信息不足，建议先补充资料`,
      bullets: topFacts.length > 0
        ? topFacts.map(f => factLine(f))
        : [
            '尚未完成全网研究，结论仅基于已上传资料',
            '九大模块的判断需在公开检索完成并补充交易资料后复核',
            '当前版本用于识别信息缺口并形成下一步验证清单',
          ],
      conclusion: blocking.length > 0
        ? `存在 ${blocking.length} 项阻塞缺口，建议补充后再上会`
        : '可进入下一轮尽调，重点验证收入与订单',
    },
    industry: {
      headline: `${context.project.industry || '所处行业'}：行业阶段与竞争格局决定增长天花板`,
      bullets: industryBullets.slice(0, 5),
    },
    timing: {
      headline: '时机判断：需求、供给与资本窗口三者是否同时成立',
      bullets: timingBullets.slice(0, 5),
    },
    modules,
    opportunities: opportunityPool,
    risks: riskPool,
    valuation: {
      headline: context.project.investmentValuation
        ? `当前估值 ${context.project.investmentValuation} 亿元，需可比交易验证`
        : '估值缺乏公开可比，需补充本轮定价依据',
      bullets: valuationFacts.length > 0
        ? valuationFacts.map(f => factLine(f))
        : [
            '未检索到可比融资与估值信息，无法形成可靠估值锚点',
            '需补充 Term sheet、老股转让价格与可比公司融资数据',
            '建议用 PS/PE 与里程碑对赌组合替代单点估值判断',
          ],
      stats: [
        { label: '本轮融资', value: context.project.totalAmount || '未填写' },
        { label: '投资估值', value: context.project.investmentValuation ? `${context.project.investmentValuation} 亿` : '未填写' },
        { label: '研究覆盖', value: `${Math.round(context.research.coverage * 100)}%` },
        { label: '阻塞缺口', value: String(blocking.length) },
      ],
    },
    conclusion: {
      headline: blocking.length > 0 ? '有条件推进' : '建议推进至投委会',
      conditions: blocking.length > 0
        ? blocking.slice(0, 4).map(g => `补充：${truncate(g.label, 30)}`)
        : ['完成财务与法务正式尽调', '核心客户访谈验证复购', '条款谈判确认下行保护', '设定里程碑与分期交割'],
      nextSteps: recommended.length > 0
        ? recommended.slice(0, 4).map(g => `核验：${truncate(g.label, 30)}`)
        : ['按月跟踪订单与回款', '季度复核毛利与现金 runway', '下一轮融资前复盘估值假设', '关键假设触发阈值即启动条款保护'],
    },
  }
}

function sanitizeNarratives(raw: Partial<DeckNarratives> | null, fallback: DeckNarratives): DeckNarratives {
  if (!raw) return fallback

  const summary = raw.executiveSummary
  const modules = fallback.modules.map(fb => {
    const found = (raw.modules || []).find(m => m?.moduleKey === fb.moduleKey)
    if (!found) return fb
    const bullets = asStringArray(found.bullets, 5, 85)
    const analysis = asStringArray(found.analysis, 4, 85)
    return {
      moduleKey: fb.moduleKey,
      headline: truncate(String(found.headline || fb.headline), 30),
      bullets: bullets.length >= 2 ? bullets : fb.bullets,
      analysisHeadline: found.analysisHeadline
        ? truncate(String(found.analysisHeadline), 30)
        : fb.analysisHeadline,
      analysis: analysis.length >= 2 ? analysis : fb.analysis,
      opportunity: found.opportunity ? truncate(String(found.opportunity), 70) : fb.opportunity,
      risk: found.risk ? truncate(String(found.risk), 70) : fb.risk,
      unknown: found.unknown ? truncate(String(found.unknown), 70) : fb.unknown,
      evidenceRefs: asStringArray(found.evidenceRefs, 8, 8).length > 0
        ? asStringArray(found.evidenceRefs, 8, 8)
        : fb.evidenceRefs,
    }
  })

  const opportunities = (raw.opportunities || [])
    .filter(o => o && typeof o.title === 'string')
    .slice(0, 5)
    .map(o => ({
      title: truncate(String(o.title), 18),
      detail: truncate(String(o.detail || ''), 80),
      evidenceRefs: asStringArray(o.evidenceRefs, 3, 8),
    }))

  const risks = (raw.risks || [])
    .filter(r => r && typeof r.title === 'string')
    .slice(0, 5)
    .map(r => ({
      title: truncate(String(r.title), 18),
      detail: truncate(String(r.detail || ''), 80),
      mitigation: truncate(String(r.mitigation || ''), 65),
      evidenceRefs: asStringArray(r.evidenceRefs, 3, 8),
    }))

  const industryRaw = raw.industry
  const timingRaw = raw.timing

  const valuation = raw.valuation
  return {
    executiveSummary: summary && typeof summary.headline === 'string'
      ? {
          headline: truncate(summary.headline, 30),
          bullets: asStringArray(summary.bullets, 4, 80).length >= 2
            ? asStringArray(summary.bullets, 4, 80)
            : fallback.executiveSummary.bullets,
          conclusion: truncate(String(summary.conclusion || fallback.executiveSummary.conclusion), 50),
        }
      : fallback.executiveSummary,
    industry: industryRaw && typeof industryRaw.headline === 'string'
      ? {
          headline: truncate(industryRaw.headline, 30),
          bullets: asStringArray(industryRaw.bullets, 5, 85).length >= 2
            ? asStringArray(industryRaw.bullets, 5, 85)
            : fallback.industry.bullets,
        }
      : fallback.industry,
    timing: timingRaw && typeof timingRaw.headline === 'string'
      ? {
          headline: truncate(timingRaw.headline, 30),
          bullets: asStringArray(timingRaw.bullets, 5, 85).length >= 2
            ? asStringArray(timingRaw.bullets, 5, 85)
            : fallback.timing.bullets,
        }
      : fallback.timing,
    modules,
    opportunities: opportunities.length >= 3
      ? opportunities
      : [...opportunities, ...fallback.opportunities].slice(0, 5),
    risks: risks.length >= 3
      ? risks
      : [...risks, ...fallback.risks].slice(0, 5),
    valuation: valuation && typeof valuation.headline === 'string'
      ? {
          headline: truncate(valuation.headline, 30),
          bullets: asStringArray(valuation.bullets, 4, 80).length >= 2
            ? asStringArray(valuation.bullets, 4, 80)
            : fallback.valuation.bullets,
          stats: Array.isArray(valuation.stats) && valuation.stats.length >= 2
            ? valuation.stats.slice(0, 4).map(s => ({
                label: truncate(String(s.label || ''), 14),
                value: truncate(String(s.value || ''), 14),
                hint: s.hint ? truncate(String(s.hint), 20) : undefined,
              }))
            : fallback.valuation.stats,
        }
      : fallback.valuation,
    conclusion: raw.conclusion && typeof raw.conclusion.headline === 'string'
      ? {
          headline: truncate(raw.conclusion.headline, 30),
          conditions: asStringArray(raw.conclusion.conditions, 4, 60).length >= 2
            ? asStringArray(raw.conclusion.conditions, 4, 60)
            : fallback.conclusion.conditions,
          nextSteps: asStringArray(raw.conclusion.nextSteps, 4, 60).length >= 2
            ? asStringArray(raw.conclusion.nextSteps, 4, 60)
            : fallback.conclusion.nextSteps,
        }
      : fallback.conclusion,
  }
}

export async function generateNarratives(
  context: DeckContext,
  type: DeckType
): Promise<DeckNarratives> {
  const fallback = fallbackNarratives(context)

  // 分两次调用：全局判断与九模块分开，避免单次输出过长被截断导致整份报告退化为模板
  let globalRaw: Partial<DeckNarratives> | null = null
  let moduleRaw: Partial<DeckNarratives> | null = null

  try {
    globalRaw = await callDeepSeekJson<Partial<DeckNarratives>>({
      system: SYSTEM_PROMPT,
      user: buildPromptContext(context, type),
      module: 'dd-deck',
      maxTokens: 5000,
      timeoutMs: 180_000,
      temperature: 0.25,
    })
  } catch (error) {
    console.error('[dd-deck] 全局文案生成失败:', error)
  }

  try {
    moduleRaw = await callDeepSeekJson<Partial<DeckNarratives>>({
      system: SYSTEM_PROMPT,
      user: buildModulePrompt(context, type),
      module: 'dd-deck',
      maxTokens: 6000,
      timeoutMs: 180_000,
      temperature: 0.25,
    })
  } catch (error) {
    console.error('[dd-deck] 模块文案生成失败:', error)
  }

  const merged: Partial<DeckNarratives> | null = (globalRaw || moduleRaw)
    ? {
        ...(globalRaw || {}),
        modules: moduleRaw?.modules || globalRaw?.modules || [],
      }
    : null
  return sanitizeNarratives(merged, fallback)
}

// ── 模板组装 ──

function dateLabel(iso: string): string {
  return iso.slice(0, 10)
}

function moduleSlide(
  module: DeckModuleContext,
  narrative: ModuleNarrative,
  slideNo: number,
  footer: string
): SlideSpec {
  const refsFromBullets = narrative.bullets.flatMap(b => b.match(/\[([EF]\d+)\]/g) || [])
    .map(r => r.replace(/[[\]]/g, ''))
  const refs = [...new Set([...(narrative.evidenceRefs || []), ...refsFromBullets])].slice(0, 6)
  const factRefs = module.facts.slice(0, 4).map(f => f.ref)
  const evidenceRefs = refs.length > 0 ? refs : factRefs

  const openGaps = module.gaps.filter(g => g.status === 'OPEN').length
  const calloutParts = [
    `研究覆盖 ${Math.round(module.coverage * 100)}%`,
    `上传资料 ${module.docs.length} 份`,
    openGaps > 0 ? `待补 ${openGaps} 项` : '无阻塞缺口',
  ]

  return {
    slideNo,
    layout: 'module',
    kicker: module.moduleName,
    title: narrative.headline,
    bullets: narrative.bullets,
    callout: calloutParts.join('｜'),
    evidenceRefs,
    footer,
  }
}

/** 第二页：从事实走向投资含义，保证每模块至少两页、逻辑递进 */
function moduleAnalysisSlide(
  module: DeckModuleContext,
  narrative: ModuleNarrative,
  slideNo: number,
  footer: string
): SlideSpec {
  const refsFromBullets = (narrative.analysis || []).flatMap(b => b.match(/\[([EF]\d+)\]/g) || [])
    .map(r => r.replace(/[[\]]/g, ''))
  const refs = [...new Set([...(narrative.evidenceRefs || []), ...refsFromBullets])].slice(0, 6)
  const factRefs = module.facts.slice(0, 4).map(f => f.ref)
  const evidenceRefs = refs.length > 0 ? refs : factRefs
  const callout = [
    narrative.opportunity ? `机会：${narrative.opportunity}` : '',
    narrative.risk ? `风险：${narrative.risk}` : '',
    narrative.unknown ? `待验证：${narrative.unknown}` : '',
  ].filter(Boolean).join('｜')

  return {
    slideNo,
    layout: 'module',
    kicker: `${module.moduleName} · 投资含义`,
    title: narrative.analysisHeadline || `${module.moduleName}：这意味着什么`,
    bullets: (narrative.analysis && narrative.analysis.length > 0)
      ? narrative.analysis
      : [`本模块公开信息覆盖 ${Math.round(module.coverage * 100)}%`, '需补充原始资料后复核关键假设'],
    callout: callout || `研究覆盖 ${Math.round(module.coverage * 100)}%｜待补 ${module.gaps.filter(g => g.status === 'OPEN').length} 项`,
    evidenceRefs,
    footer,
  }
}

function gapColumns(context: DeckContext) {
  const open = context.gaps.items.filter(g => g.status === 'OPEN')
  const blocking = open.filter(g => g.severity === 'BLOCKING')
  const recommended = open.filter(g => g.severity === 'RECOMMENDED')
  const waived = context.gaps.items.filter(g => g.status === 'WAIVED')
  return { open, blocking, recommended, waived }
}

export function assembleBriefSpec(context: DeckContext, narratives: DeckNarratives): DeckSpec {
  const generatedAt = new Date().toISOString()
  const footer = `${context.project.name} · 资料简报`
  const { blocking, recommended, waived } = gapColumns(context)
  const readyModules = context.modules.filter(m => m.coverage >= 0.75).length

  const slides: SlideSpec[] = [
    {
      slideNo: 1,
      layout: 'cover',
      kicker: '尽调工作台 · 资料简报',
      title: truncate(`${context.project.name} 资料简报`, 40),
      subtitle: '全网公开资料 + 已上传资料的结构化整理',
      callout: `生成日期 ${dateLabel(generatedAt)}｜九大模块覆盖 ${readyModules}/9`,
      footer,
    },
    {
      slideNo: 2,
      layout: 'summary',
      kicker: '资料全景',
      title: '资料基础足以形成初步判断，但关键交易资料仍需补充',
      bullets: [
        `公开来源 ${context.research.sourceCount} 条；可核验事实 ${context.research.factCount} 条`,
        ...narratives.executiveSummary.bullets.slice(0, 2),
        `已上传资料 ${context.docs.length} 份，其中非分类资料可继续归类到模块`,
      ].slice(0, 4),
      stats: [
        { label: '公开来源', value: String(context.research.sourceCount), hint: 'A/B/C/D 分级' },
        { label: '研究事实', value: String(context.research.factCount), hint: '均带原文摘录' },
        { label: '上传资料', value: String(context.docs.length), hint: '含非分类资料' },
        { label: '模块覆盖', value: `${Math.round(context.research.coverage * 100)}%`, hint: '九模块平均' },
      ],
      callout: narratives.executiveSummary.conclusion,
      footer,
    },
  ]

  slides.push({
    slideNo: 0,
    layout: 'summary',
    kicker: '行业与时机',
    title: narratives.industry.headline,
    bullets: narratives.industry.bullets.slice(0, 4),
    callout: narratives.timing.bullets[0] || '时机判断需结合需求、供给与资本窗口',
    footer,
  })
  slides.push({
    slideNo: 0,
    layout: 'summary',
    kicker: '时机窗口',
    title: narratives.timing.headline,
    bullets: narratives.timing.bullets.slice(0, 4),
    callout: narratives.executiveSummary.conclusion,
    footer,
  })

  let slideNo = 3
  for (const module of context.modules) {
    const narrative = narratives.modules.find(m => m.moduleKey === module.moduleKey)
    slides.push(moduleSlide(module, narrative || fallbackNarratives(context).modules.find(m => m.moduleKey === module.moduleKey)!, slideNo++, footer))
  }

  slides.push({
    slideNo,
    layout: 'gap',
    kicker: '资料缺口',
    title: `还需补充 ${blocking.length + recommended.length} 项，其中 ${blocking.length} 项会阻塞投委会`,
    bullets: [
      blocking.length > 0
        ? `优先补充：${blocking.slice(0, 3).map(g => g.label).join('、')}`
        : '当前无阻塞缺口，可继续补充建议项',
      waived.length > 0 ? `${waived.length} 项已豁免，报告中保留风险提示` : '所有缺口均要求闭环后再生成正式报告',
    ],
    columns: [
      {
        title: `阻塞缺口（${blocking.length}）`,
        items: blocking.length > 0 ? blocking.slice(0, 5).map(g => g.label) : ['无'],
        tone: 'negative',
      },
      {
        title: `建议补充（${recommended.length}）`,
        items: recommended.length > 0 ? recommended.slice(0, 5).map(g => g.label) : ['无'],
        tone: 'neutral',
      },
    ],
    callout: blocking.length > 0
      ? `缺口原因：${truncate(blocking[0].reason || '公开信息无法替代公司原始资料', 50)}`
      : '资料基础已满足资料简报要求',
    footer,
  })
  slideNo += 1

  slides.push({
    slideNo,
    layout: 'summary',
    kicker: '下一步',
    title: '先补关键资料，再生成正式尽调报告',
    bullets: [
      ...(narratives.conclusion.nextSteps.length > 0
        ? narratives.conclusion.nextSteps.slice(0, 3)
        : ['补充股权与交易结构', '上传财务三表与订单台账', '完成核心客户访谈']),
      blocking.length > 0
        ? `建议上传：${truncate(blocking[0].suggestedTypes || '原始交易文件', 50)}`
        : '可直接生成尽调报告',
    ].slice(0, 4),
    callout: narratives.conclusion.headline,
    footer,
  })
  slideNo += 1

  const sourceItems = context.sources.slice(0, 10).map(s => `${s.ref}｜${truncate(s.title, 28)}｜${s.domain}（${s.grade}）`)
  const factItems = context.facts.slice(0, 10).map(f => `${f.ref}｜${truncate(f.fact, 32)}`)

  slides.push({
    slideNo,
    layout: 'appendix',
    kicker: '附录',
    title: '来源与事实索引',
    bullets: [
      `来源编号 E1–E${context.sources.length}，事实编号 F1–F${context.facts.length}`,
      '全部事实均保留来源 URL 与原文摘录，可在尽调工作台逐条核对',
    ],
    columns: [
      { title: '来源索引（E）', items: sourceItems.length > 0 ? sourceItems : ['暂无公开来源'], tone: 'neutral' },
      { title: '事实索引（F）', items: factItems.length > 0 ? factItems : ['暂无研究事实'], tone: 'neutral' },
    ],
    footer,
  })

  return {
    type: 'BRIEF',
    title: `${context.project.name} 资料简报`,
    subtitle: '全网资料与上传资料的结构化整理',
    projectName: context.project.name,
    generatedAt,
    theme: 'navy-gold',
    slides: slides.map((s, index) => ({ ...s, slideNo: index + 1 })),
  }
}

function sectionSlide(
  slideNo: number,
  sectionNo: string,
  title: string,
  subtitle: string,
  footer: string
): SlideSpec {
  return { slideNo, layout: 'section', kicker: 'CHAPTER', sectionNo, title, subtitle, footer }
}

export function assembleFinalSpec(context: DeckContext, narratives: DeckNarratives): DeckSpec {
  const generatedAt = new Date().toISOString()
  const footer = `${context.project.name} · 尽调报告`
  const { blocking, recommended, waived } = gapColumns(context)
  const moduleNarrative = (key: string) => narratives.modules.find(m => m.moduleKey === key)
    || fallbackNarratives(context).modules.find(m => m.moduleKey === key)!
  const moduleOf = (key: string) => context.modules.find(m => m.moduleKey === key)!

  const slides: SlideSpec[] = [
    {
      slideNo: 1,
      layout: 'cover',
      kicker: '投资尽调报告',
      title: truncate(context.project.name, 38),
      subtitle: context.project.companyFullName || context.project.industry || '项目尽调结论',
      callout: `生成日期 ${dateLabel(generatedAt)}｜研究覆盖 ${Math.round(context.research.coverage * 100)}%`,
      footer,
    },
    {
      slideNo: 2,
      layout: 'summary',
      kicker: '投资摘要',
      title: narratives.executiveSummary.headline,
      bullets: narratives.executiveSummary.bullets.slice(0, 4),
      stats: [
        { label: '本轮融资', value: context.project.totalAmount || '未填写' },
        { label: '投资估值', value: context.project.investmentValuation ? `${context.project.investmentValuation} 亿` : '未填写' },
        { label: '研究覆盖', value: `${Math.round(context.research.coverage * 100)}%` },
        { label: '阻塞缺口', value: String(blocking.length) },
      ],
      callout: narratives.executiveSummary.conclusion,
      footer,
    },
  ]

  // 每个模块固定两页：事实与发现 → 投资含义；slideNo 最终按数组顺序统一编号
  const pushModulePair = (key: string) => {
    const module = moduleOf(key)
    if (!module) return
    const narrative = moduleNarrative(key)
    slides.push(moduleSlide(module, narrative, 0, footer))
    slides.push(moduleAnalysisSlide(module, narrative, 0, footer))
  }

  slides.push(sectionSlide(0, '01', '行业与时机', '先判断行业阶段与窗口，再判断单个项目能否跑出来', footer))
  slides.push({
    slideNo: 0,
    layout: 'summary',
    kicker: '行业发展与政策环境',
    title: narratives.industry.headline,
    bullets: narratives.industry.bullets.slice(0, 5),
    stats: [
      { label: '公开来源', value: String(context.research.sourceCount) },
      { label: '可核验事实', value: String(context.research.factCount) },
      { label: '行业覆盖', value: `${Math.round((context.modules.find(m => m.moduleKey === 'MARKET_CUSTOMERS')?.coverage || 0) * 100)}%` },
      { label: '竞争覆盖', value: `${Math.round((context.modules.find(m => m.moduleKey === 'COMPETITION_MOATS')?.coverage || 0) * 100)}%` },
    ],
    callout: '行业结论决定项目的增长天花板与估值中枢，必须与项目自身证据分开判断',
    footer,
  })
  slides.push({
    slideNo: 0,
    layout: 'summary',
    kicker: '时机窗口',
    title: narratives.timing.headline,
    bullets: narratives.timing.bullets.slice(0, 5),
    callout: '时机判断要同时看需求、供给与资本窗口；任一条件不成立都应收紧估值或分期投入',
    footer,
  })

  slides.push(sectionSlide(0, '02', '项目与赛道', '先回答「是什么、卖给谁、凭什么」，再讨论成长与估值', footer))
  pushModulePair('PROJECT_ENTITY')
  pushModulePair('PRODUCT_TECHNOLOGY')
  pushModulePair('MARKET_CUSTOMERS')
  pushModulePair('COMMERCIALIZATION')

  slides.push(sectionSlide(0, '03', '为什么可能成', '把机会拆成可验证的驱动因素，而不是笼统的行业空间', footer))

  slides.push({
    slideNo: 9,
    layout: 'matrix',
    kicker: '机会矩阵',
    title: narratives.opportunities[0]?.title
      ? `核心机会：${narratives.opportunities[0].title}`
      : '核心机会与验证路径',
    columns: [
      {
        title: '机会',
        items: narratives.opportunities.map(o => `${o.title}：${o.detail}`),
        tone: 'positive',
      },
      {
        title: '需要验证',
        items: narratives.opportunities.map(o => o.evidenceRefs?.length ? `核对 ${o.evidenceRefs.join('、')}` : '补充客户与订单证据'),
        tone: 'neutral',
      },
    ],
    callout: narratives.executiveSummary.conclusion,
    footer,
  })

  pushModulePair('COMPETITION_MOATS')
  pushModulePair('TEAM_GOVERNANCE')

  slides.push(sectionSlide(0, '04', '为什么可能不成', '把失败路径写清楚：财务、法务、团队与竞争四条线', footer))
  pushModulePair('FINANCE_ECONOMICS')
  pushModulePair('LEGAL_COMPLIANCE')

  slides.push({
    slideNo: 15,
    layout: 'risk',
    kicker: '风险矩阵',
    title: '主要风险均有对应缓释动作，但需在交割前验证',
    columns: [
      {
        title: '主要风险',
        items: narratives.risks.map(r => `${r.title}：${r.detail}`),
        tone: 'negative',
      },
      {
        title: '缓释与验证',
        items: narratives.risks.map(r => r.mitigation),
        tone: 'positive',
      },
      {
        title: '缺口提示',
        items: blocking.length > 0
          ? blocking.slice(0, 4).map(g => `未补充：${g.label}`)
          : ['无阻塞缺口；建议项按投后计划核验'],
        tone: 'neutral',
      },
    ],
    footer,
  })

  slides.push({
    slideNo: 16,
    layout: 'compare',
    kicker: '多空对照',
    title: '做多理由与做空理由同时成立时，投后验证就是关键',
    columns: [
      {
        title: '做多理由',
        items: narratives.opportunities.map(o => o.title),
        tone: 'positive',
      },
      {
        title: '做空理由',
        items: narratives.risks.map(r => r.title),
        tone: 'negative',
      },
      {
        title: '观察指标',
        items: narratives.risks.map(r => r.mitigation),
        tone: 'neutral',
      },
    ],
    callout: '任一做空信号触发，应暂停交割并复核对赌/回购条款',
    footer,
  })

  slides.push(sectionSlide(0, '05', '估值与交易', '估值不是单点数字，而是可比、条款与回报情景的组合', footer))

  slides.push({
    slideNo: 18,
    layout: 'valuation',
    kicker: '估值与可比',
    title: narratives.valuation.headline,
    bullets: narratives.valuation.bullets.slice(0, 4),
    stats: narratives.valuation.stats.slice(0, 4),
    callout: context.project.investmentValuation
      ? `当前定价 ${context.project.investmentValuation} 亿元，需用可比交易交叉验证`
      : '当前缺少可比融资数据，建议补充 FA 材料与融资数据库导出',
    footer,
  })

  pushModulePair('VALUATION_DEAL')

  slides.push({
    slideNo: 19,
    layout: 'valuation',
    kicker: '条款与回报',
    title: '下行保护条款比估值本身更能决定实际回报',
    bullets: [
      '确认清算优先权、反稀释、回购与领售条款',
      '对赌目标需与订单、收入、毛利三项经营指标绑定',
      '按保守/基准/乐观三情景测算 MOIC 与 IRR',
    ],
    stats: [
      { label: '本轮融资', value: context.project.totalAmount || '未填写' },
      { label: '投资估值', value: context.project.investmentValuation ? `${context.project.investmentValuation} 亿` : '未填写' },
      { label: '条款缺口', value: String(context.gaps.items.filter(g => g.moduleKey === 'VALUATION_DEAL' && g.status === 'OPEN').length) },
    ],
    callout: '若核心条款无法获得，应降低估值或增加分期交割安排',
    footer,
  })

  slides.push({
    slideNo: 20,
    layout: 'summary',
    kicker: '结论与条件',
    title: narratives.conclusion.headline,
    bullets: narratives.conclusion.conditions.slice(0, 4),
    callout: blocking.length > 0
      ? `仍有 ${blocking.length} 项阻塞缺口，建议补充/豁免后再上会`
      : '关键资料已闭环，可提交投委会决策',
    footer,
  })

  slides.push({
    slideNo: 21,
    layout: 'summary',
    kicker: '投后验证',
    title: '把报告里的假设变成可跟踪的月度指标',
    bullets: [
      ...narratives.conclusion.nextSteps.slice(0, 3),
      recommended.length > 0 ? `持续跟踪缺口：${recommended.slice(0, 2).map(g => g.label).join('、')}` : '按月复盘收入、毛利与现金 runway',
    ].slice(0, 4),
    callout: '投后 90 天复核一次核心假设，触发阈值即启动条款保护',
    footer,
  })

  const sourceItems = context.sources.slice(0, 8).map(s => `${s.ref}｜${truncate(s.title, 24)}｜${s.grade}`)
  const factItems = context.facts.slice(0, 8).map(f => `${f.ref}｜${truncate(f.fact, 26)}`)

  slides.push({
    slideNo: 22,
    layout: 'appendix',
    kicker: '附录 A',
    title: '证据索引',
    bullets: [
      `来源 E1–E${context.sources.length}；事实 F1–F${context.facts.length}`,
      '所有引用均可在尽调工作台回溯到 URL 与原文摘录',
    ],
    columns: [
      { title: '来源索引（E）', items: sourceItems.length > 0 ? sourceItems : ['暂无'], tone: 'neutral' },
      { title: '事实索引（F）', items: factItems.length > 0 ? factItems : ['暂无'], tone: 'neutral' },
    ],
    footer,
  })

  slides.push({
    slideNo: 23,
    layout: 'appendix',
    kicker: '附录 B',
    title: '待验证事项与数据口径',
    bullets: [
      '以下事项未被公开信息覆盖，结论需结合补充资料复核',
      waived.length > 0 ? `${waived.length} 项缺口已由合伙人豁免，风险在正文列明` : '当前无豁免缺口',
    ],
    columns: [
      {
        title: `待补充（${blocking.length + recommended.length}）`,
        items: [...blocking, ...recommended].slice(0, 6).map(g => `${g.label}${g.severity === 'BLOCKING' ? '（阻塞）' : ''}`),
        tone: 'neutral',
      },
      {
        title: '已豁免',
        items: waived.length > 0
          ? waived.slice(0, 6).map(g => `${g.label}：${truncate(g.waiveReason || '已豁免', 18)}`)
          : ['无'],
        tone: 'positive',
      },
    ],
    footer,
  })

  return {
    type: 'FINAL',
    title: `${context.project.name} 尽调报告`,
    subtitle: '投资决策版',
    projectName: context.project.name,
    generatedAt,
    theme: 'navy-gold',
    slides: slides.map((s, index) => ({ ...s, slideNo: index + 1 })),
  }
}
