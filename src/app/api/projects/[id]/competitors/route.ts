export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'
import { searchWebDual } from '@/lib/tavily-search'

/**
 * 竞争态势分析（从产品、技术路线、团队背景、融资进展等维度）
 *
 * 流程（与 AI 线索功能一致）：
 * 1. 用 Tavily 并发搜索竞品的多维度信息
 * 2. 用 DeepSeek 从搜索结果中归纳提炼结构化竞品数据
 * 3. 结果缓存至 competitorAnalysisJson 字段，所有账号共享
 */

interface CompetitorItem {
  projectName: string
  products: string           // 产品维度
  techRoute: string          // 技术路线维度
  teamBackground: string     // 团队背景维度
  latestRound: string        // 融资进展维度 - 轮次
  amount: string             // 融资进展维度 - 金额
  investors: string          // 融资进展维度 - 投资方
}

/** JSON 修复：处理 DeepSeek 返回的常见格式问题 */
function repairJson(text: string): string {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
}

// POST: 调用 AI 生成竞争态势分析
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { members: { select: { userId: true } } },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)

    if (!canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权分析该项目' },
        { status: 403 }
      )
    }

    const deepseekApiKey = process.env.DEEPSEEK_API_KEY
    if (!deepseekApiKey) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置' },
        { status: 500 }
      )
    }

    // 1. 双源并发搜索竞品的多维度信息（Tavily + DeepSeek web_search 比较 + 归纳：产品/技术/团队/融资）
    const searchQueries = [
      `${project.name} 竞品 竞争对手 产品`,
      project.mainProducts
        ? `${project.mainProducts} 竞品 技术路线`
        : `${project.name} 同行 技术路线`,
      `${project.name} 创始人 团队背景`,
      `${project.name} 融资 投资方 轮次`,
    ]
    const searchResults = await Promise.all(
      searchQueries.map(q => searchWebDual(q, { maxResults: 4 }))
    )
    const externalInfo = searchResults.flat()
      .map((r, i) => `[${i + 1}] ${r.title}\n来源: ${r.url}\n${r.content.substring(0, 500)}`)
      .join('\n\n')

    // 2. 构建 DeepSeek prompt - 覆盖 4 个维度
    const prompt = `你是一个资深的投资分析师，擅长竞争格局与市场竞品研究。请根据以下项目信息和外网搜索结果，从产品、技术路线、团队背景、融资进展等维度整理出与该项目相关的市场竞争对手信息。

待分析项目名称：${project.name}
公司全称：${project.companyFullName || '未填写'}
所处行业：${project.industry || '未填写'}
公司定位：${project.companyPosition || '未填写'}
主要产品：${project.mainProducts || '未填写'}
核心优势：${project.coreAdvantage || '未填写'}
核心团队：${project.coreTeam || '未填写'}
已知竞争对手：${project.competitors || '未填写'}

外网搜索结果（Tavily 检索）：
${externalInfo || '未找到相关外网信息'}

任务要求：
1. 结合"主要产品"、"已知竞争对手"和外网搜索结果，整理市场上相关的竞争对手（若已知竞争对手已给出，应优先包含这些公司，并补充其他相关竞品）。
2. 每个竞争对手请从以下 4 个维度进行分析：
   - projectName：竞争对手公司/项目名称
   - products：产品维度（主要产品/服务，不超过60字）
   - techRoute：技术路线维度（核心技术方向/路线，不超过60字）
   - teamBackground：团队背景维度（创始人/核心团队履历亮点，不超过60字）
   - latestRound：融资进展维度 - 最近一轮融资轮次（如 A轮、B轮、战略融资等；如无公开信息请填"未公开"）
   - amount：融资进展维度 - 融资金额（如 "1亿元人民币"、"5000万美元"；如无公开信息请填"未公开"）
   - investors：融资进展维度 - 主要投资方（2-3个，顿号分隔；如无公开信息请填"未公开"）
3. 列出 3-8 个主要竞争对手，按相关度或市场知名度排序。
4. 若某项信息无法确定，请填写"未公开"，不要编造具体数字或事实。
5. 分析应基于外网搜索结果，不要凭空捏造。

请严格按照以下 JSON 格式输出，不要包含任何其他文字：
{
  "competitors": [
    {
      "projectName": "竞争对手名称",
      "products": "主要产品/服务描述",
      "techRoute": "核心技术路线",
      "teamBackground": "创始人/团队背景",
      "latestRound": "最近融资轮次",
      "amount": "融资金额",
      "investors": "主要投资方"
    }
  ]
}`

    // 3. 调用 DeepSeek 提取结构化信息（60s 超时，与 AI 线索一致）
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    let response: Response
    try {
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            {
              role: 'system',
              content: '你是一个专业的投资分析助手，擅长从搜索结果中归纳提炼市场竞品信息，覆盖产品、技术路线、团队背景、融资进展等维度。请基于公开信息作答，无法确定的信息请标注"未公开"，不要编造数据。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: 8000,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'API 请求失败' }))
      return NextResponse.json(
        { error: `DeepSeek API 调用失败: ${errorData.message || response.statusText}` },
        { status: 500 }
      )
    }

    const result = await response.json()
    const contentJson = result.choices?.[0]?.message?.content

    if (!contentJson) {
      return NextResponse.json(
        { error: 'AI 返回数据为空' },
        { status: 500 }
      )
    }

    // 4. 解析 JSON（使用 repairJson 容错）
    let parsed: { competitors?: CompetitorItem[] }
    try {
      const repaired = repairJson(contentJson)
      const jsonMatch = repaired.match(/\{[\s\S]*\}/)
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { competitors: [] }
    } catch {
      return NextResponse.json(
        { error: 'AI 返回数据格式错误' },
        { status: 500 }
      )
    }

    const competitors = Array.isArray(parsed.competitors) ? parsed.competitors : []

    if (competitors.length === 0) {
      return NextResponse.json(
        { error: 'AI 未能检索到相关竞争对手信息' },
        { status: 500 }
      )
    }

    // 5. 缓存分析结果到数据库（所有账号共享）
    await prisma.project.update({
      where: { id: params.id },
      data: { competitorAnalysisJson: contentJson },
    })

    return NextResponse.json({ competitors })
  } catch (error) {
    console.error('Competitor analysis error:', error)
    return NextResponse.json(
      { error: '生成竞争态势分析失败' },
      { status: 500 }
    )
  }
}

// GET: 获取已缓存的竞争态势分析
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: {
        competitorAnalysisJson: true,
        followStage: true,
        createdById: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)

    if (!canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权查看该项目' },
        { status: 403 }
      )
    }

    if (!project.competitorAnalysisJson) {
      return NextResponse.json({ competitors: null })
    }

    let parsed: { competitors?: CompetitorItem[] }
    try {
      parsed = JSON.parse(project.competitorAnalysisJson)
    } catch {
      return NextResponse.json({ competitors: null })
    }

    return NextResponse.json({ competitors: parsed.competitors || null })
  } catch (error) {
    return NextResponse.json(
      { error: '获取竞争态势分析失败' },
      { status: 500 }
    )
  }
}
