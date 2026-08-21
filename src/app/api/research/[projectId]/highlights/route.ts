export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { recordTokenUsage } from '@/lib/token-accounting'
import { parseAgentJson } from '@/lib/dd-harness/agent'

/**
 * 投资亮点（项目尽调详情页）
 *
 * PUT /api/research/[projectId]/highlights
 * body: { manualHighlights: string }
 * - 保存维护人手动填写的投资亮点（≤5000字）
 *
 * POST /api/research/[projectId]/highlights
 * - AI 结合所有模块总结投资亮点：
 *   读取项目基本信息 + 9 个模块的手动内容/AI 分析摘要/文档提取文本
 *   → DeepSeek 归纳 3-6 条投资亮点 → 存 aiHighlightsJson
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

export async function PUT(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const manualHighlights = typeof body.manualHighlights === 'string'
      ? body.manualHighlights.trim().substring(0, 5000)
      : ''

    await prisma.project.update({
      where: { id: params.projectId },
      data: { manualHighlights },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Manual highlights PUT error:', error)
    return NextResponse.json({ error: '保存投资亮点失败' }, { status: 500 })
  }
}

export async function POST(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权操作该项目' }, { status: 403 })
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'DeepSeek API Key 未配置' }, { status: 500 })
    }

    // 1. 汇总项目信息 + 所有模块内容
    const [projectFull, modules] = await Promise.all([
      prisma.project.findUnique({
        where: { id: params.projectId },
        select: {
          name: true, companyFullName: true, industry: true, companyPosition: true,
          mainProducts: true, coreAdvantage: true, coreTeam: true, competitors: true,
          totalAmount: true, raisedAmount: true, financingRound: true, description: true,
        },
      }),
      prisma.researchModule.findMany({
        where: { projectId: params.projectId },
        select: {
          moduleType: true, content: true, aiSummary: true, aiJson: true,
          documents: { select: { fileName: true, extractedText: true } },
        },
      }),
    ])
    if (!projectFull) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const MODULE_LABELS: Record<string, string> = {
      INDUSTRY: '行业分析', PRODUCT_TECH: '产品和技术', COMPETITION: '竞争分析',
      BUSINESS_DD: '业务尽调', FINANCIAL_DD: '财务尽调', TEAM: '核心团队',
      COMPANY: '公司概况', FINANCING: '融资规划和进展', RECOMMENDATION: '投资建议',
    }

    const moduleBlocks = modules.map(m => {
      const parts: string[] = [`【${MODULE_LABELS[m.moduleType] || m.moduleType}】`]
      if (m.aiSummary) parts.push(`AI摘要：${m.aiSummary}`)
      if (m.content) {
        try {
          const parsed = JSON.parse(m.content)
          const brief = Object.entries(parsed)
            .slice(0, 6)
            .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 200) : String(v).substring(0, 100)}`)
            .join('；')
          if (brief) parts.push(`手动内容：${brief}`)
        } catch { /* 忽略 */ }
      }
      const docText = m.documents
        .filter(d => d.extractedText)
        .map(d => d.extractedText!.substring(0, 800))
        .join('\n')
      if (docText) parts.push(`文档摘录：${docText}`)
      return parts.join('\n')
    }).join('\n\n')

    // 2. DeepSeek 归纳投资亮点
    const systemPrompt = `你是一级市场投资机构的资深投资人。请基于项目的全部尽调资料，站在投资人视角总结该项目的投资亮点。

要求：
1. 输出 3-6 条最核心的投资亮点，每条一句话（30-80字），具体、有数据支撑（金额/轮次/增长率等保留原样）
2. 只基于提供的资料总结，不编造；资料明显不足时如实少写
3. 亮点排序按重要性：商业模式/市场空间 > 技术/产品壁垒 > 团队 > 财务/融资进展
4. 严格按 JSON 输出，不要任何其他文字`

    const userPrompt = `【项目信息】
项目名称：${projectFull.name}
公司全称：${projectFull.companyFullName || '未填写'}
所处行业：${projectFull.industry || '未填写'}
公司定位：${projectFull.companyPosition || '未填写'}
主要产品：${projectFull.mainProducts || '未填写'}
核心优势：${projectFull.coreAdvantage || '未填写'}
核心团队：${projectFull.coreTeam || '未填写'}
竞争对手：${projectFull.competitors || '未填写'}
融资金额：${projectFull.totalAmount}
累计融资：${projectFull.raisedAmount || '未填写'}
融资轮次：${projectFull.financingRound || '未填写'}
项目描述：${projectFull.description || '未填写'}

【各尽调模块内容】
${moduleBlocks || '（暂无模块内容）'}

请输出 JSON：
{"highlights": ["亮点1", "亮点2", "亮点3"]}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90000)
    let data: { usage?: unknown; choices?: Array<{ message?: { content?: string } }> }
    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        return NextResponse.json(
          { error: `AI 总结失败: ${response.status} ${errText.substring(0, 150)}` },
          { status: 502 }
        )
      }
      data = await response.json()
    } finally {
      clearTimeout(timeoutId)
    }

    // token 记账（归属投研模块分析）
    recordTokenUsage('research', data.usage as Parameters<typeof recordTokenUsage>[1] | undefined)

    const content = data.choices?.[0]?.message?.content || ''
    const parsed = parseAgentJson<{ highlights?: unknown[] }>(content)
    const highlights = Array.isArray(parsed?.highlights)
      ? parsed!.highlights
          .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
          .map(h => h.trim().substring(0, 200))
          .slice(0, 6)
      : []

    if (highlights.length === 0) {
      return NextResponse.json({ error: 'AI 未生成有效亮点，请稍后重试' }, { status: 502 })
    }

    // 3. 保存
    const aiHighlights = { highlights, analyzedAt: new Date().toISOString() }
    await prisma.project.update({
      where: { id: params.projectId },
      data: { aiHighlightsJson: JSON.stringify(aiHighlights) },
    })

    return NextResponse.json({ aiHighlights })
  } catch (error) {
    console.error('AI highlights POST error:', error)
    return NextResponse.json({ error: 'AI 总结投资亮点失败' }, { status: 500 })
  }
}
