/**
 * 年度报告：摘要与洞察
 *
 * 先用确定性规则生成，再尝试用 LLM 润色；LLM 失败/超时直接保留规则版，
 * 不影响报告生成。
 */

import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'
import { recordTokenUsage } from '@/lib/token-accounting'
import type { AnnualReportData, AnnualReportInsights } from './types'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

function topIndustryNames(data: AnnualReportData, limit = 3): string[] {
  return data.industries.slice(0, limit).map(item => item.name)
}

function stageCount(data: AnnualReportData, stage: string): number {
  return data.funnel.find(item => item.stage === stage)?.entered ?? 0
}

export function buildRuleInsights(data: AnnualReportData): AnnualReportInsights {
  const top = topIndustryNames(data)
  const newProjects = data.kpis.find(kpi => kpi.key === 'newProjects')?.value ?? 0
  const preDD = stageCount(data, 'PRE_DD')
  const initiation = stageCount(data, 'PROJECT_INITIATION')
  const dueDiligence = stageCount(data, 'DUE_DILIGENCE')
  const closing = stageCount(data, 'CLOSING')
  const active = data.kpis.find(kpi => kpi.key === 'activeProjects')?.value ?? 0
  const topIndustry = top[0]
  const focusStages = [
    { label: '交割', count: closing },
    { label: '尽调', count: dueDiligence },
    { label: '立项', count: initiation },
  ].sort((a, b) => b.count - a.count)

  const keywords = [
    ...top.slice(0, 3),
    `${data.meta.year}年度复盘`,
    closing > 0 ? '交割落地' : '项目储备',
  ].filter(Boolean)

  const overview =
    `${data.meta.year} 年，${data.meta.type === 'PERSONAL' ? data.meta.ownerName : '公司'}` +
    `新增初聊项目 ${newProjects} 个，进入 PreDD ${preDD} 个、立项 ${initiation} 个、尽调 ${dueDiligence} 个、交割 ${closing} 个；` +
    `年度活跃项目 ${active} 个，覆盖 ${data.industries.length} 个行业赛道` +
    (topIndustry ? `，其中 ${topIndustry} 是最集中的方向` : '') +
    '。'

  const highlights: string[] = []
  if (topIndustry) {
    const first = data.industries[0]
    highlights.push(`${topIndustry} 赛道 ${first.count} 个项目，占全年活跃项目的 ${first.share}%`)
  }
  if (closing > 0) highlights.push(`全年 ${closing} 个项目完成交割，形成可复盘的投决闭环`)
  if (dueDiligence > 0) highlights.push(`尽调阶段推进 ${dueDiligence} 个项目，是全年投入最集中的环节`)
  if (data.activity.documents > 0) highlights.push(`沉淀项目资料 ${data.activity.documents} 份、跟进记录 ${data.activity.notes} 条`)
  if (data.financing.some(item => item.progressType === 'NEW_ROUND' || item.progressType === 'ROUND_UP')) {
    highlights.push('重点项目中检索到新的公开融资进展')
  }

  const gaps: string[] = []
  const ddToClosing = data.funnel.find(item => item.stage === 'CLOSING')?.conversion
  if (ddToClosing !== null && ddToClosing !== undefined && ddToClosing < 40) {
    gaps.push(`尽调至交割转化率 ${ddToClosing}%，项目落地效率仍有提升空间`)
  }
  if (data.quality.missingStageDates > 0) {
    gaps.push(`${data.quality.missingStageDates} 个项目存在阶段时间缺失，影响年度节奏归因`)
  }
  if (data.quality.unclassifiedIndustry > 0) {
    gaps.push(`${data.quality.unclassifiedIndustry} 个项目行业未分类，赛道统计可能低估`)
  }
  if (data.quality.researchFailed > 0) {
    gaps.push(`${data.quality.researchFailed} 个项目公开融资信息检索失败`)
  }
  if (gaps.length === 0) gaps.push('整体数据完整度较好，暂无明显口径缺口')

  const nextYear = [
    topIndustry ? `围绕 ${topIndustry} 做深产业链，补齐上下游项目地图` : '明确下一年度重点赛道，建立项目地图',
    dueDiligence > 0 ? '把尽调资源集中到高置信项目，缩短尽调至交割周期' : '提前储备可进入尽调的项目，避免漏斗断层',
    '持续补齐阶段日期与行业标签，让年度复盘可量化、可对比',
  ]

  return {
    keywords: Array.from(new Set(keywords)).slice(0, 6),
    theme: topIndustry ? `${topIndustry}为主线，多赛道并进` : `${data.meta.year} 年度复盘`,
    overview,
    highlights: highlights.slice(0, 4),
    gaps: gaps.slice(0, 3),
    nextYear,
  }
}

function compactInput(data: AnnualReportData): string {
  return JSON.stringify({
    year: data.meta.year,
    type: data.meta.type,
    owner: data.meta.ownerName,
    kpis: data.kpis.map(kpi => ({ label: kpi.label, value: kpi.value, yoy: kpi.yoy })),
    funnel: data.funnel.map(item => ({ label: item.label, entered: item.entered, conversion: item.conversion })),
    industries: data.industries.slice(0, 8),
    monthlyFocus: data.monthlyFocus.map(item => ({ month: item.label, industries: item.industries })),
    activity: data.activity,
    quality: data.quality,
    financing: data.financing.slice(0, 6).map(item => ({
      project: item.projectName,
      type: item.progressType,
      round: item.latestRound,
      amount: item.amount,
    })),
  })
}

/** LLM 润色（失败返回 null，由调用方保留规则版） */
export async function enhanceInsightsWithAi(data: AnnualReportData): Promise<AnnualReportInsights | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '你是投资机构的年度复盘撰稿人。只依据给定的年度统计数据写作，不编造项目、金额或事件。语言克制、具体、可读。只输出 JSON。',
          },
          {
            role: 'user',
            content: `以下是 ${data.meta.year} 年${data.meta.type === 'PERSONAL' ? '项目维护人' : '公司'}年度数据：
${compactInput(data)}

请输出 JSON：
{
  "theme": "12字以内的年度主题",
  "overview": "120-180字的年度总览，必须包含关键数字",
  "keywords": ["4-6个关键词"],
  "highlights": ["3条年度亮点，每条不超过40字"],
  "gaps": ["2-3条值得关注的问题，每条不超过40字"],
  "nextYear": ["3条下一年度建议，每条不超过40字"]
}
不得出现数据中不存在的项目名或数字。`,
          },
        ],
        temperature: 0.4,
        max_tokens: 900,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      usage?: unknown
      choices?: Array<{ message?: { content?: string } }>
    }
    recordTokenUsage('other', payload.usage as Parameters<typeof recordTokenUsage>[1])

    const content = payload.choices?.[0]?.message?.content || ''
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as Partial<AnnualReportInsights>
    const stringArray = (value: unknown, max: number): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max)
        : []

    if (typeof parsed.theme !== 'string' || typeof parsed.overview !== 'string') return null
    return {
      theme: parsed.theme.slice(0, 30),
      overview: parsed.overview.slice(0, 300),
      keywords: stringArray(parsed.keywords, 6),
      highlights: stringArray(parsed.highlights, 4),
      gaps: stringArray(parsed.gaps, 3),
      nextYear: stringArray(parsed.nextYear, 3),
    }
  } catch (error) {
    console.error('[annual-report] AI 摘要失败，使用规则版:', error)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
