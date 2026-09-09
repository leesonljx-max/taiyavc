export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'

/**
 * 自然语言生成跟踪信号（草稿，不保存；用户在前端确认后调 POST /api/tracking-signals 保存）
 *
 * POST /api/tracking-signals/generate
 * body: { description: string }  用户的自然语言描述
 *       如"我想跟踪大厂或明星项目核心成员离职的信号"
 *
 * 返回：{ draft: { name, signalType, keywords[], watchTargets[], industry, frequency, reason } }
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/** 可选行业（与项目创建页的行业下拉一致） */
const INDUSTRIES = [
  'AI应用', 'AI硬件', 'AI基础设施', '具身智能', '商业航天', '量子计算',
  '脑机接口', '可控核聚变', '半导体设备', '半导体芯片', '光学', '新材料',
]

interface SignalDraft {
  name?: string
  signalType?: string
  keywords?: unknown
  watchTargets?: unknown
  industry?: string
  frequency?: string
  reason?: string
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const description = typeof body.description === 'string' ? body.description.trim() : ''

    if (!description || description.length < 5) {
      return NextResponse.json({ error: '请输入至少 5 个字的信号描述' }, { status: 400 })
    }
    if (description.length > 500) {
      return NextResponse.json({ error: '信号描述不能超过 500 字' }, { status: 400 })
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'DeepSeek API Key 未配置' }, { status: 500 })
    }

    const systemPrompt = `你是投资机构的信号监测配置专家。用户会用自然语言描述想跟踪的投资信号，请将其转换为结构化的跟踪配置。

可选行业：${INDUSTRIES.join('、')}

要求：
1. name：简短的信号名称（≤20字，如"大厂核心成员离职跟踪"、"明星学者创业信号"）
2. signalType：从 PERSONNEL_CHANGE（人事变动）/ NEW_STARTUP（大咖创业）/ TECH_BREAKTHROUGH（技术突破）/ FUNDING（融资动态）/ CUSTOM（自定义）中选最贴切的一个
3. keywords：1-3 组中文搜索关键词（用于新闻搜索，要具体可搜，如"字节跳动 高管 离职 创业"、"腾讯 AI 研究员 离职"），每组 ≤30 字；如果用户指定了具体公司/人物，关键词必须包含它们
4. watchTargets：用户明确提到的监控对象（公司名/人名数组）；未提及则返回空数组
5. industry：从可选行业中选最相关的一个；不相关则返回空字符串
6. frequency：DAILY（每天，适合变化快的热点跟踪）或 WEEKLY（每周，适合常规跟踪），根据信号性质推荐
7. reason：一句话说明配置思路（≤50字）

严格按以下 JSON 输出，不要任何其他文字：
{
  "name": "信号名称",
  "signalType": "PERSONNEL_CHANGE",
  "keywords": ["关键词1", "关键词2"],
  "watchTargets": [],
  "industry": "AI应用",
  "frequency": "WEEKLY",
  "reason": "配置思路说明"
}`

    // 超时控制：60 秒
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)
    let data: { usage?: unknown; choices?: Array<{ message?: { content?: string } }> }
    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `我的信号描述：${description}` },
          ],
          temperature: 0.3,
          max_tokens: 1500,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        return NextResponse.json(
          { error: `AI 生成失败: ${response.status} ${errText.substring(0, 150)}` },
          { status: 502 }
        )
      }
      data = await response.json()
    } finally {
      clearTimeout(timeoutId)
    }

    // token 记账（归属 AI 线索模块）
    recordTokenUsage('ai-leads', data.usage as Parameters<typeof recordTokenUsage>[1] | undefined)

    const parsed = parseAgentJson<SignalDraft>(data.choices?.[0]?.message?.content || '')
    const draftName = typeof parsed?.name === 'string' ? parsed.name.trim() : ''
    if (!draftName || !Array.isArray(parsed?.keywords) || parsed.keywords.length === 0) {
      return NextResponse.json({ error: 'AI 未生成有效配置，请换个描述重试' }, { status: 502 })
    }

    // 规范化输出
    const validTypes = ['PERSONNEL_CHANGE', 'NEW_STARTUP', 'TECH_BREAKTHROUGH', 'FUNDING', 'CUSTOM']
    const keywords = (parsed.keywords as unknown[])
      .filter(k => typeof k === 'string' && k.trim())
      .map(k => (k as string).trim().slice(0, 60))
      .slice(0, 3)
    const watchTargets = Array.isArray(parsed.watchTargets)
      ? (parsed.watchTargets as unknown[])
          .filter(t => typeof t === 'string' && t.trim())
          .map(t => (t as string).trim().slice(0, 50))
          .slice(0, 10)
      : []
    const industry =
      typeof parsed.industry === 'string' && INDUSTRIES.includes(parsed.industry) ? parsed.industry : ''

    return NextResponse.json({
      draft: {
        name: draftName.slice(0, 40),
        signalType: validTypes.includes(parsed.signalType || '') ? (parsed.signalType as string) : 'CUSTOM',
        keywords,
        watchTargets,
        industry,
        frequency: parsed.frequency === 'DAILY' ? 'DAILY' : 'WEEKLY',
        reason: (parsed.reason || '').trim().slice(0, 80),
      },
    })
  } catch (error) {
    console.error('Signal generate error:', error)
    return NextResponse.json({ error: '生成跟踪信号失败' }, { status: 500 })
  }
}
